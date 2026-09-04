#!/usr/bin/env bash
#
# dev.sh — 启动树编辑器、普通树后端，并自动托管可用的 ROS2 只读 bridge。
#
# @author pony
# @date 2026-06-30
# @version v1.5.0
# @last_modified 2026-08-24
# @changelog
#   - v1.5.0 (2026-08-24): 支持 BT_DEV_CONFIG 配置驱动；ROS2 可用时自动构建并加载 bt_ros2_plugin，普通/ROS2 双模式
#   - v1.4.0 (2026-08-24): 自动 source 仓库内 install_ros2 overlay，避免 ros2 launch 找不到 bt_ros2
#   - v1.3.0 (2026-08-24): 支持自定义 ROS 环境脚本并避免 shell 拼接 bridge 参数
#   - v1.2.0 (2026-08-21): 自动发现 ROS2 环境并托管 bt_web，支持源码运行回退
#   - v1.1.0 (2026-07-13): 启动 bt_server 与 Vite 并在退出时清理子进程
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BT_BUILD_DIR:-$REPO_ROOT/build}"
SERVER_HOST="${BT_SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${BT_SERVER_PORT:-8080}"
FRONTEND_HOST="${BT_EDITOR_HOST:-127.0.0.1}"
FRONTEND_PORT="${BT_EDITOR_PORT:-5173}"
SERVER_BIN="${BT_SERVER_BIN:-$BUILD_DIR/bin/bt_server}"
# 配置驱动入口：默认读仓库根目录 .bt-dev.env，可用 BT_DEV_CONFIG 覆盖。
BT_DEV_CONFIG="${BT_DEV_CONFIG:-$REPO_ROOT/.bt-dev.env}"
if [[ -f "$BT_DEV_CONFIG" ]]; then
  # 配置文件用到的行内 export 与普通 shell 一致；这里的 source 是刻意允许的，
  # 以便用户只改一个文件即可全覆盖启动参数。
  set +u
  # shellcheck disable=SC1090
  source "$BT_DEV_CONFIG" || true
  set -u
  echo "[dev] 已读取配置: $BT_DEV_CONFIG"
fi
ROS_WEB_MODE="${BT_ROS_WEB_MODE:-auto}"
ROS_WEB_HOST="${BT_ROS_WEB_HOST:-127.0.0.1}"
ROS_WEB_PORT="${BT_ROS_WEB_PORT:-8088}"
ROS_SETUP_FILE="${BT_ROS_SETUP_FILE:-}"
ROS_OVERLAY_FILE="${BT_ROS_OVERLAY_FILE:-}"
ROS_WEB_LOG_FILE="${BT_ROS_WEB_LOG_FILE:-/tmp/bt_ros_web.log}"
ROS_WEB_PID=""
ROS_WEB_STATUS="未启动（可设置 BT_ROS_WEB_MODE=on 查看错误）"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[dev] missing required command: $1" >&2
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

wait_for_http() {
  local url="$1"
  local label="$2"
  local pid="$3"
  local ready=0
  for _ in {1..100}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "[dev] $label exited before becoming ready" >&2
      return 1
    fi
    sleep 0.1
  done
  if [[ "$ready" != "1" ]]; then
    echo "[dev] $label did not become ready: $url" >&2
    return 1
  fi
}

# ROS/colcon setup scripts intentionally use unset environment variables as
# optional switches (for example AMENT_TRACE_SETUP_FILES and COLCON_TRACE).
# Keep the launcher strict, but load those scripts in the mode they expect.
source_ros_setup() {
  local setup_file="$1"
  local setup_status=0

  set +u
  source "$setup_file" || setup_status=$?
  set -u

  return "$setup_status"
}

