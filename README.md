# BehaviorTree.CPP-X

一个插件化、ROS 解耦的 C++17 行为树框架，包含内置节点插件、HTTP 后端、React 可视化编辑器和可选 ROS2 wrapper。

## 文档站

GitHub Pages 目标地址：**<https://lovelyyoshino.github.io/behavior_tree_cpp/>**

- `main` 分支维护源码与文档源（`docs/*.rst`）。
- HTML 站点由 GitHub Actions 从 `docs/_build/pages` 发布；`Settings -> Pages` 的 Source 选择 `GitHub Actions`，且 `github-pages` Environment 必须允许 `main` 部署。源码和 `gh-pages` 分支都不是当前自动发布源。详见 [GitHub Pages 发布说明](docs/pages_deployment.rst)。
- 本地预览：`./scripts/build_docs.sh && open docs/_build/html/index.html`。

如果目标地址尚未更新，而 Pages workflow 的构建阶段已经成功，请先修复
`github-pages` Environment 的分支规则，再重跑失败的部署 job；这不是文档构建失败。

站点包含 34 个运行时内置节点的完整契约、编辑器原生 `SubTree`/`SubTreePlus` 结构节点、函数注册表手册、多树调度、严格 XML 迁移说明、真实/模拟 Playwright 验证，以及基于状态化 `RechargeTask` 的 ROS2 回充教程。

## 内置节点与示例

- **34 个内置节点**：控制/装饰/动作/数据/时间/诊断/函数七类；`PrioritySelector` 负责输入优先级和抢占，`TickRate` 负责 critical/normal/background 分级 tick。端口详见 [节点目录](docs/node_catalog.rst)，组合方式见 [单树调度](docs/scheduling.rst)。
- **Yuyi 风格兼容示例**：`examples/trees/subtree_plus_blackboard.xml` 展示
  `SubTreePlus` 黑板映射、`Parallel` 外部阈值命名和 XML 启动初值，可直接用 `example_load_xml` 运行。
- **示例 3 `example_function_recharge`**：用单例 `FunctionRegistry` + 工厂 `NodeFactory` + 函数引用演示同步业务调用链，本机无需 ROS2 即可运行。真实机器人回充使用 `RechargeTask` 处理“发布一次、跨 tick 等 dock、超时、halt/retry”。

### 黑板端口速记

- `key` / `output_key` 填的是黑板键名本身，例如 `mission_count`，**不加 `{}`**。
- 普通端口填 `hello`、`42` 是当前节点的字面量，不进入共享黑板。
- 普通输入/输出端口填 `{mission_count}` 才表示把该端口连接到黑板键。

例如 `<Counter key="mission_count"/>` 会创建或累加黑板整数；
`<ReadScalar value="{temperature}" .../>` 会通过输出端口把 ROS2 标量写入
`temperature`，随后用 `<ScalarThreshold key="temperature" .../>` 读取。
完整规则、类型说明和 XML 示例见 [节点目录：端口值与黑板 key](docs/node_catalog.rst)。

### 属性面板怎么读

选中画布节点后，属性面板按节点 manifest 展示四层信息：节点用途、状态/失败契约、端口方向与类型、当前 XML 属性。普通输入端口用“固定值 / 读取黑板”切换；输出端口直接填写目标黑板键，面板会生成 `{key}`；`key`、`output_key`、`*_key` 端口默认是“键名本身”，例如 `mission_count`，只有需要二级索引时才切换为“动态键名”。

节点作者可以在类型中补充可选的 `providedDocumentation()`，编辑器会自动显示用途、使用位置、状态语义、失败边界和最小 XML，不需要在前端再维护一份节点白名单：

```cpp
static bt_core::NodeDocumentation providedDocumentation() {
  return {
      "读取 ROS2 数据并写入黑板",
      "输出端口 value 绑定为 {temperature}，下游用 key=\"temperature\" 读取",
      "新鲜消息 SUCCESS，无新鲜消息 RUNNING",
      "topic 无效或超时会阻塞/失败",
      R"(<ReadScalar topic="/temperature" value="{temperature}"/>)"};
}
```

普通旧插件没有该函数也能继续运行，面板会使用端口描述和节点类型的通用回退说明。

