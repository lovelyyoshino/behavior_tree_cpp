# BehaviorTree.CPP-X 项目计划表

> 一个插件化、ROS 解耦的 C++ 行为树框架，附带可视化编辑器与 ROS2 wrapper。

---

## 1. 需求拆解（对照你的 4 点要求）

| # | 你的要求 | 框架对应模块 | 关键技术点 |
|---|---------|------------|-----------|
| 1 | 可视化控制树节点，插件式增删节点 + 连线 | `bt_editor` | 节点画布、拖拽、连线、属性面板、保存/加载树文件 |
| 2 | 完全不依赖 ROS，可独立运行，可封装 ROS2 wrapper | `bt_core` + `bt_ros2` | 核心库零 ROS 依赖；`bt_ros2` 作为可选独立包 |
| 3 | 每个状态/节点插件式插入，快速扩展，易维护 | `bt_core` 工厂 + `bt_nodes` | 节点注册工厂 + 运行时动态库加载 + 注册宏 |
| 4 | 充足代码注释 + 详细 README（blog 形式） | `docs/` | Doxygen 风格注释 + blog 式使用文档 |

---

## 2. 项目结构

```
behavior_tree_cpp/
├── bt_core/            # 核心库（零 ROS 依赖，纯 C++17）
│   ├── include/bt_core/
│   │   ├── tree_node.hpp        # 节点基类 + NodeStatus 枚举
│   │   ├── blackboard.hpp       # 黑板（节点间数据共享）
│   │   ├── control_node.hpp     # 控制节点基类
│   │   ├── decorator_node.hpp   # 装饰节点基类
│   │   ├── leaf_node.hpp        # 叶子（Action/Condition）基类
│   │   ├── node_factory.hpp     # 节点注册工厂
│   │   ├── plugin_loader.hpp    # 动态库插件加载器
│   │   ├── tree.hpp             # 树容器 + tick 调度
│   │   └── xml_parser.hpp       # 树文件序列化/反序列化
│   └── src/...
├── bt_nodes/           # 内置标准节点（以插件形式提供）
│   ├── control/        # Sequence / Fallback / Parallel
│   ├── decorator/      # Inverter / Retry / Repeat / Timeout
│   └── action/         # 示例 Action / Condition
├── bt_editor/          # 可视化编辑器（技术栈待定，见决策点）
├── bt_ros2/            # ROS2 wrapper（独立可选包）
├── examples/           # 示例树 + 示例插件
├── tests/              # 单元测试（GoogleTest / Catch2）
├── docs/
│   ├── design/         # 架构设计文档
│   └── blog/           # blog 式 README 与教程
├── cmake/              # CMake 模块
└── CMakeLists.txt
```

---

## 3. 分阶段计划（Spec DAG）

### Phase 0 — 设计与脚手架 ✅（进行中）
- [x] 目录骨架
- [x] 计划表
- [ ] 架构设计文档（`docs/design/architecture.md`）
- [ ] 顶层 CMake + 工具链配置
- **验收证据**：目录树 + 设计文档 + `cmake` 配置可生成

### Phase 1 — bt_core 核心库
- [ ] `NodeStatus`（IDLE/RUNNING/SUCCESS/FAILURE）
- [ ] `TreeNode` 基类（tick/halt/状态机）
- [ ] `Blackboard`（类型安全的 KV 存储，端口机制）
- [ ] `ControlNode` / `DecoratorNode` / `LeafNode` 基类
- [ ] `NodeFactory`（注册 + 创建）
- [ ] `Tree` 容器 + tick 循环
- **验收证据**：单元测试通过（`ctest` 输出）

### Phase 2 — 插件系统
- [ ] 注册宏 `BT_REGISTER_NODES`
- [ ] `PluginLoader`（dlopen / LoadLibrary 跨平台动态加载）
- [ ] 内置节点编译成插件 `.so/.dll/.dylib`
- **验收证据**：运行时加载外部插件 `.so` 并构建出可 tick 的树

### Phase 3 — 序列化（树文件）
- [ ] XML/JSON parser（决策点 2）
- [ ] 树定义文件 ↔ 内存树双向转换
- **验收证据**：保存树 → 重新加载 → 结构一致

### Phase 4 — 可视化编辑器
- [ ] 节点面板（从工厂动态列出可用节点）
- [ ] 画布拖拽 + 连线
- [ ] 属性面板（编辑端口/参数）
- [ ] 保存/加载（复用 Phase 3 格式）
- [ ] 可选：实时 tick 状态高亮（监控运行中的树）
- **验收证据**：截图 / 录屏，建树 → 导出 → core 加载运行

### Phase 5 — ROS2 wrapper
- [ ] `bt_ros2` 独立 colcon 包
- [ ] ROS2 Action/Service/Topic ↔ BT 节点适配器
- [ ] BT 执行节点（rclcpp Node 封装 tick 循环）
- **验收证据**：`colcon build` 通过 + 一个 ROS2 demo 节点跑通