start_ros_web() {
  case "$ROS_WEB_MODE" in
    off|0|false)
      echo "[dev] ROS2 bridge disabled by BT_ROS_WEB_MODE=$ROS_WEB_MODE"
      return 0
      ;;
    auto|on|1|true)
      ;;
    *)
      echo "[dev] invalid BT_ROS_WEB_MODE=$ROS_WEB_MODE (use auto, on, or off)" >&2
      return 1
      ;;
  esac

  # 让“只启动 ./scripts/dev.sh”在常见 ROS 安装上自动获得 ros2/rclpy；不要求用户
  # 预先 source。BT_ROS_SETUP_FILE 可用于非 Humble 或自定义 ROS 工作区。
  if [[ -z "$ROS_SETUP_FILE" ]]; then
    if [[ -n "${ROS_DISTRO:-}" && -f "/opt/ros/$ROS_DISTRO/setup.bash" ]]; then
      ROS_SETUP_FILE="/opt/ros/$ROS_DISTRO/setup.bash"
    elif [[ -f /opt/ros/humble/setup.bash ]]; then
      ROS_SETUP_FILE="/opt/ros/humble/setup.bash"
    fi
  fi
  if [[ -n "$ROS_SETUP_FILE" && -f "$ROS_SETUP_FILE" ]]; then
    # shellcheck disable=SC1090
    source_ros_setup "$ROS_SETUP_FILE"
  fi
  # ROS2 wrapper 通常安装在仓库自己的 overlay；只 source /opt/ros/<distro>
  # 会导致 `ros2 pkg prefix bt_ros2` 返回 Package not found。显式设置
  # BT_ROS_OVERLAY_FILE 可覆盖自动探测；设置为 off/none 可关闭 overlay。
  if [[ -z "$ROS_OVERLAY_FILE" && -f "$REPO_ROOT/install_ros2/setup.bash" ]]; then
    ROS_OVERLAY_FILE="$REPO_ROOT/install_ros2/setup.bash"
  fi
  if [[ "$ROS_OVERLAY_FILE" != "off" && "$ROS_OVERLAY_FILE" != "none" \
    && -n "$ROS_OVERLAY_FILE" && -f "$ROS_OVERLAY_FILE" ]]; then
    # shellcheck disable=SC1090
    source_ros_setup "$ROS_OVERLAY_FILE"
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[dev] ROS2 bridge skipped: python3 不存在" >&2
    [[ "$ROS_WEB_MODE" == "on" || "$ROS_WEB_MODE" == 1 || "$ROS_WEB_MODE" == true ]] && return 1
    return 0
  fi
  if ! python3 -c 'import rclpy' >/dev/null 2>&1; then
    echo "[dev] ROS2 bridge skipped: 当前 Python 环境没有 rclpy（普通编辑器仍可使用）" >&2
    [[ "$ROS_WEB_MODE" == "on" || "$ROS_WEB_MODE" == 1 || "$ROS_WEB_MODE" == true ]] && return 1
    return 0
  fi

  # Reuse a bridge started by a separate ROS2 launch instead of binding a
  # second HTTP server to the same port. This also makes `./scripts/dev.sh`
  # safe to start after a manually launched bt_web during development.
  if curl -fsS "http://$ROS_WEB_HOST:$ROS_WEB_PORT/api/v1/health" >/dev/null 2>&1; then
    echo "[dev] reusing existing ROS2 graph bridge: http://$ROS_WEB_HOST:$ROS_WEB_PORT"
    ROS_WEB_STATUS="http://$ROS_WEB_HOST:$ROS_WEB_PORT (existing)"
    return 0
  fi

  if command -v ros2 >/dev/null 2>&1 && ros2 pkg prefix bt_ros2 >/dev/null 2>&1; then
    echo "[dev] starting installed ROS2 bridge: ros2 launch bt_ros2 bt_web.launch.py bind_address:=$ROS_WEB_HOST http_port:=$ROS_WEB_PORT"
    ros2 launch bt_ros2 bt_web.launch.py \
      "bind_address:=$ROS_WEB_HOST" "http_port:=$ROS_WEB_PORT" \
      >"$ROS_WEB_LOG_FILE" 2>&1 &
  else
    # 尚未 colcon install 时直接运行仓库脚本；bt_web.py 会回退到 bt_ros2/trees 与 bt_ros2/web。
    echo "[dev] starting source ROS2 bridge: python3 $REPO_ROOT/bt_ros2/scripts/bt_web.py"
    PYTHONPATH="$REPO_ROOT/bt_ros2/scripts${PYTHONPATH:+:$PYTHONPATH}" \
      python3 "$REPO_ROOT/bt_ros2/scripts/bt_web.py" \
      --ros-args -p bind_address:="$ROS_WEB_HOST" -p http_port:="$ROS_WEB_PORT" \
      >"$ROS_WEB_LOG_FILE" 2>&1 &
  fi
  ROS_WEB_PID=$!

  if ! wait_for_http "http://$ROS_WEB_HOST:$ROS_WEB_PORT/api/v1/health" "bt_web" "$ROS_WEB_PID"; then
    echo "[dev] ROS2 bridge 未能启动，编辑器会保留手工 ROS 端口配置" >&2
    echo "[dev] bridge 日志: $ROS_WEB_LOG_FILE" >&2
    if [[ -s "$ROS_WEB_LOG_FILE" ]]; then
      tail -n 20 "$ROS_WEB_LOG_FILE" >&2 || true
    fi
    kill "$ROS_WEB_PID" >/dev/null 2>&1 || true
    wait "$ROS_WEB_PID" >/dev/null 2>&1 || true
    ROS_WEB_PID=""
    [[ "$ROS_WEB_MODE" == "on" || "$ROS_WEB_MODE" == 1 || "$ROS_WEB_MODE" == true ]] && return 1
    return 0
  fi
  echo "[dev] ROS2 graph bridge: http://$ROS_WEB_HOST:$ROS_WEB_PORT"
  ROS_WEB_STATUS="http://$ROS_WEB_HOST:$ROS_WEB_PORT"
}

need_cmd cmake
need_cmd npm
need_cmd curl

