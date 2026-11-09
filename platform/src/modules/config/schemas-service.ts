import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type Tx } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { canonicalJson, type ConfigDocument, documentErrors } from './document.js';
import { lockAppConfig } from './lock.js';
import { type SchemaChange, type SchemaWarning, schemaChanges, summarizeSchemaChanges } from './parameter-changes.js';
import { compatibilityErrors, type ParameterSchema, parameterSchemaFormat } from './parameters.js';
import { configVersions, parameterSchemas } from './schema.js';

// Versions shown in the admin panel
const HISTORY_LIMIT = 20;

type Executor = typeof db | Tx;

// target: a parameter name or a path inside the file or the config
export interface SchemaProblem {
  target: string;
  message: string;
}

export interface SchemaCheck {
  // ok: can be uploaded; unchanged: same as the current version; invalid: see errors
  status: 'ok' | 'unchanged' | 'invalid';
  currentVersion: number | null;
  nextVersion: number | null;
  parameters: number | null;
  errors: SchemaProblem[];
  warnings: SchemaWarning[];
  changes: SchemaChange[];
  summary: string | null;
}

export interface SchemaUpload {
  status: 'created' | 'unchanged';
  version: number;
  parameters: number;
  summary: string | null;
}

async function latestSchema(appId: string, executor: Executor = db) {
  const [row] = await executor
    .select({ number: parameterSchemas.number, schema: parameterSchemas.schema })
    .from(parameterSchemas)
    .where(eq(parameterSchemas.appId, appId))
    .orderBy(desc(parameterSchemas.number))
    .limit(1);
  return row ?? null;
}

// The published config the new declarations must still accept
async function latestDocument(appId: string, executor: Executor = db) {
  const [row] = await executor
    .select({ number: configVersions.number, document: configVersions.document })
    .from(configVersions)
    .where(eq(configVersions.appId, appId))
    .orderBy(desc(configVersions.number))
    .limit(1);
  return row ?? null;
}

// The app's parameters in effect, or null before the first upload
export async function getParameterSchema(appId: string, executor: Executor = db): Promise<ParameterSchema | null> {
  return (await latestSchema(appId, executor))?.schema ?? null;
}

// "parameters.daily_goal.type" → "daily_goal.type"
function shortTarget(path: string): string {
  return path.replace(/^parameters\./, '') || 'schema';
}

// A bad parameter name comes from zod as "Invalid key in record"
function issueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_key') return `name ${issue.issues[0]?.message ?? 'not allowed'}`;
  return issue.message;
}

// compatibilityErrors and documentErrors write "<path>: <message>"
function toProblem(error: string, suffix = ''): SchemaProblem {
  const at = error.indexOf(': ');
  return { target: shortTarget(error.slice(0, at)), message: error.slice(at + 2) + suffix };
}

function listProblems(problems: SchemaProblem[]): string {
  return problems.map((problem) => `${problem.target}: ${problem.message}`).join('\n');
}

interface Inspection {
  schema: ParameterSchema | null;
  invalid: SchemaProblem[];
  // Breaks installed app versions, or the published config would no longer fit
  breaking: SchemaProblem[];
  warnings: SchemaWarning[];
  changes: SchemaChange[];
  unchanged: boolean;
}

function inspectSchema(
  previous: ParameterSchema | null,
  config: { number: number; document: ConfigDocument } | null,
  json: unknown,
): Inspection {
  const parsed = parameterSchemaFormat.safeParse(json);
  if (!parsed.success) {
    const invalid = parsed.error.issues.map((issue) => ({
      target: shortTarget(issue.path.map(String).join('.')),
      message: issueMessage(issue),
    }));
    return { schema: null, invalid, breaking: [], warnings: [], changes: [], unchanged: false };
  }

  const schema = parsed.data;
  const breaking = [
    ...(previous ? compatibilityErrors(previous, schema).map((error) => toProblem(error)) : []),
    ...(config
      ? documentErrors(config.document, schema).map((error) => toProblem(error, ` (in published config v${config.number})`))
      : []),
  ];
  const unchanged = previous !== null && canonicalJson(previous) === canonicalJson(schema);

  return { schema, invalid: [], breaking, ...schemaChanges(previous, schema), unchanged };
}

