import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import {
  canonicalJson,
  type ConfigDocument,
  configDocumentFormat,
  documentErrors,
  lifecycleErrors,
  stampLifecycle,
} from './document.js';
import { lockAppConfig } from './lock.js';
import { configVersions } from './schema.js';
import { getParameterSchema } from './schemas-service.js';

const CONFIG_CACHE_MS = 60_000;

type Executor = typeof db | Tx;

export interface ConfigVersion {
  number: number;
  document: ConfigDocument;
  comment: string | null;
  createdAt: Date;
}

export type ActiveConfig = Pick<ConfigVersion, 'number' | 'document'>;

type PublishResult = { status: 'created' | 'unchanged'; version: number };

interface PublishOptions {
  comment?: string;
  // Email of the admin; null for scripts
  publishedBy?: string | null;
  now?: Date;
}

const activeConfigs = new Map<string, { config: ActiveConfig | null; loadedAt: number }>();

// The latest version, or the one with this number; null if there is none
export async function getConfigVersion(
  appId: string,
  number?: number,
  executor: Executor = db,
): Promise<ConfigVersion | null> {
  const [row] = await executor
    .select({
      number: configVersions.number,
      document: configVersions.document,
      comment: configVersions.comment,
      createdAt: configVersions.createdAt,
    })
    .from(configVersions)
    .where(
      number === undefined
        ? eq(configVersions.appId, appId)
        : and(eq(configVersions.appId, appId), eq(configVersions.number, number)),
    )
    .orderBy(desc(configVersions.number))
    .limit(1);
  return row ?? null;
}

// The version in effect, cached for a minute. Every config request needs it.
export async function getActiveConfig(appId: string): Promise<ActiveConfig | null> {
  const cached = activeConfigs.get(appId);
  if (cached && Date.now() - cached.loadedAt < CONFIG_CACHE_MS) return cached.config;

  const latest = await getConfigVersion(appId);
  const config = latest ? { number: latest.number, document: latest.document } : null;
  activeConfigs.set(appId, { config, loadedAt: Date.now() });
  return config;
}

// This process serves a new version at once; others within a minute
export function forgetActiveConfig(appId: string): void {
  activeConfigs.delete(appId);
}

export function clearConfigCache(): void {
  activeConfigs.clear();
}

// Stores a config document as the next version in the caller's transaction,
// after checking it on its own, against the app's declared parameters and
// against the previous version. Call forgetActiveConfig after the commit.
export async function storeConfigVersion(
  tx: Tx,
  appId: string,
  json: unknown,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const parsed = configDocumentFormat.safeParse(json);
  if (!parsed.success) {
    throw new AppError(400, 'invalid_config', `Invalid config: ${parsed.error.message}`);
  }

  await lockAppConfig(tx, appId);

  const errors = documentErrors(parsed.data, await getParameterSchema(appId, tx));
  if (errors.length > 0) {
    throw new AppError(400, 'invalid_config', `Invalid config:\n${errors.join('\n')}`);
  }

  const [latest] = await tx
    .select({
      number: configVersions.number,
      document: configVersions.document,
      documentHash: configVersions.documentHash,
    })
    .from(configVersions)
    .where(eq(configVersions.appId, appId))
    .orderBy(desc(configVersions.number))
    .limit(1);
  const previous = latest?.document ?? null;

  const changeErrors = lifecycleErrors(previous, parsed.data);
  if (changeErrors.length > 0) {
    throw new AppError(409, 'invalid_config_change', `Not allowed:\n${changeErrors.join('\n')}`);
  }

  const document = stampLifecycle(previous, parsed.data, options.now ?? new Date());
  const documentHash = createHash('sha256').update(canonicalJson(document)).digest('hex');
  if (latest && latest.documentHash === documentHash) {
    return { status: 'unchanged', version: latest.number };
  }

  const number = (latest?.number ?? 0) + 1;
  await tx.insert(configVersions).values({
    appId,
    number,
    document,
    documentHash,
    comment: options.comment ?? null,
    publishedBy: options.publishedBy ?? null,
  });
  return { status: 'created', version: number };
}

// Publishes a config document as a new version
export async function publishConfig(
  appId: string,
  json: unknown,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const result = await db.transaction((tx) => storeConfigVersion(tx, appId, json, options));
  if (result.status === 'created') forgetActiveConfig(appId);
  return result;
}

// Publishes the latest document with another holdout, in the caller's transaction
export async function storeHoldout(
  tx: Tx,
  appId: string,
  percent: number,
  options: PublishOptions = {},
): Promise<PublishResult> {
  // Taken before reading, so no publish slips in between
  await lockAppConfig(tx, appId);
  const latest = await getConfigVersion(appId, undefined, tx);
  const document = latest?.document ?? { format_version: 1 };
  return storeConfigVersion(tx, appId, { ...document, holdout: { percent } }, options);
}

// The holdout in effect and the experiments that keep it from changing
export async function getHoldout(appId: string) {
  const latest = await getConfigVersion(appId);
  const experiments = latest?.document.experiments ?? {};
  return {
    percent: latest?.document.holdout.percent ?? 0,
    configVersion: latest?.number ?? null,
    runningExperiments: Object.entries(experiments)
      .filter(([, experiment]) => experiment.status === 'running')
      .map(([key]) => key)
      .sort(),
  };
}