if [[ "$SERVER_PORT" != "8080" ]]; then
  echo "[dev] warning: bt_editor Vite proxy is configured for http://localhost:8080." >&2
  echo "[dev] warning: use BT_SERVER_PORT=8080 unless you also update bt_editor/vite.config.ts." >&2
fi

echo "[dev] building bt_server and bt_nodes"

# 探测 ROS2：具备 /opt/ros/<distro> 或 ros2 命令时，一并构建 ROS2 适配节点插件，
# 让 bt_server 同时支持「普通行为树」和「ROS2 节点行为树」两种树。
BT_BUILD_ROS2_FLAG="-DBT_BUILD_ROS2=OFF"
ROS2_PLUGIN=""
if [[ -n "${ROS_DISTRO:-}" && -f "/opt/ros/$ROS_DISTRO/setup.bash" ]]; then
  ROS_SETUP_FILE="/opt/ros/$ROS_DISTRO/setup.bash"
elif [[ -f /opt/ros/humble/setup.bash ]]; then
  ROS_SETUP_FILE="/opt/ros/humble/setup.bash"
fi
if [[ -n "$ROS_SETUP_FILE" && -f "$ROS_SETUP_FILE" ]]; then
  source_ros_setup "$ROS_SETUP_FILE" || true
  BT_BUILD_ROS2_FLAG="-DBT_BUILD_ROS2=ON"
  ROS2_PLUGIN="$BUILD_DIR/lib/libbt_ros2_plugin.so"
  echo "[dev] ROS2 detected: $ROS_SETUP_FILE (building ROS2 plugin)"
else
  echo "[dev] ROS2 not detected; server 仅加载普通节点插件（BT_BUILD_ROS2=OFF）"
fi

cmake -S "$REPO_ROOT" -B "$BUILD_DIR" \
  -DBT_BUILD_NODES=ON \
  -DBT_BUILD_SERVER=ON \
  -DBT_BUILD_TESTS=ON \
  -DBT_BUILD_EXAMPLES=ON \
  "$BT_BUILD_ROS2_FLAG"

# 普通节点插件是基础；ROS2 插件在可用时附加。自研插件目录可另设 BT_PLUGIN_DIR。
cmake --build "$BUILD_DIR" --target bt_server bt_nodes
PLUGINS=()
NODES_PLUGIN="${BT_NODES_PLUGIN:-$(find_plugin || true)}"
if [[ -z "$NODES_PLUGIN" || ! -f "$NODES_PLUGIN" ]]; then
  echo "[dev] bt_nodes plugin not found under $BUILD_DIR/lib" >&2
  exit 1
fi
PLUGINS+=("$NODES_PLUGIN")
if [[ -n "$ROS2_PLUGIN" && -f "$ROS2_PLUGIN" ]]; then
  cmake --build "$BUILD_DIR" --target bt_ros2_plugin || \
    echo "[dev] 警告: bt_ros2_plugin 构建失败，跳过 ROS2 节点（普通节点仍可用）" >&2
  if [[ -f "$ROS2_PLUGIN" ]]; then
    PLUGINS+=("$ROS2_PLUGIN")
  fi
fi
if [[ ! -x "$SERVER_BIN" ]]; then
  echo "[dev] bt_server not found or not executable: $SERVER_BIN" >&2
  exit 1
fi
if [[ "${#PLUGINS[@]}" -eq 0 ]]; then
  echo "[dev] 没有可加载的节点插件" >&2
  exit 1
fi

cd "$REPO_ROOT/bt_editor"
if [[ ! -d node_modules ]]; then
  echo "[dev] installing frontend dependencies"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

SERVER_PID=""
FRONTEND_PID=""

cleanup() {
  local status=$?
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
    wait "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ROS_WEB_PID" ]] && kill -0 "$ROS_WEB_PID" >/dev/null 2>&1; then
    kill "$ROS_WEB_PID" >/dev/null 2>&1 || true
    wait "$ROS_WEB_PID" >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT INT TERM

echo "[dev] starting bt_server: http://$SERVER_HOST:$SERVER_PORT  (${#PLUGINS[@]} plugin(s))"
"$SERVER_BIN" "$SERVER_HOST" "$SERVER_PORT" "${PLUGINS[@]}" &
SERVER_PID=$!
wait_for_http "http://$SERVER_HOST:$SERVER_PORT/api/health" "bt_server" "$SERVER_PID"
start_ros_web

echo "[dev] starting editor: http://$FRONTEND_HOST:$FRONTEND_PORT"
npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

cat <<EOF
[dev] running
  backend:  http://$SERVER_HOST:$SERVER_PORT
  frontend: http://$FRONTEND_HOST:$FRONTEND_PORT
  ros graph: $ROS_WEB_STATUS

Press Ctrl-C to stop both processes.
EOF

while true; do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    wait "$SERVER_PID"
    exit $?
  fi
  if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    wait "$FRONTEND_PID"
    exit $?
  fi
  sleep 1
done
