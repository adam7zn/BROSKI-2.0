import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import katex from 'katex';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';

import { api } from './api';
import type {
  Block,
  BlockType,
  BoundingBox,
  DocumentSummary,
  PageDetail,
  PageSummary,
} from './types';

const blockTypes: BlockType[] = [
  'heading',
  'prose',
  'formula',
  'example',
  'exercise',
  'solution',
  'graph',
  'table',
  'image',
  'contents',
  'footer',
];
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function TokenGate({ onToken }: { onToken: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <main className="token-gate">
      <section>
        <div className="brand-mark">B</div>
        <p className="eyebrow">LOCAL REVIEW WORKSPACE</p>
        <h1>Chapter 1 extraction</h1>
        <p>This surface talks only to the review service on your Mac.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sessionStorage.setItem('admin-token', value);
            onToken(value);
          }}
        >
          <label>
            ADMIN_TOKEN
            <input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          </label>
          <button disabled={value.length < 16}>
            Open reviewer <ArrowRight size={16} />
          </button>
        </form>
      </section>
    </main>
  );
}

export function App() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem('admin-token') ?? '',
  );
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [page, setPage] = useState<PageDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pageImage, setPageImage] = useState<string | null>(null);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pageSurface = useRef<HTMLDivElement>(null);
  const selected =
    page?.blocks.find((block) => block.id === selectedId) ?? null;

  const loadPage = useCallback(
    async (pageId: string, preferredBlock?: string) => {
      setBusy(true);
      setError(null);
      try {
        const detail = await api.page(token, pageId);
        setPage(detail);
        const nextId =
          preferredBlock ??
          detail.blocks.find((block) => block.reviewState === 'pending')?.id ??
          detail.blocks[0]?.id ??
          null;
        setSelectedId(nextId);
        const image = await api.image(
          token,
          `/internal/content/pages/${pageId}/image`,
        );
        setPageImage((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return image;
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (token.length < 16) return;
    void (async () => {
      try {
        const found = await api.documents(token);
        setDocuments(found);
        if (!found[0]) return;
        const foundPages = await api.pages(token, found[0].id);
        setPages(foundPages);
        if (foundPages[0]) await loadPage(foundPages[0].id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [loadPage, token]);

  useEffect(() => {
    if (!selected) {
      setDraft('');
      setCropImage(null);
      return;
    }
    setDraft(selected.contentMarkdown);
    void api
      .image(token, `/internal/content/blocks/${selected.id}/crop`)
      .then((image) =>
        setCropImage((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return image;
        }),
      )
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [selected?.id, token]);

  const refresh = async (preferred?: string) => {
    if (page) await loadPage(page.id, preferred);
  };
  const saveLayout = async (
    block: Block,
    boundingBox = block.boundingBox,
    sequenceNumber = block.sequenceNumber,
    blockType = block.blockType,
  ) => {
    await api.layout(token, block.id, {
      sequenceNumber,
      blockType,
      boundingBox,
    });
    await refresh(block.id);
  };
  const review = async (decision: 'approve' | 'correct' | 'reject') => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.review(token, selected.id, {
        decision,
        contentMarkdown: draft,
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const nextUnresolved = (afterId?: string) => {
    if (!page) return;
    const start = Math.max(
      0,
      page.blocks.findIndex((block) => block.id === afterId) + 1,
    );
    const next = [
      ...page.blocks.slice(start),
      ...page.blocks.slice(0, start),
    ].find((block) => block.reviewState === 'pending');
    if (next) setSelectedId(next.id);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return;
      if (event.key.toLowerCase() === 'n')
        nextUnresolved(selectedId ?? undefined);
      if (event.key.toLowerCase() === 'a') void review('approve');
      if (event.key === 'ArrowRight' && page) {
        const index = pages.findIndex((candidate) => candidate.id === page.id);
        if (pages[index + 1]) void loadPage(pages[index + 1].id);
      }
      if (event.key === 'ArrowLeft' && page) {
        const index = pages.findIndex((candidate) => candidate.id === page.id);
        if (pages[index - 1]) void loadPage(pages[index - 1].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const pointerEdit = (
    event: ReactPointerEvent,
    block: Block,
    resize: boolean,
  ) => {
    event.stopPropagation();
    setSelectedId(block.id);
    const surface = pageSurface.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const start = {
      x: event.clientX,
      y: event.clientY,
      box: [...block.boundingBox] as BoundingBox,
    };
    const move = (pointer: PointerEvent) => {
      const dx = (pointer.clientX - start.x) / rect.width;
      const dy = (pointer.clientY - start.y) / rect.height;
      const box: BoundingBox = resize
        ? [
            start.box[0],
            start.box[1],
            clamp(start.box[2] + dx, 0.01, 1 - start.box[0]),
            clamp(start.box[3] + dy, 0.01, 1 - start.box[1]),
          ]
        : [
            clamp(start.box[0] + dx, 0, 1 - start.box[2]),
            clamp(start.box[1] + dy, 0, 1 - start.box[3]),
            start.box[2],
            start.box[3],
          ];
      setPage((current) =>
        current
          ? {
              ...current,
              blocks: current.blocks.map((item) =>
                item.id === block.id ? { ...item, boundingBox: box } : item,
              ),
            }
          : current,
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPage((current) => {
        const currentBlock = current?.blocks.find(
          (item) => item.id === block.id,
        );
        if (currentBlock) void saveLayout(currentBlock);
        return current;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const formulaHtml = useMemo(() => {
    if (!selected || selected.blockType !== 'formula') return null;
    const latex = draft.replace(/^\$\$\s*|\s*\$\$$/gu, '');
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: true,
      });
    } catch (cause) {
      return `<span class="formula-error">${cause instanceof Error ? cause.message : 'Invalid LaTeX'}</span>`;
    }
  }, [draft, selected?.blockType]);

  if (token.length < 16) return <TokenGate onToken={setToken} />;
  const pageIndex = page ? pages.findIndex((item) => item.id === page.id) : -1;
  const document = documents[0];
  return (
    <div className="app-shell">
      <header>
        <div className="brand-mark small">B</div>
        <div>
          <p className="eyebrow">BROSKI · LOCAL CONTENT LAB</p>
          <h1>{document?.title ?? 'Chapter review'}</h1>
        </div>
        <div className="header-progress">
          <span>
            {document?.resolvedBlockCount ?? 0} /{' '}
            {document?.totalBlockCount ?? 0} blocks
          </span>
          <div>
            <i
              style={{
                width: `${document && document.totalBlockCount ? (document.resolvedBlockCount / document.totalBlockCount) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </header>
      {error && (
        <div className="error-banner">
          <CircleAlert size={16} />
          {error}
          <button onClick={() => setError(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      <main className="workspace">
        <aside className="pages-panel">
          <div className="panel-title">
            <span>PAGES</span>
            <strong>{pages.length}</strong>
          </div>
          <nav>
            {pages.map((item) => {
              const complete =
                item.totalBlockCount > 0 &&
                item.resolvedBlockCount === item.totalBlockCount;
              return (
                <button
                  key={item.id}
                  className={item.id === page?.id ? 'active' : ''}
                  onClick={() => void loadPage(item.id)}
                >
                  <span className={`page-status ${complete ? 'complete' : ''}`}>
                    {complete ? <Check size={12} /> : item.resolvedBlockCount}
                  </span>
                  <span>
                    <strong>
                      {item.printedPageNumber
                        ? `Page ${item.printedPageNumber}`
                        : `Contents ${item.filePageNumber}`}
                    </strong>
                    <small>
                      {item.resolvedBlockCount}/{item.totalBlockCount} resolved
                    </small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </nav>
        </aside>
        <section className="page-panel">
          <div className="page-toolbar">
            <button
              disabled={pageIndex <= 0}
              onClick={() => void loadPage(pages[pageIndex - 1]!.id)}
            >
              <ArrowLeft size={15} />
            </button>
            <span>
              {page?.printedPageNumber
                ? `Printed page ${page.printedPageNumber}`
                : 'Contents'}{' '}
              · {page?.blocks.length ?? 0} blocks
            </span>
            <button
              disabled={pageIndex < 0 || pageIndex >= pages.length - 1}
              onClick={() => void loadPage(pages[pageIndex + 1]!.id)}
            >
              <ArrowRight size={15} />
            </button>
            <button
              className="add-block"
              disabled={!page}
              onClick={() =>
                page &&
                void api
                  .create(token, page.id, {
                    sequenceNumber: page.blocks.length + 1,
                    blockType: 'prose',
                    boundingBox: [0.1, 0.1, 0.4, 0.08],
                    contentMarkdown: '',
                  })
                  .then(() => refresh())
              }
            >
              <Plus size={14} /> Add block
            </button>
          </div>
          <div className="canvas-scroll">
            {pageImage && (
              <div className="page-surface" ref={pageSurface}>
                <img src={pageImage} alt="Textbook page" draggable={false} />
                {page?.blocks.map((block) => (
                  <div
                    key={block.id}
                    className={`overlay ${block.reviewState} ${block.id === selectedId ? 'selected' : ''}`}
                    style={{
                      left: `${block.boundingBox[0] * 100}%`,
                      top: `${block.boundingBox[1] * 100}%`,
                      width: `${block.boundingBox[2] * 100}%`,
                      height: `${block.boundingBox[3] * 100}%`,
                    }}
                    onPointerDown={(event) => pointerEdit(event, block, false)}
                  >
                    <span>
                      {block.sequenceNumber} · {block.blockType}
                    </span>
                    {block.id === selectedId && (
                      <i
                        onPointerDown={(event) =>
                          pointerEdit(event, block, true)
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        <aside className="review-panel">
          {selected ? (
            <>
              <div className="review-heading">
                <div>
                  <p className="eyebrow">BLOCK {selected.sequenceNumber}</p>
                  <h2>{selected.blockType}</h2>
                </div>
                <span className={`review-state ${selected.reviewState}`}>
                  {selected.reviewState}
                </span>
              </div>
              {cropImage && (
                <img
                  className="crop"
                  src={cropImage}
                  alt="Selected source crop"
                />
              )}
              <div className="flags">
                {selected.reviewReasons.length ? (
                  selected.reviewReasons.map((flag) => (
                    <span key={flag}>{flag.replaceAll('_', ' ')}</span>
                  ))
                ) : (
                  <span className="quiet">no automated flags</span>
                )}
              </div>
              <div className="layout-row">
                <label>
                  Type
                  <select
                    value={selected.blockType}
                    onChange={(event) =>
                      void saveLayout(
                        selected,
                        selected.boundingBox,
                        selected.sequenceNumber,
                        event.target.value as BlockType,
                      )
                    }
                  >
                    {blockTypes.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <div className="order-buttons">
                  <button
                    title="Move earlier"
                    onClick={() =>
                      void saveLayout(
                        selected,
                        selected.boundingBox,
                        Math.max(1, selected.sequenceNumber - 1),
                      )
                    }
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    title="Move later"
                    onClick={() =>
                      void saveLayout(
                        selected,
                        selected.boundingBox,
                        selected.sequenceNumber + 1,
                      )
                    }
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
              <div className="candidate-list">
                <p className="field-label">COMPETING EXTRACTIONS</p>
                {selected.candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    onClick={() => setDraft(candidate.contentMarkdown)}
                  >
                    <span>
                      {candidate.engine} · {candidate.passName}
                    </span>
                    <small>
                      {candidate.confidence === null
                        ? '—'
                        : `${Math.round(candidate.confidence * 100)}%`}
                    </small>
                    <p>{candidate.contentMarkdown || 'No output'}</p>
                  </button>
                ))}
              </div>
              <label className="editor">
                <span>APPROVED MARKDOWN / LATEX</span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              {formulaHtml && (
                <div
                  className="formula-preview"
                  dangerouslySetInnerHTML={{ __html: formulaHtml }}
                />
              )}
              <div className="review-actions">
                <button
                  className="reject"
                  onClick={() => void review('reject')}
                  disabled={busy}
                >
                  <X size={15} /> Reject
                </button>
                <button onClick={() => setDraft(selected.contentMarkdown)}>
                  <RotateCcw size={15} />
                </button>
                <button
                  className="correct"
                  onClick={() => void review('correct')}
                  disabled={busy}
                >
                  <Save size={15} /> Correct
                </button>
                <button
                  className="approve"
                  onClick={() => void review('approve')}
                  disabled={busy}
                >
                  <Check size={15} /> Approve
                </button>
              </div>
              <button
                className="delete"
                onClick={() =>
                  void api.remove(token, selected.id).then(() => refresh())
                }
              >
                <Trash2 size={14} /> Delete block
              </button>
              <div className="shortcuts">
                <span>N</span> next unresolved <span>A</span> approve{' '}
                <span>← →</span> pages
              </div>
            </>
          ) : (
            <div className="empty">
              <FileText size={28} />
              <p>Select a block to review its evidence.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
