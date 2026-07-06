# BehaviorTree.CPP-X

一个插件化、ROS 解耦的 C++17 行为树框架，包含内置节点插件、HTTP 后端、React 可视化编辑器和可选 ROS2 wrapper。

## 在线文档站

完整文档已发布到 GitHub Pages：**<https://lovelyyoshino.github.io/behavior_tree_cpp/>**

- `main` 分支维护源码与文档源（`docs/*.rst`）。
- HTML 站点由 GitHub Pages 从 `docs/_build/pages` 发布（`gh-pages` 分支 / `Settings -> Pages` 选 GitHub Actions），源码不直接作为发布产物。详见 [GitHub Pages 发布说明](docs/GITHUB_PAGES.md)。
- 本地预览：`./scripts/build_docs.sh && open docs/_build/html/index.html`。

站点包含 25 个内置节点目录、函数注册表手册，以及“单例 + 工厂 + 生成器引用函数”三模式回充教程（对应示例 `example_function_recharge`）。

## 内置节点与示例

- **25 个内置节点**：控制/装饰/动作/数据/时间/诊断/函数七类。新增 `Delay`（异步 RUNNING 演示）、`WaitUntilElapsed`（单调到时）、`BlackboardExists`、`ClearBlackboard`、`ScalarThreshold`（数值阈值门控）、`LogEvent`（分级日志）。端口详见 [节点目录](docs/node_catalog.rst)。
- **示例 3 `example_function_recharge`**：用单例 `FunctionRegistry` + 工厂 `NodeFactory` + 生成器引用函数演示“从（模拟）ROS2 `/battery_state` 拿电量 → 写黑板 → 判低电 → 发回充命令 → 通知完成”的完整闭环，本机无需 ROS2 即可跑通。

## 前置条件

- CMake 3.16+ 和支持 C++17 的编译器。
- Python 3 和 `curl`。
- Node.js/npm，用于 `bt_editor`。
- Sphinx，用于本地文档站；可用 `python3 -m pip install -r docs/requirements.txt` 安装。
- Playwright Chromium；`./scripts/bootstrap.sh` 会自动执行 `npx playwright install chromium`。

## 快速开始

```bash
./scripts/bootstrap.sh
./scripts/test.sh
```

运行最小示例：

```bash
./build/bin/example_embedded
./build/bin/example_load_xml ./build/lib/libbt_nodes.dylib examples/trees/patrol.xml
./build/bin/example_load_xml ./build/lib/libbt_nodes.dylib examples/trees/blackboard_data_flow.xml
./build/bin/example_function_recharge
```

Linux 下插件路径通常是 `./build/lib/libbt_nodes.so`。

## 一键启动编辑器

```bash
./scripts/dev.sh
```

脚本会构建 `bt_server` 和 `bt_nodes`，启动后端 `http://127.0.0.1:8080`，再启动 Vite 编辑器 `http://127.0.0.1:5173`。按 `Ctrl-C` 会清理两个子进程。

## 手动启动编辑器

终端 1：启动 C++ 后端并加载内置节点插件。

```bash
./build/bin/bt_server 127.0.0.1 8080 ./build/lib/libbt_nodes.dylib
```

终端 2：启动前端。

```bash
cd bt_editor
npm install
npm run dev
```

浏览器打开 Vite 输出的地址。前端会通过 `/api/health` 和 `/api/nodes` 连接后端。

## 验证命令

```bash
./scripts/test.sh
```

`scripts/test.sh` 会执行 C++ 配置/构建、`ctest`、后端 API smoke、ROS2 非真机语法/XML 检查、前端 Vitest、前端 build、Playwright E2E 和 Sphinx 文档构建。当前机器没有 ROS2 时，真实 `colcon`/`ros2 launch` 会被明确跳过。

也可以单独运行后端接口 smoke：

```bash
./scripts/smoke_server.sh
```

Playwright E2E 会 mock 当前编辑器 smoke 用到的后端端点，用于验证浏览器基础交互，不要求 C++ 后端在线；真实后端协议由 `scripts/smoke_server.sh` 启动 `bt_server` 单独覆盖。临时跳过 E2E 可用 `BT_SKIP_E2E=1 ./scripts/test.sh`。

预期成功标记包括：