### 编辑器里的黑板参数面板

工具栏的“导入树 + 黑板”接受原始 `.xml` 和 `.bt.json` 配置包。XML 中的多个
`BehaviorTree`、`main_tree_to_execute`、`SubTreePlus` 映射和
`TreeNodesModel/Blackboard` 会一起恢复；导入后可以直接点击 Run。配置包同时保存 XML 和
`blackboard` 数组，导入时两份值必须完全一致，否则编辑器拒绝载入，避免出现两个真相源。

工具栏的“黑板参数”用于填写当前运行树的**启动初值**。点击“新增参数”后填写键名、
类型（`string`、`bool`、`int`、`double`）、初始值和说明；点击“载入到服务器”或“Run”
时，编辑器只提交已经绑定这些值的完整 XML，后端在解析
`TreeNodesModel/Blackboard` 时一次性创建 typed 初值，不再额外调用
`POST /api/tree/blackboard`。
空键名、重复键名和非法类型值会在浏览器内拦截，不会发出加载请求。

绑定后的 XML 使用兼容的 `TreeNodesModel/Blackboard` 元数据区：

```xml
<root main_tree_to_execute="MainTree">
  <TreeNodesModel>
    <Blackboard>
      <Entry key="temperature" type="double" value="25.5"
             description="启动测试值"/>
    </Blackboard>
  </TreeNodesModel>
  <BehaviorTree ID="MainTree">
    <ReadScalar topic="/temperature" value="{temperature}"/>
  </BehaviorTree>
</root>
```

`Entry` 保存可迁移的启动初值，`value="{temperature}"` 表示节点端口连接到同名运行时键；
对于需要在首拍读取的输入，通常应同时配置这两部分。输出端口或 ROS2 输入节点也可以只配置
`{temperature}`，由运行时第一次写入该键，不必伪造一个静态初值。`bt_core::XmlParser` 载入 XML
时会创建 typed 初值，再次格式化或从服务器导出也会保留它们。把另一份 XML 载入同一个 ROS2
executor 时，新的 `TreeNodesModel/Blackboard` 会**替换**旧的启动初值；没有该元数据则清除旧初值，
但不会删除 ROS node 句柄等非初值运行时对象。ROS2 输入节点 tick 后仍可覆盖运行时 `temperature`，
但实时传感器值不会反写到启动配置，避免把一次运行的数据误当成下一次默认值。浏览器
`localStorage` 仍用于刷新后恢复未导出的草稿。

除黑板外，编辑器也会把当前多树文档的节点、连线、画布位置、主树 ID 和当前标签统一保存到
`localStorage` 的 `bt-editor.document.v1`；浏览器刷新会从这一份完整文档恢复工作现场，不再单独
维护第二份黑板草稿。旧版 `bt-editor.blackboard.v1` 只在没有完整文档草稿时迁移一次。浏览器草稿
只属于当前机器，跨机器迁移请使用“下载 XML”或“导出树 + 黑板”。

例如面板里的 `duration_ms = 1000 (int)` 会导出为 `<Entry key="duration_ms" type="int"
value="1000"/>`；只有把某个节点端口切到“读取黑板”并填写 `duration_ms` 后，节点 XML
才会出现 `duration_ms="{duration_ms}"`。其中 `{duration_ms}` 是运行时键引用，`1000` 是启动初值。

### 多树与 Yuyi 风格构建

编辑器顶部的“树定义”栏对应 XML 中的多个 `<BehaviorTree ID="...">`。当前定义显示在画布中，
“新增子树”会创建一个空定义；切换标签即可分别搭建主树和复用子树，输入 ID 可以重命名，
“设为主树”会更新 `root main_tree_to_execute`。节点面板中的 `SubTree` 和 `SubTreePlus` 是
编辑器原生结构节点，不需要把它们当成 Yuyi 业务节点写死：

```xml
<root main_tree_to_execute="Production">
  <TreeNodesModel><Blackboard>
    <Entry key="route_name" type="string" value="zone1"/>
  </Blackboard></TreeNodesModel>
  <BehaviorTree ID="Production">
    <Sequence>
      <SubTreePlus ID="WorkStage" route="{route_name}"/>
    </Sequence>
  </BehaviorTree>
  <BehaviorTree ID="WorkStage">
    <LoadYuyiPath path_file="config/trajectories/work.yaml" route="{route}"/>
  </BehaviorTree>
</root>
```

