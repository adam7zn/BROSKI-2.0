#!/bin/zsh
set -euo pipefail

ocr_cache_root="${BROSKI_OCR_CACHE_ROOT:-${XDG_CACHE_HOME:-${HOME}/.cache}/broski-ocr}"
ocr_venv="${ocr_cache_root}/venv"
python_binary="${BROSKI_OCR_BOOTSTRAP_PYTHON:-/opt/homebrew/opt/python@3.11/bin/python3.11}"

mkdir -p "${ocr_cache_root}"
"${python_binary}" -m venv "${ocr_venv}"
"${ocr_venv}/bin/python" -m pip install --upgrade pip
"${ocr_venv}/bin/python" -m pip install --retries 20 --timeout 60 "pix2tex==0.1.4"

print "Local OCR environment ready: ${ocr_venv}"