- `ctest` 显示 `112/112` 通过。
- server smoke 输出 `negative API contracts ok` 和 `server smoke passed`（`/api/nodes` 枚举到 25 个内置节点）。
- Vitest 输出 `4 passed` / `13 passed`。
- 前端 `npm run build` 通过。
- Playwright 输出 `5 passed`。
- Sphinx 输出 `built: docs/_build/html/index.html`。
- 无 ROS2 环境时输出明确跳过真实 `colcon/ros2 launch`。

常用环境变量：

- `BT_BUILD_DIR=/path/to/build`：切换 C++ 构建目录。
- `BT_SERVER_PORT=18080`：切换后端端口；开发编辑器默认代理仍是 `8080`，改端口时需要同步改 `bt_editor/vite.config.ts`。
- `BT_NODES_PLUGIN=/path/to/libbt_nodes.*`：指定节点插件路径。
- `BT_TREE_WORKSPACE=/path/to/trees`：限制 `/api/trees`、`/api/tree/open`、`/api/tree/save` 的读写目录，默认 `examples/trees`。
- `BT_SKIP_E2E=1`：仅在本机浏览器问题时跳过 Playwright，不应作为完整验收。

本地文档站：

```bash
./scripts/build_docs.sh
open docs/_build/html/index.html
```

生成 GitHub Pages 干净发布目录：

```bash
./scripts/build_pages.sh
```

上传 `docs/_build/pages/` 目录内的内容即可。该目录会自动包含 `.nojekyll`，并排除 Sphinx 构建缓存、源码副本和 inventory 文件。详细说明见 [GitHub Pages 发布说明](docs/GITHUB_PAGES.md)。

刷新文档截图：

```bash
cd bt_editor
npm run screenshots
```

截图会写入 `docs/blog/screenshots/`，供 Sphinx 和 blog 文档引用；该命令不在默认 CI 中运行，避免普通测试修改图片文件。

## ROS2 回充示例

代码入口：

- `bt_ros2/include/bt_ros2/example_data_nodes.hpp`：`ReadBattery`、`PublishRechargeCommand`、`IsDocked`、`TaskDoneNotifier`。
- `bt_ros2/include/bt_ros2/node_registration.hpp`：默认注册器，集中注册 bt_nodes、ROS topic 节点、数据节点和回充节点。
- `bt_ros2/trees/recharge.xml`：外部电量消息驱动回充的完整 XML。
- `docs/tutorial/ROS2_RECHARGE_TUTORIAL.md`：逐步教程。

真实 ROS2 环境运行：

```bash
source /opt/ros/$ROS_DISTRO/setup.bash
colcon build --packages-select bt_ros2
source install/setup.bash
ros2 launch bt_ros2 bt_executor.launch.py \
  tree_file:=$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml \
  stop_on_terminal:=false
```

当前机器没有 ROS2/rclcpp/colcon，因此 ROS2 实机编译和 topic 收发未在本机执行；非 ROS mock 测试已覆盖数据链路。

## 手册与文档

- [文档导航](docs/README.md)
- [函数手册：节点、端口、工厂与 ROS2 数据流](docs/manual/FUNCTION_MANUAL.md)
- [行为树脚本风格规范](docs/design/TREE_SCRIPT_STYLE.md)
- [Sphinx 文档站源码](docs/index.rst)
- [ROS2 回充教程](docs/tutorial/ROS2_RECHARGE_TUTORIAL.md)
- [架构设计](docs/design/architecture.md)
- [API 契约](docs/design/API_CONTRACT.md)
- [ROS2 数据接口契约](docs/design/ROS2_DATA_INTERFACE.md)
- [完整工程笔记](docs/blog/README.md)
- [项目计划](PROJECT_PLAN.md)

## 目录

```text
bt_core/    核心库，零 ROS 依赖
bt_nodes/   内置节点插件，含数据节点和 FunctionRegistry 函数节点
bt_server/  cpp-httplib HTTP 后端
bt_editor/  React + React Flow 可视化编辑器，含 Playwright E2E
bt_ros2/    可选 ROS2 wrapper、数据节点和回充示例
docs/       手册、教程、设计文档
examples/   C++ 示例程序和可运行 XML 示例树
tests/      GoogleTest + mock rclcpp 非 ROS 测试
```