`SubTreePlus` 的 `ID` 指向树定义栏中的标签；`route` 等映射属性可在属性面板通过“新增自定义
XML 属性”填写，值用 `{parent_key}` 绑定黑板。所有树定义、调用点和黑板初值会一起预览、校验、
下载和从服务器导入。服务器运行时会展开子树执行，但 `/api/tree/export` 和 `/api/tree/format`
会保留多树定义及原始 `SubTreePlus` 调用，不再把它们静默变成一棵展开树。

`SubTreePlus` 的映射值必须是完整的 `{blackboard_key}`，不能填普通字面量；否则后端会在
载入阶段明确报错，而不是静默丢掉映射。`SubTree`/`SubTreePlus` 可以填写可选的 XML `name`
实例名，其他属性只能用于 `SubTreePlus` 的黑板映射。编辑器会为 `ID` 提供当前树定义的
候选列表，仍允许手工输入尚未创建的 ID，便于先搭调用点再补子树。

Yuyi 专用的 `RunOnZoneTransition`、`FollowPath`、`LoadYuyiPath` 和业务 action 等仍由
运行时插件提供 manifest、`providedPorts()` 和注册逻辑；通用 `Trigger`/`SetBool` service
可直接使用默认 `CallTriggerService` / `CallSetBoolService`。编辑器只保存注册名、类别和 XML 属性，
因此不会把某个项目的业务字段绑定死在前端。导入 XML 时，如果节点尚未出现在 manifest，
属性面板会允许修正它是 Control、Decorator 还是叶子节点；这个选择只影响画布连线约束，
最终执行类型仍以 C++ 插件注册为准。

对于还没有运行时 manifest 的 Yuyi 节点，选中自定义节点后可以在属性面板的“自定义端口契约”
区声明 `path_file`、`frame_id`、`path`、`result` 等端口。每个声明可填写端口方向
（输入/输出/双向）、类型、默认值和说明：输出端口会自动切换为黑板写入模式，例如
`result` 填 `route_path` 后 XML 会生成 `result="{route_path}"`。这些声明属于编辑器设计元数据，
会随浏览器草稿保留；XML 只保存属性值，最终执行前仍必须让 Yuyi/ROS2 插件的
`providedPorts()` 声明同名、同方向端口。这样可以先搭建完整生产树，再按插件 manifest 做运行时校验，
而不需要把某个项目的端口名写死在通用编辑器中。

### 从编辑器导出

先把树连接成唯一根节点并填写黑板参数，然后在底部“XML 脚本预览”使用：

- **下载 XML**：得到 `behavior_tree.xml`，其中已经包含全部树定义、`SubTreePlus` 调用、端口 `{key}` 映射和黑板初值。
- **导出树 + 黑板**：得到 `behavior_tree.bt.json`，额外提供版本化 JSON 包，便于应用层校验和迁移；
  如果树中有未被当前运行时 manifest 覆盖的自定义 Yuyi 端口，还会保存 `editor_manifests`，换机器
  导入后仍能恢复 typed 输入/输出控件。
- **复制**：只复制当前完整 XML；不需要后端在线。

点击“后端格式化”时，编辑器会校验返回 XML 中的黑板快照是否与面板一致；旧后端或 ROS 网关
若漏回 `TreeNodesModel/Blackboard`，预览会自动回退到当前画布序列化结果并保留全部 `Entry`，
不会出现“面板有参数、XML 没参数”的不一致。

下载的 XML 可以直接交给本项目解析器：

```bash
./build/bin/example_load_xml ./build/lib/libbt_nodes.so behavior_tree.xml
```

ROS2 执行器同样读取这份 XML；前提是 XML 使用到的自定义节点已在 executor 中注册。

`POST /api/tree/blackboard` 仍保留给调试工具在树已载入后更新单个初值，但编辑器的标准
导入、载入和 Run 流程不使用它：

```bash
curl -X POST http://127.0.0.1:8080/api/tree/blackboard \
  -H 'Content-Type: application/json' \
  -d '{"key":"temperature","type":"double","value":"25.5","description":"启动测试值"}'
```

