import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

interface AppliedMigrationRow extends QueryResultRow {
  name: string;
  checksum: string;
}

const defaultMigrationsDirectory = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

const checksum = (contents: string): string =>
  createHash('sha256').update(contents).digest('hex');

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
  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();

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

    for (const name of migrationNames) {
      const contents = await readFile(`${migrationsDirectory}/${name}`, 'utf8');
      const expectedChecksum = checksum(contents);
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
