#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HTML_DIR="${BT_DOCS_HTML_DIR:-$REPO_ROOT/docs/_build/html}"
PAGES_DIR="${BT_PAGES_DIR:-$REPO_ROOT/docs/_build/pages}"

"$SCRIPT_DIR/build_docs.sh"

rm -rf "$PAGES_DIR"
mkdir -p "$PAGES_DIR"

# GitHub Pages serves paths beginning with '_' only when Jekyll is disabled.
touch "$PAGES_DIR/.nojekyll"

# Required Sphinx runtime assets.
cp -R "$HTML_DIR/_static" "$PAGES_DIR/_static"
if [[ -d "$HTML_DIR/_images" ]]; then
  cp -R "$HTML_DIR/_images" "$PAGES_DIR/_images"
fi

# Required pages and search index. Do not copy build caches/source dumps.
find "$HTML_DIR" -maxdepth 1 -type f \( \
  -name '*.html' -o \
  -name 'searchindex.js' \
\) -exec cp {} "$PAGES_DIR/" \;

if [[ ! -f "$PAGES_DIR/index.html" ]]; then
  echo "[pages] missing index.html in $PAGES_DIR" >&2
  exit 1
fi
if [[ ! -f "$PAGES_DIR/searchindex.js" ]]; then
  echo "[pages] missing searchindex.js in $PAGES_DIR" >&2
  exit 1
fi
if [[ ! -f "$PAGES_DIR/.nojekyll" ]]; then
  echo "[pages] missing .nojekyll in $PAGES_DIR" >&2
  exit 1
fi

cat <<MSG
[pages] built clean GitHub Pages artifact: $PAGES_DIR
[pages] upload/copy this directory contents, not docs/_build/html directly.
[pages] excluded: .doctrees, _sources, .buildinfo, objects.inv
MSG