返回 `404` 表示当前进程还没有树，返回 `400` 通常是类型或值格式错误。ROS2-aware 网关若要
提供同一面板，应实现同名语义的黑板初始化接口；普通 `bt_server` 不会伪造 ROS2 graph。

## 前置条件

- CMake 3.16+ 和支持 C++17 的编译器。
- Python 3 和 `curl`。
- Node.js/npm，用于 `bt_editor`。
- Sphinx，用于本地文档站；可用 `python3 -m pip install -r docs/requirements.txt` 安装。
- Playwright Chromium；`./scripts/bootstrap.sh` 会自动执行 `npx playwright install chromium`。
- 发布 gate 使用 POSIX Bash，支持 Linux/macOS；Windows 请在 WSL 的 Linux 工具链中运行。原生 PowerShell/CMD 未验证。

## 快速开始

```bash
./scripts/bootstrap.sh
./scripts/test.sh
```

运行最小示例：

```bash
./build/bin/example_embedded
./build/bin/example_load_xml ./build/lib/libbt_nodes.so examples/trees/patrol.xml
./build/bin/example_load_xml ./build/lib/libbt_nodes.so examples/trees/blackboard_data_flow.xml
./build/bin/example_function_recharge
```

Linux 下插件路径通常是 `./build/lib/libbt_nodes.so`，macOS 是 `.dylib`；多配置构建还可能位于 `Release/` 子目录。

## 一键启动编辑器

```bash
./scripts/dev.sh
```

脚本会构建 `bt_server` 和 `bt_nodes`，启动后端 `http://127.0.0.1:8080`、ROS2 graph bridge（若环境可用）和 Vite 编辑器 `http://127.0.0.1:5173`。按 `Ctrl-C` 会清理它托管的子进程。

编辑器中的推荐顺序：导入树 + 黑板（或绘制画布）→ 后端校验 → 载入到服务器 → 连续 Tick。Tick 不会
自动重载，否则 `RUNNING`、`Counter`、`Retry` 的跨拍状态会丢失。Run 会先自动同步当前
画布，再从头运行到终态。若 Tick 返回 `404 当前没有已加载的树`，先点击“载入到服务器”；
若 Run 仍报告路由 404，通常是旧前端或旧后端进程，停止后重新执行 `./scripts/dev.sh`。

## 手动启动编辑器

终端 1：启动 C++ 后端并加载内置节点插件。

```bash
./build/bin/bt_server 127.0.0.1 8080 ./build/lib/libbt_nodes.so
```

终端 2：启动前端。

```bash
cd bt_editor
npm install
npm run dev
```

浏览器打开 Vite 输出的地址。`./scripts/dev.sh` 会自动探测 ROS2：如果当前环境有 `rclpy`，
它会托管仓库源码中的 `bt_web.py`（已安装 `bt_ros2` 包时优先使用 `ros2 launch`），因此不需要
用户再开一个终端手动启动 bridge。前端通过 `/api/health` 和 `/api/nodes` 连接树后端，并自动读取
`/ros-api/api/v1/bt/capabilities`；bridge 未启动时每 5 秒重试，连接后每 3 秒刷新 ROS graph。
不需要填写能力 URL。设置 `BT_ROS_WEB_MODE=off` 可关闭自动 bridge，设置为 `on` 可将 bridge
启动失败变成明确的脚本错误。

非 Humble 环境可指定 ROS 环境脚本；如果 `bt_ros2` 是本仓库构建的 overlay，`scripts/dev.sh`
会自动 source `install_ros2/setup.bash`，也可以显式指定：

```bash
BT_ROS_SETUP_FILE=/opt/ros/jazzy/setup.bash ./scripts/dev.sh
```

```bash
BT_ROS_SETUP_FILE=/opt/ros/jazzy/setup.bash \
BT_ROS_OVERLAY_FILE="$PWD/install_ros2/setup.bash" ./scripts/dev.sh
```

bridge 启动失败时脚本会把完整输出写入 `/tmp/bt_ros_web.log`（可用
`BT_ROS_WEB_LOG_FILE=/path/to/bridge.log` 覆盖），并在终端显示最后 20 行。常见的
`Package not found` 是 overlay 未加载；`Operation not permitted` 则通常是当前运行环境禁止
DDS/HTTP socket，换到允许本机网络的桌面终端即可。

