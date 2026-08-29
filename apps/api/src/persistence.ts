import { PostgresInteractionRepository } from '@math-study-companion/database';
import { Pool } from 'pg';

import { createDemoApp, type CreateDemoAppOptions } from './app.js';
import type { Logger } from './logger.js';
import { jsonLogger } from './logger.js';
import { PostgresDemoInteractionRepositoryAdapter } from './postgres-repository.js';
import { InMemoryDemoInteractionRepository } from './repository.js';

export type DemoPersistence = 'memory' | 'postgresql';

export interface PersistenceEnvironment {
  DATABASE_URL?: string;
  DEMO_REPOSITORY?: string;
}

export interface CreateConfiguredDemoAppOptions extends Omit<
  CreateDemoAppOptions,
  'repository' | 'logger'
> {
  environment?: PersistenceEnvironment;
  logger?: Logger;
}

export async function createConfiguredDemoApp(
  options: CreateConfiguredDemoAppOptions = {},
) {
  const {
    environment = process.env,
    logger = jsonLogger,
    ...appOptions
  } = options;
  const persistence = selectPersistence(environment);

  if (persistence === 'memory') {
    const app = await createDemoApp({
      ...appOptions,
      logger,
      repository: new InMemoryDemoInteractionRepository(),
    });
    return {
      ...app,
      persistence,
      close: async () => {},
    };
  }

  const connectionString = environment.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when DEMO_REPOSITORY=postgresql');
  }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3_000 });
  pool.on('error', () => {
    logger.write({
      level: 'error',
      event: 'database.pool_error',
      traceId: 'startup',
      status: 500,
      code: 'DATABASE_POOL_ERROR',
    });
  });

  try {
    await pool.query('SELECT mode, reason FROM interactions LIMIT 0');
    await pool.query('SELECT profile_id FROM demo_profiles LIMIT 0');
    const repository = new PostgresDemoInteractionRepositoryAdapter(
      new PostgresInteractionRepository(pool),
    );
    const app = await createDemoApp({ ...appOptions, logger, repository });
    let closed = false;

    return {
      ...app,
      persistence,
      close: async () => {
        if (closed) return;
        closed = true;
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

function selectPersistence(
  environment: PersistenceEnvironment,
): DemoPersistence {
  if (environment.DEMO_REPOSITORY === 'memory') return 'memory';
  if (environment.DEMO_REPOSITORY === 'postgresql') return 'postgresql';
  if (environment.DEMO_REPOSITORY !== undefined) {
    throw new Error('DEMO_REPOSITORY must be memory or postgresql');
  }
  return environment.DATABASE_URL ? 'postgresql' : 'memory';
}
