import { desc, eq } from 'drizzle-orm';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { describeConditionFields } from './conditions.js';
import { diffDocuments, forceWarnings, rebaseDocument } from './diff.js';
import { type ConfigDocument, configDocumentFormat, documentErrors, lifecycleErrors } from './document.js';
import { configDrafts, configVersions } from './schema.js';
import { getParameterSchema } from './schemas-service.js';
import { getConfigVersion } from './versions-service.js';

// The shared draft of an app's config: edits pile up here and reach users
// only when published. One draft per app, kept on the server.

type Executor = typeof db | Tx;

export interface DraftCheck {
  // Problems that block publishing
  errors: string[];
  // Allowed, but worth a look
  warnings: string[];
}

function parseDocument(json: unknown): ConfigDocument {
  const parsed = configDocumentFormat.safeParse(json);
  if (!parsed.success) {
    throw new AppError(400, 'invalid_config', `Invalid config: ${parsed.error.message}`);
  }
  return parsed.data;
}

// What publishing this document on top of the live one would do
export async function checkDocument(
  appId: string,
  live: ConfigDocument | null,
  document: ConfigDocument,
  executor: Executor = db,
): Promise<DraftCheck & { changes: ReturnType<typeof diffDocuments> }> {
  const schema = await getParameterSchema(appId, executor);
  return {
    errors: [...documentErrors(document, schema), ...lifecycleErrors(live, document)],
    warnings: forceWarnings(document),
    changes: diffDocuments(live, document),
  };
}

async function findDraft(appId: string, executor: Executor = db) {
  const [draft] = await executor.select().from(configDrafts).where(eq(configDrafts.appId, appId));
  return draft ?? null;
}

// Live version, draft with its check, declared parameters and condition fields
export async function getConfigOverview(appId: string) {
  const [live, draft, schema] = await Promise.all([
    getConfigVersion(appId),
    findDraft(appId),
    getParameterSchema(appId),
  ]);
  const liveNumber = live?.number ?? null;

  return {
    live: live && {
      version: live.number,
      document: live.document,
      comment: live.comment,
      publishedAt: live.createdAt,
    },
    draft: draft && {
      baseVersion: draft.baseVersion,
      document: draft.document,
      updatedBy: draft.updatedBy,
      updatedAt: draft.updatedAt,
      // A newer version was published after the draft was started
      stale: draft.baseVersion !== liveNumber,
      ...(await checkDocument(appId, live?.document ?? null, draft.document)),
    },
    schema,
    conditionFields: describeConditionFields(),
  };
}

