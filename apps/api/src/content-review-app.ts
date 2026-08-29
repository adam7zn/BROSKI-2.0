import { timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';

import {
  blockLayoutInputSchema,
  blockReviewInputSchema,
  sourceBoundingBoxSchema,
  sourceBlockTypeSchema,
} from '@math-study-companion/contracts';
import { PostgresSourceContentRepository } from '@math-study-companion/database';
import sharp from 'sharp';

export interface ReviewAppOptions {
  repository: PostgresSourceContentRepository;
  adminToken: string;
  imageRoot: string;
}

const json = (
  response: ServerResponse,
  status: number,
  body: unknown,
): void => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': 'http://127.0.0.1:4173',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  response.end(JSON.stringify(body));
};

const authorized = (request: IncomingMessage, expected: string): boolean => {
  const actual =
    request.headers.authorization?.replace(/^Bearer\s+/iu, '') ?? '';
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += value.length;
    if (length > 1_000_000) throw new Error('Request body exceeds 1 MB.');
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};

const safeImagePath = (root: string, candidate: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('Image path is outside the configured Chapter 1 root.');
  }
  return resolved;
};

const sendImage = async (
  response: ServerResponse,
  imagePath: string,
  boundingBox?: readonly [number, number, number, number],
): Promise<void> => {
  let pipeline = sharp(imagePath).rotate();
  if (boundingBox !== undefined) {
    const metadata = await pipeline.metadata();
    if (metadata.width === undefined || metadata.height === undefined) {
      throw new Error('Image dimensions are unavailable.');
    }
    const [x, y, width, height] = sourceBoundingBoxSchema.parse(boundingBox);
    const left = Math.max(0, Math.floor(x * metadata.width));
    const top = Math.max(0, Math.floor(y * metadata.height));
    const right = Math.min(
      metadata.width,
      Math.ceil((x + width) * metadata.width),
    );
    const bottom = Math.min(
      metadata.height,
      Math.ceil((y + height) * metadata.height),
    );
    pipeline = pipeline.extract({
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    });
  }
  const body = await pipeline.jpeg({ quality: 88 }).toBuffer();
  response.writeHead(200, {
    'content-type': 'image/jpeg',
    'content-length': body.length,
    'cache-control': 'private, max-age=60',
  });
  response.end(body);
};

export const createContentReviewApp = (options: ReviewAppOptions): Server =>
  createServer(async (request, response) => {
    try {
      if (request.method === 'OPTIONS') {
        json(response, 204, null);
        return;
      }
      if (!authorized(request, options.adminToken)) {
        json(response, 401, {
          error: 'A valid local ADMIN_TOKEN is required.',
        });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (
        request.method === 'GET' &&
        url.pathname === '/internal/content/documents'
      ) {
        json(response, 200, await options.repository.listDocuments());
        return;
      }
      const pageList = url.pathname.match(
        /^\/internal\/content\/documents\/([^/]+)\/pages$/u,
      );
      if (request.method === 'GET' && pageList !== null) {
        json(response, 200, await options.repository.listPages(pageList[1]!));
        return;
      }
      const page = url.pathname.match(/^\/internal\/content\/pages\/([^/]+)$/u);
      if (request.method === 'GET' && page !== null) {
        json(response, 200, await options.repository.getPage(page[1]!));
        return;
      }
      const pageImage = url.pathname.match(
        /^\/internal\/content\/pages\/([^/]+)\/image$/u,
      );
      if (request.method === 'GET' && pageImage !== null) {
        const detail = await options.repository.getPage(pageImage[1]!);
        await sendImage(
          response,
          safeImagePath(options.imageRoot, detail.imagePath),
        );
        return;
      }
      const blockCrop = url.pathname.match(
        /^\/internal\/content\/blocks\/([^/]+)\/crop$/u,
      );
      if (request.method === 'GET' && blockCrop !== null) {
        const reference = await options.repository.getBlockImageReference(
          blockCrop[1]!,
        );
        await sendImage(
          response,
          safeImagePath(options.imageRoot, reference.imagePath),
          reference.block.boundingBox,
        );
        return;
      }
      const layout = url.pathname.match(
        /^\/internal\/content\/blocks\/([^/]+)\/layout$/u,
      );
      if (request.method === 'PATCH' && layout !== null) {
        await options.repository.updateBlockLayout(
          layout[1]!,
          blockLayoutInputSchema.parse(await readJson(request)),
        );
        json(response, 200, { ok: true });
        return;
      }
      const reviews = url.pathname.match(
        /^\/internal\/content\/blocks\/([^/]+)\/reviews$/u,
      );
      if (request.method === 'POST' && reviews !== null) {
        await options.repository.reviewBlock(
          reviews[1]!,
          blockReviewInputSchema.parse(await readJson(request)),
        );
        json(response, 201, { ok: true });
        return;
      }
      const deleteBlock = url.pathname.match(
        /^\/internal\/content\/blocks\/([^/]+)$/u,
      );
      if (request.method === 'DELETE' && deleteBlock !== null) {
        await options.repository.deleteBlock(deleteBlock[1]!);
        json(response, 200, { ok: true });
        return;
      }
      const blocks = url.pathname.match(
        /^\/internal\/content\/pages\/([^/]+)\/blocks$/u,
      );
      if (request.method === 'POST' && blocks !== null) {
        const raw = (await readJson(request)) as Record<string, unknown>;
        const input = blockLayoutInputSchema.parse(raw);
        const contentMarkdown =
          typeof raw.contentMarkdown === 'string' ? raw.contentMarkdown : '';
        const id = await options.repository.createBlock(blocks[1]!, {
          ...input,
          contentMarkdown,
        });
        json(response, 201, { id });
        return;
      }
      const finalize = url.pathname.match(
        /^\/internal\/content\/pages\/([^/]+)\/finalize$/u,
      );
      if (request.method === 'POST' && finalize !== null) {
        const extractedText = await options.repository.finalizePage(
          finalize[1]!,
        );
        json(response, 200, { extractedText });
        return;
      }
      if (
        url.pathname === '/internal/content/block-types' &&
        request.method === 'GET'
      ) {
        json(response, 200, sourceBlockTypeSchema.options);
        return;
      }
      json(response, 404, { error: 'Route not found.' });
    } catch (error) {
      json(response, 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
