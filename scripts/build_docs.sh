#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs"
BUILD_DIR="${BT_DOCS_BUILD_DIR:-$DOCS_DIR/_build}"

if ! command -v sphinx-build >/dev/null 2>&1; then
  echo "[docs] sphinx-build not found. Install with:" >&2
  echo "[docs]   python3 -m pip install -r docs/requirements.txt" >&2
  exit 1
fi

echo "[docs] building Sphinx HTML"
sphinx-build -W --keep-going -b html "$DOCS_DIR" "$BUILD_DIR/html"
touch "$BUILD_DIR/html/.nojekyll"

echo "[docs] built: $BUILD_DIR/html/index.html"