脚本本身使用严格的 Bash `nounset` 模式，但会在加载 ROS/colcon setup 时临时关闭该选项；
因此不会再因 `AMENT_TRACE_SETUP_FILES` 或 `COLCON_TRACE` 未定义而中断。正常情况下直接运行
`./scripts/dev.sh` 即可，不需要手动执行 `set +u` 或重复 source setup。

## 验证命令

```bash
./scripts/test.sh
```

`scripts/test.sh` 是强制的非 ROS 发布 gate，按当前源码构建并验证：

- Release 全量 CTest、五棵 XML 示例和函数注册表示例。
- ASan/UBSan 下的 `PluginRuntime` 回滚与跨工厂生命周期测试。
- 安装后的 SDK 外部 consumer，以及真实 `bt_server` 正/负 HTTP 契约。
- ROS2 launch 语法与包/树 XML；真实 Humble 数据流按下方回充教程验收。
- Vitest、生产前端 build、已提交截图 hash、桌面/平板/手机 mocked Chromium 连续三次、真实后端 Chromium、临时目录截图生成/hash。
- Sphinx HTML 和 linkcheck，二者均把 warning 当 error。

发布 gate 不允许 `BT_SKIP_E2E=1`，避免把浏览器缺口误报为完整通过。

默认 Playwright 用 mocked API 验证浏览器主流程、离线恢复、manifest 重试、编辑生命周期、HTTP 500 告警和 1280/768/390 宽度下的可达性；触控视口可点击节点条目创建节点，不依赖 HTML5 drag。live 项目把生产 preview 代理到本次 Release 构建的 `bt_server + libbt_nodes`，验证 34 个真实 manifest、调度节点端口、load/validate/tick、清空后导回、Run 和严格 XML 错误。

预期成功标记包括：

- fresh Release CTest 显示 100% 通过；以本次配置输出为准，不固化历史总数。
- 真实 server API 的成功/错误契约全部通过，`/api/nodes` 枚举到 34 个内置节点，并完成优先级/tick 分级树的加载和单拍。
- Vitest 输出 `4 files passed` / `25 tests passed`。
- 前端 `npm run build` 通过。
- mocked Chromium 数量以当次 Playwright 输出为准，关键路径连续三轮；live-backend Chromium `1 passed`。
- 临时截图用例 `1 passed`，四张 PNG 的签名、尺寸和 SHA-256 通过；Linux gate 还要求与已提交文档图逐字节一致。
- CI 中任何 retry-pass 都按 flaky 失败；HTML 报告、trace、失败截图和临时文档截图作为矩阵平台 artifact 保留 14 天。
- Sphinx 输出 HTML built 和 `linkcheck passed`。
- 无 ROS2 环境时明确记录未运行真实 `colcon/ros2 launch`，不把环境缺失当作通过。

常用环境变量：

- `BT_BUILD_DIR=/path/to/build`：切换 C++ 构建目录。
- `BT_BUILD_CONFIG=Release`：多配置生成器的配置名；发布 gate 只接受 `Release`。
- `BT_SANITIZER_BUILD_DIR=/path/to/build-asan`：切换 ASan/UBSan 专用构建目录。
- `BT_BACKEND_URL=http://127.0.0.1:18080`：让编辑器 dev/preview 代理到指定后端。
- `BT_ROS_WEB_URL=http://127.0.0.1:8088`：设置编辑器 `/ros-api` 只读能力代理的目标，
  不改变 `/api/tree/*` 的树执行后端。
- `BT_E2E_REUSE_SERVER=1`：仅手工调试时允许复用 4173 上的 preview；发布 gate 始终设为 `0`。
- `BT_TREE_WORKSPACE=/path/to/trees`：限制 `/api/trees`、`/api/tree/open`、`/api/tree/save` 的读写目录，默认 `examples/trees`。

本地文档站：

```bash
./scripts/build_docs.sh
open docs/_build/html/index.html
```

生成 GitHub Pages 干净发布目录：

```bash
./scripts/build_pages.sh
```

