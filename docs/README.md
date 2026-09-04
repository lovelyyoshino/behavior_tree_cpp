# BehaviorTree.CPP-X 文档导航

这组文档按“怎么开发、怎么使用、怎么验证”组织，而不是按源码目录堆叠。

## 推荐阅读顺序

1. [根 README](../README.md)：一键启动、构建、测试入口。
2. [行为树基础](behavior_tree_basics.rst)：四种基本控制节点、四态语义、tick 机制、黑板与端口；含可跑示例、Web 编辑器搭建和 GitHub Actions/Pages 发布流程。第一次接触行为树从这里开始。
3. [Sphinx 文档站入口](index.rst)：可本地构建的查询型文档。
4. [函数手册](manual/FUNCTION_MANUAL.md)：节点工厂、黑板端口、内置节点、`FunctionRegistry`、ROS2 数据节点的开发/调用方式。
5. [行为树脚本风格规范](design/TREE_SCRIPT_STYLE.md)：XML 命名、黑板 key、`SubTree` 拆分和 formatter 稳定性。
6. [ROS2 回充教程](tutorial/ROS2_RECHARGE_TUTORIAL.md)：外部 `sensor_msgs/BatteryState` 消息如何进入黑板，并触发回充命令发布。
7. [ROS2 能力与 5173 编辑器](ros2_editor_capabilities.rst)：启动本机 bridge、自动读取实时 ROS graph，并判断 Yuyi 节点的设计/执行边界。
8. [架构设计](design/architecture.md)：核心库零 ROS 依赖、插件与编辑器边界。
9. [API 契约](design/API_CONTRACT.md)：`bt_core` 代码接口约束。
10. [ROS2 数据接口契约](design/ROS2_DATA_INTERFACE.md)：订阅/发布基类和新鲜度逻辑。
11. [工程笔记](blog/README.md)：更完整的项目 walkthrough。
12. [商用发布检查表](COMMERCIAL_RELEASE_CHECKLIST.md)：区分工程 gate 与 owner/legal gate。
13. [GitHub Pages 发布说明](pages_deployment.rst)：静态站点产物、Environment 分支规则和部署故障处理。

## 关键能力对应文件

| 能力 | 入口文件 |
|---|---|
| 行为树核心、黑板、工厂 | `bt_core/include/bt_core/*.hpp` |
| 内置插件节点 | `bt_nodes/**` |
| 普通 C++ 函数引用式节点 | `bt_nodes/function/function_registry.hpp` |
| Web 编辑器 | `bt_editor/**` |
| HTTP 编辑器后端 | `bt_server/src/main.cpp` |
| ROS2 执行器 | `bt_ros2/src/bt_executor_node.cpp` |
| ROS2 数据录入/发布基类 | `bt_ros2/include/bt_ros2/ros_subscriber_node.hpp`, `ros_publisher_node.hpp` |
| ROS2 回充示例树 | `bt_ros2/trees/recharge.xml` |
| 可运行 XML 示例 | `examples/trees/minimal_sequence_fallback.xml`, `examples/trees/blackboard_data_flow.xml`, `examples/trees/subtree_reuse.xml`, `examples/trees/subtree_plus_blackboard.xml` |
| 非 ROS 测试 | `tests/**` |
| Playwright E2E | `bt_editor/e2e/editor.spec.ts`, `responsive.spec.ts`, `live-backend.spec.ts` |
| 文档截图 spec（默认不进常规 E2E） | `bt_editor/e2e/docs-screenshots.spec.ts`（01-04）, `basics-screenshots.spec.ts`（15-17）, 门禁 `check-screenshot-hashes.mjs` |

## 验证命令

```bash
./scripts/test.sh
```

单独构建 Sphinx 文档站：

```bash
./scripts/build_docs.sh
```

生成 GitHub Pages 干净发布目录：

```bash
./scripts/build_pages.sh
```

只上传 `docs/_build/pages/` 目录内的内容；详细包含/排除规则见 [GitHub Pages 发布说明](pages_deployment.rst)。

刷新文档截图（同时产出 `docs-screenshots` 的 01-04 和 `basics-screenshots` 的 15-17，并跑 hash 门禁）：

```bash
cd bt_editor
npm run screenshots
```

只校验不重新生成：

```bash
cd bt_editor
npm run screenshots:check
```

`05`-`14` 是早期手工补充的图片，没有生成 spec，不在门禁清单内。新增配图请写进 spec 并登记到 `e2e/check-screenshot-hashes.mjs`。

当前机器已按回充教程跑通 ROS2 Humble 的构建、launch、service 和单次 topic 事件闭环；
无 ROS2 环境的机器只运行默认非 ROS gate，并明确保留环境限制说明。
