import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Save, X } from 'lucide-react';

import { api } from './api';
import type { Block, Exercise, ExerciseContent, PageDetail } from './types';

interface ExerciseEditorProps {
  token: string;
  page: PageDetail;
  selectedBlock: Block;
}

export function ExerciseEditor({
  token,
  page,
  selectedBlock,
}: ExerciseEditorProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExerciseContent | null>(null);
  const [accepted, setAccepted] = useState('');
  const [crop, setCrop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => exercises.find((exercise) => exercise.exerciseId === selectedId),
    [exercises, selectedId],
  );

  const reload = async (preferredId?: string) => {
    const found = await api.exercises(token, page.id);
    setExercises(found);
    setSelectedId(
      preferredId ??
        found.find((exercise) => exercise.verificationState === 'draft')
          ?.exerciseId ??
        found[0]?.exerciseId ??
        null,
    );
  };

  useEffect(() => {
    setDraft(null);
    setSelectedId(null);
    void reload().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [page.id, token]);

  useEffect(() => {
    if (!selected) {
      setCrop(null);
      return;
    }
    setDraft(contentOf(selected));
    setAccepted(selected.answerPayload.accepted.join('\n'));
    setCrop(null);
    let active = true;
    void api
      .image(token, `/internal/content/exercises/${selected.exerciseId}/crop`)
      .then((image) => {
        if (!active) {
          URL.revokeObjectURL(image);
          return;
        }
        setCrop((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return image;
        });
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
    return () => {
      active = false;
    };
  }, [selected?.exerciseId, token]);

  const beginDraft = () => {
    const section = sectionFor(page.printedPageNumber);
    setSelectedId(null);
    setCrop(null);
    setAccepted('');
    setDraft({
      sourcePageId: page.id,
      sourceBlockId: selectedBlock.id,
      sourceBoundingBox: selectedBlock.boundingBox,
      sectionCode: section.code,
      sectionTitle: section.title,
      exerciseNumber: '',
      partLabel: '',
      topic: section.title,
      prompt: selectedBlock.contentMarkdown,
      answerPayload: { canonical: '', accepted: [] },
      solutionText: '',
      rubric: '',
      difficulty: 'easy',
      gradingStrategy: 'numeric',
    });
  };

  const preparedDraft = (): ExerciseContent | null =>
    draft
      ? {
          ...draft,
          answerPayload: {
            ...draft.answerPayload,
            accepted: accepted
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          },
        }
      : null;
  const canApproveExact =
    selected !== undefined &&
    JSON.stringify(preparedDraft()) === JSON.stringify(contentOf(selected));

  const create = async () => {
    const value = preparedDraft();
    if (!value) return;
    await act(async () => {
      const created = await api.createExercise(token, page.id, value);
      await reload(created.exerciseId);
    });
  };

  const review = async (decision: 'approve' | 'correct' | 'reject') => {
    if (!selected) return;
    const correction = decision === 'correct' ? preparedDraft() : null;
    await act(async () => {
      const reviewed = await api.reviewExercise(token, selected.exerciseId, {
        decision,
        correction,
      });
      await reload(reviewed.exerciseId);
    });
  };

  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="exercise-editor">
      <div className="exercise-editor-heading">
        <div>
          <p className="eyebrow">VERIFIED EXERCISES</p>
          <strong>{exercises.length} on this page</strong>
        </div>
        <button
          onClick={beginDraft}
          disabled={selectedBlock.blockType !== 'exercise'}
        >
          <Plus size={14} /> New from crop
        </button>
      </div>
      {error && <p className="exercise-error">{error}</p>}
      <div className="exercise-list">
        {exercises.map((exercise) => (
          <button
            key={exercise.exerciseId}
            className={exercise.exerciseId === selectedId ? 'active' : ''}
            onClick={() => setSelectedId(exercise.exerciseId)}
          >
            <span>
              {exercise.exerciseNumber}
              {exercise.partLabel}
            </span>
            <small className={exercise.verificationState}>
              {exercise.verificationState}
            </small>
          </button>
        ))}
      </div>
      {draft && (
        <div className="exercise-form">
          {crop && (
            <img className="crop" src={crop} alt="Exercise source crop" />
          )}
          <div className="exercise-grid">
            <Field
              label="Section"
              value={draft.sectionCode}
              onChange={(value) => setDraft({ ...draft, sectionCode: value })}
            />
            <Field
              label="Exercise"
              value={draft.exerciseNumber}
              onChange={(value) =>
                setDraft({ ...draft, exerciseNumber: value })
              }
            />
            <Field
              label="Part"
              value={draft.partLabel}
              onChange={(value) => setDraft({ ...draft, partLabel: value })}
            />
            <label>
              Difficulty
              <select
                value={draft.difficulty}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    difficulty: event.target
                      .value as ExerciseContent['difficulty'],
                  })
                }
              >
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </select>
            </label>
          </div>
          <Field
            label="Section title"
            value={draft.sectionTitle}
            onChange={(value) => setDraft({ ...draft, sectionTitle: value })}
          />
          <Field
            label="Topic"
            value={draft.topic}
            onChange={(value) => setDraft({ ...draft, topic: value })}
          />
          <Area
            label="Exact direct question"
            value={draft.prompt}
            onChange={(value) => setDraft({ ...draft, prompt: value })}
          />
          <Field
            label="Canonical answer"
            value={draft.answerPayload.canonical}
            onChange={(value) =>
              setDraft({
                ...draft,
                answerPayload: { ...draft.answerPayload, canonical: value },
              })
            }
          />
          <Area
            label="Accepted alternatives (one per line)"
            value={accepted}
            onChange={setAccepted}
          />
          <Area
            label="Locally checked solution"
            value={draft.solutionText}
            onChange={(value) => setDraft({ ...draft, solutionText: value })}
          />
          <Area
            label="Evaluation rubric"
            value={draft.rubric}
            onChange={(value) => setDraft({ ...draft, rubric: value })}
          />
          <label>
            Grading strategy
            <select
              value={draft.gradingStrategy}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  gradingStrategy: event.target
                    .value as ExerciseContent['gradingStrategy'],
                })
              }
            >
              <option value="numeric">numeric</option>
              <option value="symbolic">symbolic</option>
              <option value="multiple_choice">multiple choice</option>
              <option value="rubric">rubric</option>
            </select>
          </label>
          {!selected ? (
            <button
              className="exercise-save"
              onClick={() => void create()}
              disabled={busy}
            >
              <Save size={14} /> Save private draft
            </button>
          ) : (
            <div className="exercise-review-actions">
              <button onClick={() => void review('reject')} disabled={busy}>
                <X size={14} /> Reject
              </button>
              <button
                className="correct"
                onClick={() => void review('correct')}
                disabled={busy}
              >
                <Save size={14} /> Correct + verify
              </button>
              <button
                className="approve"
                onClick={() => void review('approve')}
                disabled={busy || !canApproveExact}
              >
                <Check size={14} /> Approve exact
              </button>
            </div>
          )}
          <p className="exercise-warning">
            Only Approve exact or Correct + verify makes this question available
            to messaging.
          </p>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function contentOf(exercise: Exercise): ExerciseContent {
  return {
    sourcePageId: exercise.sourcePageId,
    sourceBlockId: exercise.sourceBlockId,
    sourceBoundingBox: exercise.sourceBoundingBox,
    sectionCode: exercise.sectionCode,
    sectionTitle: exercise.sectionTitle,
    exerciseNumber: exercise.exerciseNumber,
    partLabel: exercise.partLabel,
    topic: exercise.topic,
    prompt: exercise.prompt,
    answerPayload: exercise.answerPayload,
    solutionText: exercise.solutionText,
    rubric: exercise.rubric,
    difficulty: exercise.difficulty,
    gradingStrategy: exercise.gradingStrategy,
  };
}

function sectionFor(printedPage: string | null): {
  code: string;
  title: string;
} {
  const page = Number(printedPage);
  if (page <= 14) return { code: '1.1', title: 'Polynom' };
  if (page <= 29) return { code: '1.2', title: 'Polynomekvationer' };
  return { code: '1.3', title: 'Rationella uttryck' };
}