上传 `docs/_build/pages/` 目录内的内容即可。该目录会自动包含 `.nojekyll`，并排除 Sphinx 构建缓存、源码副本和 inventory 文件。详细说明见 [GitHub Pages 发布说明](docs/pages_deployment.rst)。

刷新文档截图：

```bash
cd bt_editor
npm run screenshots
```

截图会写入 `docs/blog/screenshots/`，供 Sphinx 和 blog 文档引用；该命令不在默认 CI 中运行，避免普通测试修改图片文件。

## ROS2 回充示例

默认注册目录合计 46 种节点：27 个复用自 `bt_nodes` 的通用节点，加 19 个 ROS 专属节点（graph/topic/service 条件与动作、ROS data 录入、导航与回充）；完整清单以 `bt_ros2/src/node_registration.cpp` 为准。注意 ROS2 执行器只注册 `bt_nodes` 中的 27 个，`ReactiveSequence`、`ReactiveFallback`、`KeepRunningUntilFailure`、`KeepRunningUntilSuccess`、`BlackboardGate`、`NonBlockingDelay`、`TimeCondition` 尚未加入 `bt_ros2/src/node_registration.cpp`，这些节点目前只能在普通 `bt_server` 里执行。安装的 `recharge.xml` 固定为八节点：1 个 Fallback、2 个 Sequence、1 个 ReadBattery、2 个 CompareBlackboard、1 个 RechargeTask、1 个 TaskDoneNotifier。

代码入口：

- `bt_ros2/include/bt_ros2/recharge_task.hpp`：状态化 `RechargeTask` 七端口公开契约。
- `bt_ros2/include/bt_ros2/example_data_nodes.hpp`：`ReadBattery`、`TaskDoneNotifier` 以及旧 XML 兼容节点。
- `bt_ros2/include/bt_ros2/node_registration.hpp`：默认注册器，集中注册 bt_nodes、ROS topic 节点、数据节点和回充节点。
- `bt_ros2/trees/recharge.xml`：外部电量消息驱动回充的完整 XML。
- `docs/tutorial/ROS2_RECHARGE_TUTORIAL.md`：逐步教程。

## ROS2 监控与发布

监控 ROS2 节点健康时，推荐让目标节点发布 Bool 心跳，再由行为树使用
`IsFlagTrue topic="/planner/healthy" timeout_ms="1500"` 判断新鲜度；仅仅能在 ROS graph
看到节点名不能证明其业务回调仍然健康；只需要检查 graph 在线性时可用
`RosGraphCondition`。数据录入可使用 `ReadBattery` / `ReadScalar`，字符串发布可使用
`RosTopicAction`，通用 Trigger/SetBool 服务使用 `CallTriggerService` / `CallSetBoolService`，
自定义消息使用 `RosOutputNode<MsgT>`。

```xml
<PrioritySelector name="planner_watchdog">
  <IsFlagTrue topic="/planner/healthy" timeout_ms="1500"/>
  <TickRate tier="background">
    <RosTopicAction topic="/bt/events" message="planner heartbeat missing"/>
  </TickRate>
</PrioritySelector>
```

Graph 在线检查和 Yuyi 常见的工具启停 service 可以直接组合：

```xml
<Sequence name="start_work_tools">
  <RosGraphCondition entity_type="service"
                     entity_name="/sweeper/up/enable"/>
  <CallTriggerService service_name="/sweeper/up/lower"
                      timeout_sec="2.0"
                      message="{lower_response}"/>
  <CallSetBoolService service_name="/sweeper/up/enable"
                      data="true"
                      timeout_sec="2.0"
                      message="{enable_response}"/>
</Sequence>
```

两个 service 动作首拍发请求并返回 `RUNNING`，后续 tick 读取 future；超时返回 `FAILURE`，
被 `Parallel`、`PrioritySelector` 或上层清理逻辑抢占时会清除未完成请求。名称都来自端口，
属性面板只从实时 graph 给候选，不把示例路径写死。

执行器状态可通过 `/bt_executor/bt_status` 和 `/bt_executor/tree_snapshot` 观察，也可启动
`ros2 launch bt_ros2 bt_web.launch.py` 后访问 `http://127.0.0.1:8088`。

