import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { compatibilityErrors, type ParameterSchema, parameterSchemaFormat } from './parameters.js';
import { parameterSchemas } from './schema.js';

async function latestSchema(appId: string) {
  const [row] = await db
    .select({ schema: parameterSchemas.schema, schemaHash: parameterSchemas.schemaHash })
    .from(parameterSchemas)
    .where(eq(parameterSchemas.appId, appId))
    // uuid v7 ids grow with time: a tie-breaker within the same instant
    .orderBy(desc(parameterSchemas.createdAt), desc(parameterSchemas.id))
    .limit(1);
  return row ?? null;
}

// The app's parameters in effect, or null before the first upload
export async function getParameterSchema(appId: string): Promise<ParameterSchema | null> {
  return (await latestSchema(appId))?.schema ?? null;
}

// Stores a new version of an app's parameter declarations after checking
// the format and compatibility with the current version
export async function uploadParameterSchema(
  appId: string,
  json: unknown,
): Promise<{ status: 'created' | 'unchanged'; parameters: number }> {
  const parsed = parameterSchemaFormat.safeParse(json);
  if (!parsed.success) {
    throw new AppError(400, 'invalid_parameter_schema', `Invalid parameter schema: ${parsed.error.message}`);
  }
  const schema = parsed.data;

  const schemaHash = createHash('sha256').update(JSON.stringify(schema)).digest('hex');
  const current = await latestSchema(appId);
  const parameters = Object.keys(schema.parameters).length;

  if (current?.schemaHash === schemaHash) return { status: 'unchanged', parameters };

  if (current) {
    const errors = compatibilityErrors(current.schema, schema);
    if (errors.length > 0) {
      throw new AppError(409, 'incompatible_parameter_schema', `Breaking changes:\n${errors.join('\n')}`);
    }
  }

  await db.insert(parameterSchemas).values({ appId, schema, schemaHash });
  return { status: 'created', parameters };
}