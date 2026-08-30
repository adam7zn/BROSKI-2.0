import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface AppliedMigrationRow extends QueryResultRow {
  name: string;
  checksum: string;
}

interface MigrationLedgerTableRow extends QueryResultRow {
  table_name: string | null;
}

interface LocalMigration {
  name: string;
  checksum: string;
  contents: string;
}

export type MigrationLedgerState =
  | 'applied'
  | 'pending'
  | 'checksum_mismatch'
  | 'applied_only'
  | 'applied_alias';

export interface MigrationLedgerStatus {
  name: string;
  state: MigrationLedgerState;
  equivalentLocalName?: string;
}

const defaultMigrationsDirectory = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

const checksum = (contents: string): string =>
  createHash('sha256').update(contents).digest('hex');

const loadLocalMigrations = async (
  migrationsDirectory: string,
): Promise<LocalMigration[]> => {
  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  return Promise.all(
    migrationNames.map(async (name) => {
      const contents = await readFile(`${migrationsDirectory}/${name}`, 'utf8');
      return { name, contents, checksum: checksum(contents) };
    }),
  );
};

const rollback = async (client: PoolClient): Promise<void> => {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Keep the migration failure as the reported cause.
  }
};

export const runMigrations = async (
  pool: Pool,
  migrationsDirectory = defaultMigrationsDirectory,
): Promise<void> => {
  const migrations = await loadLocalMigrations(migrationsDirectory);

  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [731_029_114]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    const appliedResult = await client.query<AppliedMigrationRow>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const applied = new Map(
      appliedResult.rows.map((migration) => [
        migration.name,
        migration.checksum,
      ]),
    );

    for (const { name, contents, checksum: expectedChecksum } of migrations) {
      const appliedChecksum = applied.get(name);

      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== expectedChecksum) {
          throw new Error(
            `Applied migration '${name}' has changed; add a forward migration instead.`,
          );
        }
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(contents);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, expectedChecksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await rollback(client);
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [731_029_114]);
    } finally {
      client.release();
    }
  }
};

export const inspectMigrationLedger = async (
  pool: Pool,
  migrationsDirectory = defaultMigrationsDirectory,
): Promise<MigrationLedgerStatus[]> => {
  const local = await loadLocalMigrations(migrationsDirectory);
  const ledgerTable = await pool.query<MigrationLedgerTableRow>(
    "SELECT to_regclass('schema_migrations')::text AS table_name",
  );
  const applied = ledgerTable.rows[0]?.table_name
    ? (
        await pool.query<AppliedMigrationRow>(
          'SELECT name, checksum FROM schema_migrations ORDER BY name',
        )
      ).rows
    : [];
  const appliedByName = new Map(applied.map((entry) => [entry.name, entry]));
  const localByChecksum = new Map(
    local.map((entry) => [entry.checksum, entry.name]),
  );
  const statuses: MigrationLedgerStatus[] = local.map((entry) => {
    const ledgerEntry = appliedByName.get(entry.name);
    if (!ledgerEntry) return { name: entry.name, state: 'pending' };
    return {
      name: entry.name,
      state:
        ledgerEntry.checksum === entry.checksum
          ? 'applied'
          : 'checksum_mismatch',
    };
  });
  const localNames = new Set(local.map((entry) => entry.name));
  for (const entry of applied) {
    if (localNames.has(entry.name)) continue;
    const equivalentLocalName = localByChecksum.get(entry.checksum);
    statuses.push(
      equivalentLocalName
        ? {
            name: entry.name,
            state: 'applied_alias',
            equivalentLocalName,
          }
        : { name: entry.name, state: 'applied_only' },
    );
  }
  return statuses;
};
