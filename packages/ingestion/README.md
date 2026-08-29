# Fully local Chapter 1 extraction

The extraction path never sends page data to a provider. Apple Vision runs on
macOS, and the optional pix2tex worker uses CPU inference in a machine-local
Python environment.

## One-time setup

```sh
zsh scripts/setup-local-ocr.sh
```

The virtual environment and model cache live under `~/.cache/broski-ocr` by
default and are not part of the repository. Source images, page checkpoints,
and the final structured JSON remain Git-visible.

## Resume or rerun the chapter

```sh
zsh scripts/run-local-chapter-extraction.sh
```

Each Apple Vision page is written atomically to
`chapter-1/extracted/checkpoints`. Existing checkpoints are reused. Candidate
inserts are idempotent, and a repeat import does not overwrite human reviews.

To calibrate selected printed pages first:

```sh
swift scripts/structured-ocr.swift \
  --input chapter-1 \
  --output chapter-1/extracted/checkpoints \
  --pages 9,17,36,44,47,56,57,58,63
```

Every imported block starts in `pending`, including high-confidence prose.