ROS2 Web 还提供 `GET /api/v1/bt/capabilities`：`bt_web` 自己通过 `rclpy` 每两秒读取实时
ROS graph，得到 node、topic、service、action 和接口类型；如果 `bt_executor` 在线，再合并
它实际注册的 factory manifest。graph 会动态变化，不能替代启动时 XML 校验；桥接不可用时
编辑器会回退到手工填写，不把任何业务 topic 写死。

能力快照是当前时刻的视图，不是永久节点目录：`bt_executor` 离开 ROS graph 后，下一次刷新会
清除它的 manifest，避免把已经卸载的 Yuyi/ROS 插件继续显示成可执行节点。Action 的
`send_goal/get_result/cancel_goal` 内部 service 只用于推导 action，不会混入普通 service 候选；
属性面板中看到的普通 service 才适合交给 `CallTriggerService` 或 `CallSetBoolService`。

### 在 5173 编辑器中使用实时 ROS2 图

浏览器不能直接加入 DDS。编辑器固定通过 Vite 的 `/ros-api` 代理连接本机
`bt_web:8088`；用户无需填写地址。页面打开后会自动读取 ROS graph，连接成功后每三秒刷新，
也可在右侧 **ROS2 运行时能力** 区域点击“连接 / 刷新 ROS2 图”。树的 `/api/tree/*`、
Tick、Run 仍发送给顶部显示的树后端，两条链路职责不同：

```text
浏览器 /ros-api/* -> 127.0.0.1:8088 bt_web -> rclpy/DDS
浏览器 /api/*     -> 127.0.0.1:8080 bt_server
```

推荐从仓库根目录运行 `./scripts/dev.sh`，它会自动托管 8088 graph bridge。用户不需要单独
启动一个 ROS2 业务节点；bridge 只是把 DDS graph 转成浏览器可读的 HTTP。只有单独运行 Vite
或调试 bridge 时才手动执行 `ros2 launch bt_ros2 bt_web.launch.py`。若没有其他 ROS2 节点在
相同 `ROS_DOMAIN_ID` 中运行，bridge 在线但 graph 为空是正常现象。

先在仓库根目录构建并安装 ROS2 包。这里必须显式指定 `bt_ros2` 为 base path；直接在仓库根
运行 `colcon build --packages-select bt_ros2` 时，colcon 会先把顶层 CMake 项目识别成另一个包，
从而报告找不到 `bt_ros2`：

```bash
source /opt/ros/humble/setup.bash
colcon --log-base log_ros2 build \
  --base-paths "$PWD/bt_ros2" \
  --build-base build_ros2 \
  --install-base install_ros2 \
  --packages-select bt_ros2
source install_ros2/setup.bash
ros2 pkg prefix bt_ros2
```

如果这里仍然输出 `Package not found`，说明当前终端还没有 source overlay；这不是“ROS graph
为空”，而是 `bt_web` 根本还不能启动。重新执行 `source /opt/ros/humble/setup.bash` 和
`source install_ros2/setup.bash`，再运行上面的命令。日常使用 `./scripts/dev.sh` 不需要手动执行
这两条 source，脚本会自动探测仓库 overlay。

然后启动执行器：

```bash
source /opt/ros/humble/setup.bash
source install_ros2/setup.bash
ros2 launch bt_ros2 bt_executor.launch.py \
  tree_file:=$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml
```

另一个终端启动能力网关：

```bash
source /opt/ros/humble/setup.bash
source install_ros2/setup.bash
ros2 launch bt_ros2 bt_web.launch.py http_port:=8088
```

先用 `curl http://127.0.0.1:8088/api/v1/bt/capabilities` 检查返回的 `available` 是否为
`true`。`bt_web` 启动后会自行产生 graph 快照，不依赖 executor 先发布能力消息；没有
executor 时仍能看到当前 DDS 资源，但 `manifests` 可能为空。浏览器报
`HTTP 500 @ /ros-api/...` 通常表示 Vite 代理连不到 8088，优先重新运行 `./scripts/dev.sh`；
它会自动托管 `bt_web`。只有单独运行 Vite 时才手动启动 `bt_web`，不是让用户修改一个“能力地址”。

