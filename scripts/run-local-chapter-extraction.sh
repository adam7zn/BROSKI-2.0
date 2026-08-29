#!/bin/zsh
set -euo pipefail

repository_root="${0:A:h:h}"
checkpoint_dir="${repository_root}/chapter-1/extracted/checkpoints"
output_json="${repository_root}/chapter-1/extracted/chapter-1-structured.json"
ocr_cache_root="${BROSKI_OCR_CACHE_ROOT:-${XDG_CACHE_HOME:-${HOME}/.cache}/broski-ocr}"
ocr_python="${BROSKI_OCR_PYTHON:-${ocr_cache_root}/venv/bin/python}"

cd "${repository_root}"
swift scripts/structured-ocr.swift --input chapter-1 --output "${checkpoint_dir}"
BROSKI_OCR_PYTHON="${ocr_python}" pnpm --filter @math-study-companion/ingestion extract -- \
  --checkpoints "${checkpoint_dir}" \
  --output "${output_json}" \
  --pix2tex
pnpm --filter @math-study-companion/database db:import-structured-chapter -- "${output_json}"
