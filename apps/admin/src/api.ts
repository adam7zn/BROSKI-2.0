import type {
  BoundingBox,
  BlockType,
  DocumentSummary,
  PageDetail,
  PageSummary,
} from './types.js';

const request = async <T>(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(payload.error ?? `Request failed (${response.status}).`);
  return payload;
};

export const api = {
  documents: (token: string) =>
    request<DocumentSummary[]>(token, '/internal/content/documents'),
  pages: (token: string, documentId: string) =>
    request<PageSummary[]>(
      token,
      `/internal/content/documents/${documentId}/pages`,
    ),
  page: (token: string, pageId: string) =>
    request<PageDetail>(token, `/internal/content/pages/${pageId}`),
  image: async (token: string, url: string): Promise<string> => {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok)
      throw new Error(`Image request failed (${response.status}).`);
    return URL.createObjectURL(await response.blob());
  },
  layout: (
    token: string,
    blockId: string,
    value: {
      sequenceNumber: number;
      blockType: BlockType;
      boundingBox: BoundingBox;
    },
  ) =>
    request(token, `/internal/content/blocks/${blockId}/layout`, {
      method: 'PATCH',
      body: JSON.stringify(value),
    }),
  review: (
    token: string,
    blockId: string,
    value: {
      decision: 'approve' | 'correct' | 'reject';
      contentMarkdown: string;
    },
  ) =>
    request(token, `/internal/content/blocks/${blockId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ ...value, reviewer: 'william', notes: null }),
    }),
  create: (token: string, pageId: string, value: unknown) =>
    request(token, `/internal/content/pages/${pageId}/blocks`, {
      method: 'POST',
      body: JSON.stringify(value),
    }),
  remove: (token: string, blockId: string) =>
    request(token, `/internal/content/blocks/${blockId}`, { method: 'DELETE' }),
  finalize: (token: string, pageId: string) =>
    request(token, `/internal/content/pages/${pageId}/finalize`, {
      method: 'POST',
    }),
};
