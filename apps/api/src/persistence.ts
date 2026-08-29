import {
  DeterministicDemoAgent,
  SendblueMessagingProvider,
  type ConversationAgent,
} from '@math-study-companion/conversation';
import {
  PostgresHostedMessagingRepository,
  PostgresInteractionRepository,
} from '@math-study-companion/database';
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
  INTERNAL_API_TOKEN?: string;
  MESSAGING_LIVE_ENABLED?: string;
  SENDBLUE_API_BASE_URL?: string;
  SENDBLUE_API_KEY_ID?: string;
  SENDBLUE_API_SECRET_KEY?: string;
  SENDBLUE_FROM_NUMBER?: string;
  SENDBLUE_RECIPIENT_NUMBER?: string;
  SENDBLUE_WEBHOOK_SECRET?: string;
}

export interface CreateConfiguredDemoAppOptions extends Omit<
  CreateDemoAppOptions,
  'repository' | 'logger' | 'messaging'
> {
  environment?: PersistenceEnvironment;
  logger?: Logger;
  conversationAgent?: ConversationAgent;
}

export async function createConfiguredDemoApp(
  options: CreateConfiguredDemoAppOptions = {},
) {
  const {
    environment = process.env,
    logger = jsonLogger,
    conversationAgent = new DeterministicDemoAgent(),
    ...appOptions
  } = options;
  const persistence = selectPersistence(environment);

  if (persistence === 'memory') {
    if (hasHostedMessagingEnvironment(environment)) {
      throw new Error('Hosted Sendblue messaging requires PostgreSQL persistence');
    }
    const app = await createDemoApp({
      ...appOptions,
      logger,
      repository: new InMemoryDemoInteractionRepository(),
      ...(environment.INTERNAL_API_TOKEN === undefined
        ? {}
        : { internalApiToken: environment.INTERNAL_API_TOKEN }),
    });
    return {
      ...app,
      persistence,
      close: async () => app.messagingWorker?.stop(),
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
    const messagingConfiguration = hostedMessagingConfiguration(environment);
    if (messagingConfiguration) {
      await pool.query(
        'SELECT interaction_id FROM demo_messaging_sessions LIMIT 0',
      );
      await pool.query(
        'SELECT provider_event_id FROM demo_inbound_messages LIMIT 0',
      );
      await pool.query(
        'SELECT idempotency_key FROM demo_outbound_outbox LIMIT 0',
      );
    }
    const repository = new PostgresDemoInteractionRepositoryAdapter(
      new PostgresInteractionRepository(pool),
    );
    const app = await createDemoApp({
      ...appOptions,
      logger,
      repository,
      ...(messagingConfiguration
        ? { internalApiToken: messagingConfiguration.internalApiToken }
        : environment.INTERNAL_API_TOKEN === undefined
          ? {}
          : { internalApiToken: environment.INTERNAL_API_TOKEN }),
      ...(messagingConfiguration === null
        ? {}
        : {
            messaging: {
              repository: new PostgresHostedMessagingRepository(pool),
              provider: new SendblueMessagingProvider({
                apiBaseUrl: messagingConfiguration.apiBaseUrl,
                apiKeyId: messagingConfiguration.apiKeyId,
                apiSecretKey: messagingConfiguration.apiSecretKey,
                fromNumber: messagingConfiguration.fromNumber,
                recipientNumber: messagingConfiguration.recipientNumber,
                liveEnabled: messagingConfiguration.liveEnabled,
              }),
              agent: conversationAgent,
              webhookSecret: messagingConfiguration.webhookSecret,
              participantAddress: messagingConfiguration.recipientNumber,
              providerLine: messagingConfiguration.fromNumber,
              liveEnabled: messagingConfiguration.liveEnabled,
              logger,
            },
          }),
    });
    let closed = false;

    return {
      ...app,
      persistence,
      close: async () => {
        if (closed) return;
        closed = true;
        await app.messagingWorker?.stop();
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

interface HostedMessagingConfiguration {
  apiBaseUrl: string;
  apiKeyId: string;
  apiSecretKey: string;
  fromNumber: string;
  recipientNumber: string;
  webhookSecret: string;
  liveEnabled: boolean;
  internalApiToken: string;
}

function hasHostedMessagingEnvironment(
  environment: PersistenceEnvironment,
): boolean {
  return [
    environment.SENDBLUE_API_BASE_URL,
    environment.SENDBLUE_API_KEY_ID,
    environment.SENDBLUE_API_SECRET_KEY,
    environment.SENDBLUE_FROM_NUMBER,
    environment.SENDBLUE_RECIPIENT_NUMBER,
    environment.SENDBLUE_WEBHOOK_SECRET,
  ].some((value) => value !== undefined);
}

function hostedMessagingConfiguration(
  environment: PersistenceEnvironment,
): HostedMessagingConfiguration | null {
  if (!hasHostedMessagingEnvironment(environment)) return null;
  const required = (name: keyof PersistenceEnvironment): string => {
    const value = environment[name];
    if (!value) throw new Error(`${name} is required for hosted messaging`);
    return value;
  };
  return {
    apiBaseUrl: required('SENDBLUE_API_BASE_URL'),
    apiKeyId: required('SENDBLUE_API_KEY_ID'),
    apiSecretKey: required('SENDBLUE_API_SECRET_KEY'),
    fromNumber: required('SENDBLUE_FROM_NUMBER'),
    recipientNumber: required('SENDBLUE_RECIPIENT_NUMBER'),
    webhookSecret: required('SENDBLUE_WEBHOOK_SECRET'),
    internalApiToken: required('INTERNAL_API_TOKEN'),
    liveEnabled: parseBoolean(
      environment.MESSAGING_LIVE_ENABLED,
      'MESSAGING_LIVE_ENABLED',
    ),
  };
}

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be true or false`);
}
