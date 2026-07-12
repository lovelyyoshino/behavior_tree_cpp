#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BT_BUILD_DIR:-$REPO_ROOT/build}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[test] missing required command: $1" >&2
    exit 1
  fi
}

find_plugin() {
  local candidates=(
    "$BUILD_DIR/lib/libbt_nodes.dylib"
    "$BUILD_DIR/lib/libbt_nodes.so"
    "$BUILD_DIR/lib/libbt_nodes.dll"
    "$BUILD_DIR/bin/bt_nodes.dll"
    "$BUILD_DIR/lib/"*bt_nodes*
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

need_cmd cmake
need_cmd ctest
need_cmd npm
need_cmd python3
need_cmd curl

echo "[test] check shell script syntax"
bash -n \
  "$SCRIPT_DIR/bootstrap.sh" \
  "$SCRIPT_DIR/dev.sh" \
  "$SCRIPT_DIR/smoke_server.sh" \
  "$SCRIPT_DIR/test.sh" \
  "$SCRIPT_DIR/build_docs.sh" \
  "$SCRIPT_DIR/build_pages.sh"

echo "[test] run install-smoke loader path regression"
bash "$REPO_ROOT/tests/test_install_smoke_loader_path.sh"

echo "[test] configure C++ build"
cmake -S "$REPO_ROOT" -B "$BUILD_DIR" \
  -DBT_BUILD_NODES=ON \
  -DBT_BUILD_SERVER=ON \
  -DBT_BUILD_TESTS=ON \
  -DBT_BUILD_EXAMPLES=ON

echo "[test] build C++ targets"
cmake --build "$BUILD_DIR"

echo "[test] run C++ unit tests"
ctest --test-dir "$BUILD_DIR" --output-on-failure

echo "[test] run installed SDK consumer smoke"
"$SCRIPT_DIR/smoke_install.sh"

echo "[test] run XML example trees"
PLUGIN="${BT_NODES_PLUGIN:-$(find_plugin || true)}"
if [[ -z "$PLUGIN" || ! -f "$PLUGIN" ]]; then
  echo "[test] bt_nodes plugin not found under $BUILD_DIR/lib" >&2
  exit 1
fi
for tree in \
  "$REPO_ROOT/examples/trees/patrol.xml" \
  "$REPO_ROOT/examples/trees/minimal_sequence_fallback.xml" \
  "$REPO_ROOT/examples/trees/blackboard_data_flow.xml" \
  "$REPO_ROOT/examples/trees/diagnostic_demo.xml" \
  "$REPO_ROOT/examples/trees/subtree_reuse.xml"; do
  "$BUILD_DIR/bin/example_load_xml" "$PLUGIN" "$tree" >/dev/null
done

echo "[test] run FunctionRegistry recharge demo (singleton + factory + fn-ref)"
"$BUILD_DIR/bin/example_function_recharge" >/dev/null

echo "[test] run server API smoke"
BT_BUILD_DIR="$BUILD_DIR" "$SCRIPT_DIR/smoke_server.sh"

echo "[test] check ROS2 launch syntax and XML files"
python3 -m py_compile "$REPO_ROOT/bt_ros2/launch/bt_executor.launch.py"
python3 - "$REPO_ROOT" <<'PY'
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(sys.argv[1])
for rel in [
    "bt_ros2/package.xml",
    "bt_ros2/trees/example.xml",
    "bt_ros2/trees/recharge.xml",
]:
    ET.parse(root / rel)
PY

echo "[test] run frontend checks"
cd "$REPO_ROOT/bt_editor"
if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi
npm test
npm run build

if [[ "${BT_SKIP_E2E:-0}" == "1" ]]; then
  echo "[test] skipped Playwright E2E because BT_SKIP_E2E=1"
else
  npx playwright test
fi

echo "[test] build Sphinx docs"
"$SCRIPT_DIR/build_docs.sh"

if command -v colcon >/dev/null 2>&1 && command -v ros2 >/dev/null 2>&1; then
  echo "[test] ROS2 tools detected; real colcon/launch validation remains a manual P2 gate."
else
  echo "[test] skipped real ROS2 colcon/launch validation: colcon/ros2 not available on this machine."
fi

echo "[test] all non-ROS checks passed"