// Creates or replaces the draft. baseVersion: the live version the editor saw;
// expectedUpdatedAt: the draft the editor saw, so two admins do not overwrite
// each other silently.
export async function saveDraft(
  appId: string,
  json: unknown,
  options: { baseVersion: number | null; expectedUpdatedAt?: string | null; updatedBy: string | null; now?: Date },
) {
  const document = parseDocument(json);
  const now = options.now ?? new Date();

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(configDrafts).where(eq(configDrafts.appId, appId)).for('update');

    if (current) {
      if (options.expectedUpdatedAt && current.updatedAt.toISOString() !== new Date(options.expectedUpdatedAt).toISOString()) {
        throw new AppError(409, 'draft_changed', `The draft was changed by ${current.updatedBy ?? 'someone else'}; reload it`);
      }
      await tx
        .update(configDrafts)
        .set({ document, updatedBy: options.updatedBy, updatedAt: now })
        .where(eq(configDrafts.appId, appId));
      return;
    }

    // A new draft starts from the live version the editor saw
    const live = await getConfigVersion(appId, undefined, tx);
    if ((live?.number ?? null) !== options.baseVersion) {
      throw new AppError(409, 'stale_base', `Version ${live?.number} was published meanwhile; reload the config`);
    }
    await tx.insert(configDrafts).values({
      appId,
      baseVersion: options.baseVersion,
      document,
      updatedBy: options.updatedBy,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export async function discardDraft(appId: string): Promise<boolean> {
  const deleted = await db.delete(configDrafts).where(eq(configDrafts.appId, appId)).returning({ appId: configDrafts.appId });
  return deleted.length > 0;
}

// Moves the draft onto the live version: its own changes stay, everything
// published meanwhile comes in. Parts changed on both sides are reported.
export async function rebaseDraft(appId: string, updatedBy: string | null, now: Date = new Date()) {
  return db.transaction(async (tx) => {
    const [draft] = await tx.select().from(configDrafts).where(eq(configDrafts.appId, appId)).for('update');
    if (!draft) throw new AppError(404, 'no_draft', 'There is no draft');

    const live = await getConfigVersion(appId, undefined, tx);
    const liveNumber = live?.number ?? null;
    if (draft.baseVersion === liveNumber) return { conflicts: [] as string[] };

    const base = draft.baseVersion === null ? null : await getConfigVersion(appId, draft.baseVersion, tx);
    const { document, conflicts } = rebaseDocument(base?.document ?? null, live?.document ?? null, draft.document);
    await tx
      .update(configDrafts)
      .set({ document, baseVersion: liveNumber, updatedBy, updatedAt: now })
      .where(eq(configDrafts.appId, appId));
    return { conflicts };
  });
}

// The draft, locked for publishing in the caller's transaction; refuses
// a draft started on an older version
export async function takeDraftForPublish(tx: Tx, appId: string) {
  const [draft] = await tx.select().from(configDrafts).where(eq(configDrafts.appId, appId)).for('update');
  if (!draft) throw new AppError(404, 'no_draft', 'There is no draft to publish');

  const live = await getConfigVersion(appId, undefined, tx);
  if (draft.baseVersion !== (live?.number ?? null)) {
    throw new AppError(409, 'stale_draft', `Version ${live?.number} was published after this draft was started; review it again`);
  }
  return { draft, live };
}

export async function deleteDraft(tx: Tx, appId: string): Promise<void> {
  await tx.delete(configDrafts).where(eq(configDrafts.appId, appId));
}

// Published versions, newest first, with how many changes each brought
export async function listConfigVersions(appId: string, limit = 50) {
  const rows = await db
    .select({
      number: configVersions.number,
      document: configVersions.document,
      comment: configVersions.comment,
      publishedBy: configVersions.publishedBy,
      createdAt: configVersions.createdAt,
    })
    .from(configVersions)
    .where(eq(configVersions.appId, appId))
    .orderBy(desc(configVersions.number))
    // One more, to count the changes of the oldest one shown
    .limit(limit + 1);

  return rows.slice(0, limit).map((row, index) => ({
    version: row.number,
    comment: row.comment,
    publishedBy: row.publishedBy,
    publishedAt: row.createdAt,
    changes: diffDocuments(rows[index + 1]?.document ?? null, row.document).length,
  }));
}

export async function compareConfigVersions(appId: string, from: number, to: number) {
  const [a, b] = await Promise.all([getConfigVersion(appId, from), getConfigVersion(appId, to)]);
  if (!a || !b) throw new AppError(404, 'version_not_found', 'No such version');
  return { from, to, changes: diffDocuments(a.document, b.document) };
}

// The document of an old version as a draft on top of the live one: its
// parameters, rules and layers; experiments and the holdout stay as they are
// live, since started experiments cannot go back.
export async function restoreVersionAsDraft(
  appId: string,
  number: number,
  options: { updatedBy: string | null; replace: boolean; now?: Date },
) {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const old = await getConfigVersion(appId, number, tx);
    if (!old) throw new AppError(404, 'version_not_found', 'No such version');
    const live = await getConfigVersion(appId, undefined, tx);
    if (!live) throw new AppError(404, 'version_not_found', 'Nothing is published');

    const existing = await findDraft(appId, tx);
    if (existing && !options.replace) {
      throw new AppError(409, 'draft_exists', 'There is a draft already; discard it or replace it');
    }

    const document: ConfigDocument = {
      ...old.document,
      layers: [...new Set([...live.document.layers, ...old.document.layers])],
      holdout: live.document.holdout,
      experiments: live.document.experiments,
    };
    await tx
      .insert(configDrafts)
      .values({ appId, baseVersion: live.number, document, updatedBy: options.updatedBy, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: configDrafts.appId,
        set: { baseVersion: live.number, document, updatedBy: options.updatedBy, updatedAt: now },
      });
    return { baseVersion: live.number };
  });
}
