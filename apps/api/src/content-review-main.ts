import path from 'node:path';

import { PostgresSourceContentRepository, runMigrations } from '@math-study-companion/database';
import { Pool } from 'pg';

import { createContentReviewApp } from './content-review-app.js';

const token = process.env.ADMIN_TOKEN;
if (token === undefined || token.length < 16) {
  throw new Error('ADMIN_TOKEN must be set to at least 16 characters.');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL
  ?? 'postgresql://postgres@127.0.0.1:54329/math_study_companion' });
await runMigrations(pool);
const server = createContentReviewApp({
  repository: new PostgresSourceContentRepository(pool), adminToken: token,
  imageRoot: process.env.CHAPTER_IMAGE_ROOT ?? path.resolve('chapter-1'),
});
const port = Number(process.env.REVIEW_PORT ?? 3011);
server.listen(port, '127.0.0.1', () => {
  console.info(`Local content review API listening on http://127.0.0.1:${port}`);
});
const stop = (): void => { server.close(() => void pool.end()); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
