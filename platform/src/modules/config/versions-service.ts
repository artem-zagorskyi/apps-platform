import { createHash } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import {
  canonicalJson,
  type ConfigDocument,
  configDocumentFormat,
  documentErrors,
  lifecycleErrors,
  stampLifecycle,
} from './document.js';
import { configVersions } from './schema.js';
import { getParameterSchema } from './schemas-service.js';

const CONFIG_CACHE_MS = 60_000;

export interface ConfigVersion {
  number: number;
  document: ConfigDocument;
  comment: string | null;
  createdAt: Date;
}

export type ActiveConfig = Pick<ConfigVersion, 'number' | 'document'>;

type PublishResult = { status: 'created' | 'unchanged'; version: number };

const activeConfigs = new Map<string, { config: ActiveConfig | null; loadedAt: number }>();

// The latest version, or the one with this number; null if there is none
export async function getConfigVersion(appId: string, number?: number): Promise<ConfigVersion | null> {
  const [row] = await db
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

export function clearConfigCache(): void {
  activeConfigs.clear();
}

// Publishes a config document as a new version after checking it on its own,
// against the app's declared parameters and against the previous version
export async function publishConfig(
  appId: string,
  json: unknown,
  options: { comment?: string; now?: Date } = {},
): Promise<PublishResult> {
  const parsed = configDocumentFormat.safeParse(json);
  if (!parsed.success) {
    throw new AppError(400, 'invalid_config', `Invalid config: ${parsed.error.message}`);
  }

  const errors = documentErrors(parsed.data, await getParameterSchema(appId));
  if (errors.length > 0) {
    throw new AppError(400, 'invalid_config', `Invalid config:\n${errors.join('\n')}`);
  }

  const result = await db.transaction(async (tx): Promise<PublishResult> => {
    // One publish per app at a time, so version numbers stay sequential.
    // Released automatically at the end of the transaction.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`config:${appId}`}, 0))`);

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
    });
    return { status: 'created', version: number };
  });

  // This process serves the new version at once; others within a minute
  if (result.status === 'created') activeConfigs.delete(appId);
  return result;
}