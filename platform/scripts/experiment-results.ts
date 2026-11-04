import { eq } from 'drizzle-orm';
import { db, pool } from '../src/core/db.js';
import { AppError } from '../src/core/errors.js';
import { apps } from '../src/modules/apps/schema.js';
import { type ExperimentResults, experimentResults, loadExperiment } from '../src/modules/reports/experiments.js';

// Prints the results of an experiment of the active config.
// Usage: pnpm -s experiment:results <app slug> <experiment key> [--control <variant>] [--json]
// Temporary until the admin panel shows them.

const args = process.argv.slice(2);
const json = args.includes('--json');
const controlAt = args.indexOf('--control');
const control = controlAt >= 0 ? args[controlAt + 1] : undefined;
const [slug, key] = args.filter((arg, i) => !arg.startsWith('--') && (controlAt < 0 || i !== controlAt + 1));

const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signed = (value: number) => `${value >= 0 ? '+' : ''}${percent(value, 0)}`;
const day = (date: Date) => date.toISOString().slice(0, 16).replace('T', ' ');

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, col) => Math.max(...rows.map((row) => row.at(col)?.length ?? 0))) ?? [];
  return rows.map((row) => row.map((cell, col) => cell.padEnd(widths.at(col) ?? 0)).join('   ').trimEnd()).join('\n');
}

function print(r: ExperimentResults): void {
  const days = Math.floor((r.until.getTime() - r.startedAt.getTime()) / 86_400_000);
  const users = r.variants.reduce((sum, v) => sum + v.users, 0);

  console.log(`${r.key} · ${r.status} · ${days} days · primary metric ${r.primaryMetric ?? 'none'}`);
  console.log(`From ${day(r.startedAt)} to ${r.status === 'stopped' ? day(r.until) : 'now'} (UTC)\n`);
  console.log(
    r.healthy === null
      ? 'Health: not enough data yet'
      : `Health: SRM p = ${r.srm?.toPrecision(2)}, ${r.healthy ? 'the split matches the weights' : 'THE SPLIT DOES NOT MATCH THE WEIGHTS'}`,
  );
  console.log(`Saw more than one variant (left out): ${r.quarantined} of ${users + r.quarantined}\n`);

  const rows = [['Variant', 'Weight', 'Users', 'Converted', 'Rate', `vs ${r.control}`, 'Chance to win']];
  for (const v of r.variants) {
    const c = v.comparison;
    rows.push([
      v.variant,
      `${v.weight}%`,
      String(v.users),
      v.conversions === null ? '—' : String(v.conversions),
      v.rate === null ? '—' : percent(v.rate, 2),
      c ? `${signed(c.lift)} (${signed(c.low)} to ${signed(c.high)})` : '—',
      c ? percent(c.chanceToWin) : '—',
    ]);
  }
  console.log(table(rows));

  for (const warning of r.warnings) console.log(`\n! ${warning}`);
  console.log('\nOnly users with analytics consent are counted.');
}

if (!slug || !key) {
  console.error('Usage: pnpm -s experiment:results <app slug> <experiment key> [--control <variant>] [--json]');
  process.exitCode = 1;
} else {
  const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug));

  if (!app) {
    console.error(`Unknown app "${slug}"`);
    process.exitCode = 1;
  } else {
    try {
      const experiment = await loadExperiment(app.id, key);
      const results = await experimentResults(app.id, key, experiment, control ? { control } : {});
      if (json) console.log(JSON.stringify(results, null, 2));
      else print(results);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      console.error(err.message);
      process.exitCode = 1;
    }
  }
}

await pool.end();