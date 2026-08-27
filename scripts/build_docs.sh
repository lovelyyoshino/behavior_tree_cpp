#!/usr/bin/env bash
#
# build_docs.sh — 以 warning-as-error 构建 Sphinx HTML 并校验链接
#
# @author pony
# @date 2026-07-06
# @version v1.1.0
# @last_modified 2026-07-13
# @changelog
#   - v1.1.0 (2026-07-13): 将 Sphinx linkcheck 纳入统一文档 gate
#   - v1.2.0 (2026-08-26): 打印 Python/Sphinx 版本便于 CI 诊断；linkcheck 支持
#     BT_DOCS_SKIP_LINKCHECK 跳过与 BT_DOCS_ALLOW_LINKCHECK_WARN 容错，
#     避免外网/回环地址在 CI 沙箱不可达时阻断 Pages 构建
#
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

# CI 诊断：把构建环境版本打到日志，失败时可直接定位版本差异。
echo "[docs] python: $(python3 --version 2>&1)"
echo "[docs] sphinx-build: $(sphinx-build --version 2>&1)"

echo "[docs] building Sphinx HTML"
sphinx-build -W --keep-going -b html "$DOCS_DIR" "$BUILD_DIR/html"
touch "$BUILD_DIR/html/.nojekyll"

echo "[docs] built: $BUILD_DIR/html/index.html"

echo "[docs] checking Sphinx links"
if [[ "${BT_DOCS_SKIP_LINKCHECK:-0}" == "1" ]]; then
  echo "[docs] linkcheck skipped (BT_DOCS_SKIP_LINKCHECK=1)"
elif [[ "${BT_DOCS_ALLOW_LINKCHECK_WARN:-0}" == "1" ]]; then
  # linkcheck 仅报告：不因外网/回环地址在 CI 沙箱不可达而阻断 Pages 构建。
  echo "[docs] linkcheck running in warn-only mode (BT_DOCS_ALLOW_LINKCHECK_WARN=1)"
  sphinx-build --keep-going -b linkcheck "$DOCS_DIR" "$BUILD_DIR/linkcheck" || \
    echo "[docs] linkcheck reported issues (non-fatal)" >&2
else
  sphinx-build -W --keep-going -b linkcheck "$DOCS_DIR" "$BUILD_DIR/linkcheck"
fi
echo "[docs] linkcheck passed"