ROS graph 连接成功后，`ros_topic`、`ros_service`、`ros_action`、`ros_node` 和动态
`ros_graph_entity` 提示会出现对应真实候选，节点面板也会显示 ROS executor 实际注册的节点。
**这不等于普通 `bt_server` 已具备 ROS2 执行能力**：如果树中
使用 `ReadScalar`、`IsFlagTrue`、`RosTopicAction` 等 ROS 节点，应把 XML 交给 `BtExecutorNode`
校验和运行；当前 `8088` 网关是只读监视器，不提供 `/api/tree/load`、`/api/tree/run`。
编辑器里看到的 ROS manifest 用于设计和端口配置，最终执行仍需 ROS2-aware 后端。

注意：普通 `./scripts/dev.sh` 后端只提供 34 个非 ROS 节点；46 节点 ROS2 目录由
`BtExecutorNode` 注册和执行，现有 ROS2 Web 页面是只读监视器。完整心跳、黑板、发布命令、
执行器启动方式及这个编辑边界见 [bt_ros2 使用说明](bt_ros2/README.md)。

Yuyi 生产树如果包含 `RunOnZoneTransition`、`FollowPath`、业务 ROS2 action
或路径/雷达专用节点，编辑器可以先用“自定义 XML 节点”搭建结构并填写任意属性；`SubTree`/
`SubTreePlus` 已经可以直接从节点面板拖入并在“树定义”栏创建目标子树。解析器也
支持带黑板映射的 `<SubTreePlus ID="..." foo="{bar}"/>`，`Parallel` 同时接受
`success_count/failure_count` 和 `success_threshold/failure_threshold` 两组命名。它们仍然
不是凭名称自动获得执行逻辑；`CallTriggerService` 和 `CallSetBoolService` 已可直接覆盖常用
`std_srvs` 调用。其余标签最终运行前必须在 ROS2 工程实现节点、声明 `providedPorts()`、
注册到 `BtExecutorNode`，并为长任务实现 `RUNNING`、超时、取消和 `halt()` 清理语义。调度、
区域边沿触发、清理和黑板映射的检查清单见 [单树调度：Yuyi 专用树接入前检查](docs/scheduling.rst)。

真实 ROS2 环境运行：

```bash
source /opt/ros/$ROS_DISTRO/setup.bash
colcon --log-base log_ros2 build \
  --base-paths "$PWD/bt_ros2" \
  --build-base build_ros2 \
  --install-base install_ros2 \
  --packages-select bt_ros2
source install_ros2/setup.bash
ros2 launch bt_ros2 bt_executor.launch.py \
  tree_file:=$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml \
  autostart:=false \
  stop_on_terminal:=true
```

请按 [observer-first 完整教程](docs/tutorial/ROS2_RECHARGE_TUTORIAL.md) 先启动 command/notifier/status 观察者，再调用 `/bt_executor/start`，并各发布一条 battery 和 dock 消息。

当前已在 ROS2 Humble 环境按教程完成端到端验证：构建 `bt_ros2`、启动
`bt_executor.launch.py`、加载 `recharge.xml`，发布一条低电量消息并确认
`/robot/command` 收到 `start_recharge:main_dock`，再发布 `dock=true` 并确认
`/bt/task_done` 收到 `task_done:recharge`。可复制命令全部集中在
[ROS2 回充教程](docs/tutorial/ROS2_RECHARGE_TUTORIAL.md)。

Jazzy 环境状态：**unverified: ROS 2 Jazzy is not installed on this machine.**

## 商用发布边界

Engineering can make the repository release-ready, but project licensing is a legal/product-owner decision. The package currently claims Apache-2.0 without a root license file. A commercial-release claim remains conditional on the owner supplying the approved root license and maintainer identity.

发布前必须完成 [商用发布检查表](docs/COMMERCIAL_RELEASE_CHECKLIST.md)，并审核 [第三方依赖清单](THIRD_PARTY_NOTICES.md)。当前工程验证完成不等于已获得对外分发授权。

## 手册与文档

- [文档导航](docs/README.md)
- [行为树基础](docs/behavior_tree_basics.rst)：四种基本控制节点、四态语义、tick 机制、黑板与端口，含可跑示例、Web 编辑器搭建与 GitHub Actions/Pages 发布流程
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