// What uploading this file would do. Nothing is stored.
export async function checkParameterSchema(appId: string, json: unknown): Promise<SchemaCheck> {
  const [current, config] = await Promise.all([latestSchema(appId), latestDocument(appId)]);
  const result = inspectSchema(current?.schema ?? null, config, json);
  const errors = [...result.invalid, ...result.breaking];
  const status = errors.length > 0 ? 'invalid' : result.unchanged ? 'unchanged' : 'ok';
  const parameters = result.schema ? Object.keys(result.schema.parameters).length : null;

  return {
    status,
    currentVersion: current?.number ?? null,
    nextVersion: status === 'ok' ? (current?.number ?? 0) + 1 : null,
    parameters,
    errors,
    warnings: result.warnings,
    changes: result.changes,
    summary:
      parameters !== null && !result.unchanged
        ? summarizeSchemaChanges(result.changes, parameters, current === null)
        : null,
  };
}

// Stores the declarations as the next version in the caller's transaction
export async function storeParameterSchema(
  tx: Tx,
  appId: string,
  json: unknown,
  uploadedBy: string | null = null,
): Promise<SchemaUpload> {
  await lockAppConfig(tx, appId);

  const current = await latestSchema(appId, tx);
  const config = await latestDocument(appId, tx);
  const result = inspectSchema(current?.schema ?? null, config, json);
  if (!result.schema || result.invalid.length > 0) {
    throw new AppError(400, 'invalid_parameter_schema', `Invalid parameter schema:\n${listProblems(result.invalid)}`);
  }

  const schema = result.schema;
  const parameters = Object.keys(schema.parameters).length;
  if (current && result.unchanged) {
    return { status: 'unchanged', version: current.number, parameters, summary: null };
  }
  if (result.breaking.length > 0) {
    throw new AppError(409, 'incompatible_parameter_schema', `Breaking changes:\n${listProblems(result.breaking)}`);
  }

  const version = (current?.number ?? 0) + 1;
  const schemaHash = createHash('sha256').update(canonicalJson(schema)).digest('hex');
  await tx.insert(parameterSchemas).values({ appId, number: version, schema, schemaHash, uploadedBy });
  return {
    status: 'created',
    version,
    parameters,
    summary: summarizeSchemaChanges(result.changes, parameters, current === null),
  };
}

// Stores a new version of an app's parameter declarations after checking the
// format, compatibility with the current version and the published config
export async function uploadParameterSchema(
  appId: string,
  json: unknown,
  uploadedBy: string | null = null,
): Promise<SchemaUpload> {
  return db.transaction((tx) => storeParameterSchema(tx, appId, json, uploadedBy));
}

// The declarations in effect and the latest versions with what each changed
export async function getParameterSchemaOverview(appId: string) {
  // One row more than shown: the oldest shown version is compared with the one before it
  const rows = await db
    .select({
      number: parameterSchemas.number,
      schema: parameterSchemas.schema,
      uploadedBy: parameterSchemas.uploadedBy,
      createdAt: parameterSchemas.createdAt,
    })
    .from(parameterSchemas)
    .where(eq(parameterSchemas.appId, appId))
    .orderBy(desc(parameterSchemas.number))
    .limit(HISTORY_LIMIT + 1);

  const history = rows.slice(0, HISTORY_LIMIT).map((row, index) => {
    const previous = rows[index + 1]?.schema ?? null;
    const parameters = Object.keys(row.schema.parameters).length;
    return {
      version: row.number,
      uploadedAt: row.createdAt,
      uploadedBy: row.uploadedBy,
      parameters,
      summary: summarizeSchemaChanges(schemaChanges(previous, row.schema).changes, parameters, previous === null),
    };
  });

  const latest = rows[0];
  return {
    current: latest
      ? { version: latest.number, uploadedAt: latest.createdAt, uploadedBy: latest.uploadedBy, schema: latest.schema }
      : null,
    history,
  };
}