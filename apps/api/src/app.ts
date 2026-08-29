import { loadDemoContracts, type DemoContracts } from './contracts.js';
import { canonicalBackendContext, type BackendContext } from './domain.js';
import { createDemoHttpServer } from './http.js';
import type { Logger } from './logger.js';
import {
  InMemoryDemoInteractionRepository,
  type DemoInteractionRepository,
} from './repository.js';
import { DemoService } from './service.js';

export interface CreateDemoAppOptions {
  repository?: DemoInteractionRepository;
  contracts?: DemoContracts;
  contextFixture?: BackendContext;
  logger?: Logger;
  now?: () => Date;
}

export async function createDemoApp(options: CreateDemoAppOptions = {}) {
  const repository =
    options.repository ?? new InMemoryDemoInteractionRepository();
  const contracts = options.contracts ?? loadDemoContracts();
  const service = new DemoService({
    repository,
    contracts,
    contextFixture: options.contextFixture ?? canonicalBackendContext,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const server = createDemoHttpServer({
    service,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return { server, service, repository, contracts };
}
