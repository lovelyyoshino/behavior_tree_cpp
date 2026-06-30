# BehaviorTree.CPP-X

一个**插件化、ROS 解耦**的 C++ 行为树框架，带 Web 可视化编辑器与可选 ROS2 wrapper。

- 🧩 **核心零依赖**：`bt_core` 纯 C++17，可嵌入任何程序
- 🔌 **节点热插拔**：节点编译成动态库，运行时加载自注册，加节点不重编主程序
- 🎨 **Web 可视化编辑器**：React + React Flow，拖拽建树、导入导出、运行态高亮
- 🤖 **ROS2 可选封装**：`bt_ros2` 独立包，核心库对 ROS 完全无感知

## 快速开始

```bash
cmake -S . -B build -DBT_BUILD_NODES=ON -DBT_BUILD_SERVER=ON -DBT_BUILD_TESTS=ON
cmake --build build
ctest --test-dir build --output-on-failure
./build/bin/example_embedded
```

## 文档

- 📖 **[完整工程笔记（blog 形式）](docs/blog/README.md)** ← 从这里开始
- 🏛 [架构设计](docs/design/architecture.md)
- 📋 [API 契约](docs/design/API_CONTRACT.md)
- 🗺 [项目计划与进度](PROJECT_PLAN.md)

## 目录

```
bt_core/    核心库（零 ROS 依赖）        bt_server/  HTTP 服务（编辑器后端）
bt_nodes/   内置节点插件                bt_editor/  React 可视化编辑器
bt_ros2/    ROS2 wrapper（可选）        examples/   示例 · tests/ 单元测试
```

详见 [docs/blog/README.md](docs/blog/README.md)。