### Phase 6 — 文档与示例
- [ ] Doxygen 注释覆盖
- [ ] blog 式 README（架构讲解 + Quick Start + 写自定义节点教程）
- [ ] 完整示例工程
- **验收证据**：README 可跟随复现

---

## 4. 技术选型基线
- **语言标准**：C++17（兼顾动态加载与现代特性）
- **构建系统**：CMake ≥ 3.16
- **测试框架**：GoogleTest（待定，也可 Catch2）
- **核心库依赖**：零第三方强依赖（仅标准库 + 平台 dl API）

---

## 5. 关键决策（已确认 2026-06-30）

| 决策点 | 选择 | 影响 |
|--------|------|------|
| 编辑器技术栈 | **Web 前端 React + TypeScript + React Flow** | `bt_core` 暴露一个轻量 HTTP/WebSocket 服务（`bt_server`），前端通过 REST/WS 拉取节点清单、导入导出树、订阅运行时 tick 状态。前后端解耦，可独立维护。 |
| 序列化格式 | **XML（兼容 BehaviorTree.CPP / Groot）** | `bt_core` 用轻量 XML 库（tinyxml2，置于 `third_party/`）。树文件可与现有 BT 生态互通。 |
| 插件加载 | **运行时动态库（dlopen / LoadLibrary）** | 节点编译成 `.so/.dll/.dylib`，运行时加载自注册；加新节点无需重编主程序。core 封装跨平台 `PluginLoader`。 |

### 架构连带影响
- 编辑器与 core 通过 **进程边界 + HTTP/WS** 通信 → 新增 `bt_server` 子模块（基于轻量 header-only HTTP 库，如 cpp-httplib）。
- 节点元信息（端口名、类型、默认值）需要可被前端枚举 → `NodeFactory` 维护 **节点 manifest**（节点名 + 端口描述），通过 `/nodes` 接口暴露。

### 修订后的模块清单
```
bt_core/    核心库（零 ROS 依赖）
bt_nodes/   内置节点插件
bt_server/  HTTP/WS 服务（暴露给 Web 编辑器）   ← 新增
bt_editor/  React + TS + React Flow 前端          ← Web 方案
bt_ros2/    ROS2 wrapper（可选独立 colcon 包）
```

---

## 6. 当前进度（全部完成）
- [x] Phase 0：目录骨架、计划表、决策固化、架构文档、顶层 CMake
- [x] Phase 1：bt_core 核心地基（NodeStatus/TreeNode/Blackboard/三大族/NodeFactory/Tree）
- [x] Phase 2：插件系统（BT_REGISTER_NODES 宏 + 跨平台 PluginLoader）
- [x] Phase 3：XML 序列化（tinyxml2 + XmlParser，私有端口语义）
- [x] Phase 4：bt_server HTTP 服务（7 接口 + 插件加载 + tick 序列回放）
- [x] Phase 5：bt_editor React 前端（npm build 通过 + 浏览器活体验证）
- [x] Phase 6：bt_ros2 wrapper（结构/语法验证 + cmake find_package 集成）
- [x] Phase 7：内置节点 bt_nodes（17 节点：控制 3 + 装饰 5 + 动作/条件 3 + 数据 6）+ 示例 + blog README
- [x] Phase 8：ROS2 数据接入可复用接口（RosConditionNode<MsgT> / RosInputNode<MsgT> + data_freshness 纯逻辑 + 4 个开箱即用范例节点）
- [x] Phase 9：6 个数据录入状态节点（SetBlackboard/SetBool/CompareBlackboard/CheckBool/Counter/CooldownCondition）+ test_data_nodes 单测 + NODES_AND_DATA blog 文档
- [x] Phase 10：vendor GoogleTest v1.15.2 到 third_party/，ctest 构建彻底零网络依赖

### 验证总证据
- 全量构建：10 target，我方代码 0 error / 0 warning（已 vendor GoogleTest）
- ctest：**100% tests passed, 0 tests failed out of 53**（0.33s，离线可复现）
- 示例 1/2 运行正确；跨模块联调（server 加载 bt_nodes 插件 + HTTP）实测通过
- 编辑器活体验证：节点加载/建树/Tick 运行态高亮/导入导出全闭环（截图存档）
- cmake install/export 验证：下游独立项目 find_package(bt_core) + link bt::core 编译运行 exit=0
- 修复 3 个集成期真实 bug：插件析构顺序段错误、同名端口字面量覆盖、编辑器/服务器 id 空间不匹配导致运行态不上色

### 待用户环境验证
- bt_ros2：本机无 ROS2，需 humble/jazzy 环境 `colcon build` 实测；接口契约见 `docs/design/ROS2_DATA_INTERFACE.md`
- bt_editor：`npm run dev` 联调（前端 build + 浏览器活体均已通过）
