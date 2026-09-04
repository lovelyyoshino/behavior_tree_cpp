# bt_ros2：bt_core 的可选 ROS2 wrapper

`bt_ros2` 把零 ROS 依赖的 `bt_core` 行为树接到 ROS2 的参数、topic、service、timer 上。核心库不依赖 ROS2；本包只在 ROS2/ament 环境编译。

## 1. 设计边界

```text
ROS2 topic/service/timer/param
  -> bt_ros2::BtExecutorNode
  -> bt_core::NodeFactory + XmlParser + Tree
  -> bt_nodes / bt_ros2 adapter nodes
```

ROS 句柄进入行为树的方式：

1. `BtExecutorNode` 创建共享黑板。
2. 建树前调用 `setRosNodeHandle(blackboard, this)`，把非拥有 `rclcpp::Node*` 写入保留 key。
3. ROS2 适配节点首次 tick 时调用 `getRosNodeHandle(blackboard)`，惰性创建 subscription/publisher。

这样不会让 `bt_core` 依赖 rclcpp，也避免 `Node -> Tree -> Blackboard -> Node` 的 shared_ptr 循环引用。

## 2. 主要文件

| 文件 | 职责 |
|---|---|
| `include/bt_ros2/bt_executor_node.hpp` / `src/bt_executor_node.cpp` | ROS2 执行器：参数、注册、加载树、周期 tick、根状态、完整快照和 service 事件 |
| `include/bt_ros2/node_registration.hpp` | 单例注册目录 + 注册函数引用列表，统一注册默认节点 |
| `include/bt_ros2/ros_subscriber_node.hpp` | `RosConditionNode<MsgT>` / `RosInputNode<MsgT>` 订阅基类 |
| `include/bt_ros2/ros_publisher_node.hpp` | `RosOutputNode<MsgT>` 发布基类 |
| `include/bt_ros2/ros_graph_condition_node.hpp` | `RosGraphCondition`：动态检查 node/topic/service/action 是否存在 |
| `include/bt_ros2/call_service_nodes.hpp` | 非阻塞 `CallTriggerService` / `CallSetBoolService` 动作 |
| `include/bt_ros2/example_data_nodes.hpp` | `ReadBattery`、`ReadScalar`、`TaskDoneNotifier` 等开箱节点，以及兼容用旧回充节点 |
| `include/bt_ros2/recharge_task.hpp` / `src/recharge_task.cpp` | `RechargeTask`：一次发布、跨 tick 等待、超时与 halt/retry 状态机 |
| `include/bt_ros2/ros_qos.hpp` | 统一解析 `default` / `sensor_data` 订阅 QoS |
| `trees/example.xml` | 最小 topic 条件/动作示例 |
| `trees/recharge.xml` | 外部 BatteryState 消息驱动回充的完整示例 |
| `launch/bt_executor.launch.py` | launch 参数入口 |
| `scripts/bt_web.py` / `scripts/bt_web_core.py` | 只读 ROS 快照 HTTP 适配器 |
| `web/index.html` / `web/app.js` / `web/styles.css` | 树折叠、每拍状态柱状图和 service 时间线页面 |
| `launch/bt_web.launch.py` | 启动网页监视器 |

## 3. BtExecutorNode 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `tree_file` | string | `""` | 必填，行为树 XML 文件路径 |
| `tick_rate_hz` | double | `10.0` | tick 频率 |
| `status_topic` | string | `~/bt_status` | 根状态发布 topic |
| `snapshot_topic` | string | `~/tree_snapshot` | 完整节点快照 topic |
| `service_event_topic` | string | `~/service_event` | start/stop 生命周期事件 topic |
| `autostart` | bool | `true` | 构造后是否自动 tick |
| `stop_on_terminal` | bool | `false` | 根节点 SUCCESS/FAILURE 后是否停止 tick |

对持续处理事件流的树，通常保留 `autostart=true`、`stop_on_terminal=false`。对本 README 的“一次回充尝试”教程，使用 `autostart=false`、`stop_on_terminal=true`：先把观察者接入 ROS graph，再通过 service 开始；根节点到达 `SUCCESS` 或 `FAILURE` 后自动停止 tick。

执行器始终提供两个幂等的 `std_srvs/srv/Trigger` service：

```bash
ros2 service call /bt_executor/start std_srvs/srv/Trigger '{}'
ros2 service call /bt_executor/stop  std_srvs/srv/Trigger '{}'
```

- 第一次 start 返回 `success=True, message='started'`；运行中再次 start 返回 `already running`。
- 运行中 stop 返回 `success=True, message='stopped'`；已停止时再次 stop 返回 `already stopped`。
- stop 无论计时器是否已停止都会 halt 行为树，因此也能清理 `RUNNING` 或已锁存的任务状态，为下一次 start 做准备。

执行器同时发布 `bt_ros2.bt_snapshot.v1` 和 `bt_ros2.service_event.v1` 两种只读 JSON。快照
和事件都使用 reliable + transient-local QoS，观察器晚启动也可以获得最近状态；事件中的
`tree_revision` 与 Web 适配器从 XML 计算的 revision 必须一致。

注意默认值来源有两层：`BtExecutorNode` 节点参数默认 `tick_rate_hz=10.0`；仓库提供的 `bt_executor.launch.py` 为演示更易观察，launch 参数默认覆盖为 `tick_rate_hz=2.0`。命令行传入 `tick_rate_hz:=5.0` 时以 launch 参数为准。

## 4. 默认注册节点

`BtExecutorNode` 调用：

```cpp
bt_ros2::registerDefaultNodes(factory_);
```

默认目录合计注册 **40** 种节点：

| 注册函数 | 数量 | 节点 |
|---|---:|---|
| `registerBtNodes` | 27 | `Sequence`、`Fallback`、`Parallel`、`PrioritySelector`、`Inverter`、`Retry`、`Repeat`、`ForceSuccess`、`ForceFailure`、`TickRate`、`AlwaysSuccess`、`AlwaysFailure`、`PrintMessage`、`SetBlackboard`、`CompareBlackboard`、`CheckBool`、`Counter`、`CooldownCondition`、`SetBool`、`BlackboardExists`、`ClearBlackboard`、`ScalarThreshold`、`Delay`、`WaitUntilElapsed`、`LogEvent`、`FunctionAction`、`FunctionCondition` |
| `registerRosTopicNodes` | 5 | `RosTopicCondition`、`RosTopicAction`、`RosGraphCondition`、`CallTriggerService`、`CallSetBoolService` |
| `registerRosDataNodes` | 4 | `ReadBattery`、`ReadScalar`、`IsFlagTrue`、`IsObstacleClose` |
| `registerRechargeNodes` | 4 | `RechargeTask`、`TaskDoneNotifier`、`IsDocked`、`PublishRechargeCommand` |

打包的 `trees/recharge.xml` 使用 `RechargeTask` 完成“发命令 + 等对接”的整体动作，不再使用旧的 cooldown / `PublishRechargeCommand` / `IsDocked` 编排。后三个旧节点仍保留注册，已有源码和 XML 不会因升级而失效。

如果项目要追加节点，可复用 `NodeRegistrationCatalog::instance().add(yourRegisterFn)`，或在自定义 executor 中直接调用 `factory.registerNodeType<T>()`。

### 编辑器先搭建、插件后接入

Yuyi 的 `LoadYuyiPath`、`FollowPath`、`RunOnZoneTransition` 等业务节点不应写死进通用
编辑器。编辑器可以先创建同名自定义节点，在属性面板声明输入/输出端口和 XML 属性，
再导出多树 XML；接入 ROS2 时，插件必须提供同名注册和 `providedPorts()`，并明确
`RUNNING`、超时、`halt()`、资源清理及黑板类型。编辑器端口声明只负责设计提示，不能替代
这个运行时契约。推荐的接入顺序是：

1. 先用 `SubTree`/`SubTreePlus` 把路线、监控、工具控制拆成可复用定义。
2. 为 `path_file`、`frame_id` 等输入和 `path`、`result` 等输出声明准确方向与类型，输出用
   `{blackboard_key}` 绑定共享黑板。
3. 在 ROS2 插件中实现节点、注册到 `BtExecutorNode`，再用同一份 XML 做 `validate/load/tick`。
4. 对长任务验证首次 tick、连续 RUNNING、响应超时和 halt 后是否可重试；不要只验证 XML 能解析。

## 5. 构建

### 从仓库源码直接构建

```bash
source /opt/ros/$ROS_DISTRO/setup.bash
cd /path/to/behavior_tree_cpp
colcon --log-base log_ros2 build \
  --base-paths "$PWD/bt_ros2" \
  --build-base build_ros2 \
  --install-base install_ros2 \
  --packages-select bt_ros2
source install_ros2/setup.bash
ros2 pkg prefix bt_ros2
```

必须显式传 `--base-paths bt_ros2`。仓库根也有顶层 `CMakeLists.txt`，不带该参数时
colcon 会把根目录识别为 `behavior_tree_cpp_x` 并停止向下发现，随后
`--packages-select bt_ros2` 会得到 `Package not found`。

独立工作区同理：假设仓库位于 `~/bt_ws/src/behavior_tree_cpp`，在 `~/bt_ws` 使用
`--base-paths "$PWD/src/behavior_tree_cpp/bt_ros2"`，再 source `install/setup.bash`。

`bt_core` 当前已安装/导出 `bt_coreConfig.cmake` 和 `bt::core` target；`bt_ros2/CMakeLists.txt` 会优先 `find_package(bt_core)`，找不到时再回退到源码子目录方式。

### 主仓库 CMake 子目录方式

```bash
source /opt/ros/$ROS_DISTRO/setup.bash
cmake -S . -B build -DBT_BUILD_ROS2=ON
cmake --build build -j
```

这种方式适合本地编译检查；要用 `ros2 launch` 找包，仍推荐 colcon 安装布局。

## 6. 最小示例

```bash
ros2 launch bt_ros2 bt_executor.launch.py
ros2 topic echo /bt_executor/bt_status
ros2 topic echo /bt/chatter
ros2 topic pub /robot/ready std_msgs/msg/Bool "{data: true}"
```

## 7. 监控 ROS2 节点并发布信息

### 7.1 推荐的节点健康监控：带超时心跳

ROS graph 中出现某个节点名，只能证明它完成过发现，不能证明订阅回调、业务循环或设备仍然
健康。因此默认目录没有把“节点名存在”当健康条件。推荐让被监控节点周期发布 Bool 心跳，
行为树使用带 ``timeout_ms`` 的 `IsFlagTrue` 判断消息是否仍然新鲜。

下面的树把 `/planner/healthy` 作为最高优先级输入。1.5 秒没有收到新的 `true` 就切换到
低优先级告警分支；`TickRate background` 把告警限制为每 5 个父 tick 发布一次：

```xml
<root main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <PrioritySelector name="planner_watchdog">
      <IsFlagTrue topic="/planner/healthy"
                  timeout_ms="1500"
                  qos_profile="default"/>
      <TickRate tier="background">
        <RosTopicAction topic="/bt/events"
                        message="planner heartbeat missing"/>
      </TickRate>
    </PrioritySelector>
  </BehaviorTree>
</root>
```

启动执行器后，在两个终端分别观察告警和发送心跳：

```bash
ros2 topic echo /bt/events std_msgs/msg/String
```

```bash
ros2 topic pub -r 2 /planner/healthy std_msgs/msg/Bool '{data: true}'
```

停止第二条命令约 1.5 秒后，行为树会发布 `planner heartbeat missing`。如果现有节点不能增加
心跳 topic，再实现一个自定义 `RosConditionNode<MsgT>`；只有明确需要“资源是否出现在 graph”
语义时，才使用通用节点：

```xml
<RosGraphCondition entity_type="node" entity_name="/planner"/>
<RosGraphCondition entity_type="topic" entity_name="/planner/healthy"/>
<RosGraphCondition entity_type="service" entity_name="/planner/reset"/>
<RosGraphCondition entity_type="action" entity_name="/navigate_to_pose"/>
```

资源存在返回 `SUCCESS`，不存在返回 `FAILURE`；判断“不存在”时用 `Inverter`。它每拍读取当前
graph，不缓存旧快照，但 DDS 发现仍有传播延迟，且资源存在不等于业务健康。

### 7.2 ROS2 数据写入黑板

`ReadBattery` 和 `ReadScalar` 是开箱即用的数据录入节点。输出端口必须用 `{key}` 绑定实际
黑板键，而读取该键的 `key` 端口直接写名字、不加花括号：

```xml
<Sequence name="temperature_alarm">
  <ReadScalar topic="/temperature" timeout_ms="1000"
              value="{temperature}"/>
  <ScalarThreshold key="temperature" op=">=" value="80"/>
  <RosTopicAction topic="/bt/events" message="temperature too high"/>
</Sequence>
```

XML 属性里的 `<` 必须写成 `&lt;`；`>` 可原样写或写成 `&gt;`，所以上例的 `>=` 合法。
如果要把数值本身发布为 `std_msgs/msg/Float64`，继承
`RosOutputNode<std_msgs::msg::Float64>` 并在 `buildMsg()` 中读取 `temperature`，不要把
`double` 黑板值直接重映射给只接受字符串的 `RosTopicAction.message`。

### 7.3 发布节点与行为树运行监视

Yuyi 常见的 `std_srvs/srv/Trigger` 和 `std_srvs/srv/SetBool` 已有默认非阻塞动作：

```xml
<Sequence name="start_sweeper">
  <CallTriggerService service_name="/sweeper/up/lower"
                      timeout_sec="2.0"
                      message="{lower_response}"/>
  <CallSetBoolService service_name="/sweeper/up/enable"
                      data="true"
                      timeout_sec="2.0"
                      message="{enable_response}"/>
</Sequence>
```

首次 tick 创建 client、等待 service 并异步发请求，期间返回 `RUNNING`；响应的 `success`
决定终态，`message` 写入黑板。超时和 `halt()` 都会清理 pending request，不能用同步等待
阻塞 executor。其他 service 类型仍应实现一个类型化节点，复用
`RosServiceActionNode<ServiceT>` 的状态机。

- `RosTopicAction`：发布一条 `std_msgs/msg/String`，`message` 可为字面量或字符串 `{key}`。
- `TaskDoneNotifier`：发布 `task_done:<task>`，适合任务终态通知。
- `PublishRechargeCommand`：发布回充命令；新回充流程优先使用完整的 `RechargeTask`。
- 自定义消息：继承 `RosOutputNode<MsgT>`；ROS2 Action/Service 长任务应写异步节点，首拍发起并
  返回 `RUNNING`，后续拍检查结果，`onHalted()` 取消请求。

执行器自身可直接观察：

```bash
ros2 topic echo /bt_executor/bt_status std_msgs/msg/String
ros2 topic echo /bt_executor/tree_snapshot std_msgs/msg/String
ros2 topic echo /bt_executor/service_event std_msgs/msg/String
```

启动只读 Web 监视器：

```bash
ros2 launch bt_ros2 bt_web.launch.py tree_file:=/absolute/path/to/tree.xml
```

浏览器访问 `http://127.0.0.1:8088`。该页面监视行为树节点状态和 start/stop 事件，不负责修改树。

ROS-aware Web 适配器还提供动态能力接口：

```bash
curl http://127.0.0.1:8088/api/v1/bt/capabilities | jq
```

返回值是一个包装对象：`available` 表示 `bt_web` 是否已经完成一次实时 graph 读取，真实数据
位于 `capabilities`。其中 `schema` 为 `bt_ros2.capabilities.v1`，内容包含当前
`ros_nodes`、`topics`、`services`、从标准 `send_goal` 接口推导的 `actions`，以及在线
executor 实际注册的节点 manifest。它适合给编辑器的 ROS 端口生成候选；graph 变化、节点重启或能力
接口不可用时，编辑器必须回退到手工
输入，不能把一次快照当永久配置：

``manifests`` 只在对应 ``executor_node`` 仍存在于当前 ROS graph 时保留；executor 退出后会在下一次
刷新中清空，避免继续拖入已经无法执行的插件节点。Action 传输所需的
``/_action/send_goal``、``/_action/get_result``、``/_action/cancel_goal`` service 会被归入
``actions`` 推导结果，不会作为普通 service 提供给 Trigger/SetBool 节点。

```json
{"available":true,"capabilities":{"schema":"bt_ros2.capabilities.v1",
 "executor_node":"/bt_executor","topics":[{"name":"/planner/healthy",
 "types":["std_msgs/msg/Bool"]}],"services":[{"name":"/planner/reset",
 "types":["std_srvs/srv/Trigger"]}],"actions":[{"name":"/navigate_to_pose",
 "types":["nav2_msgs/action/NavigateToPose"]}],"ros_nodes":["/planner"],"manifests":[]}}
```

### 7.3.1 推荐启动方式

从仓库根目录运行 `./scripts/dev.sh` 会同时启动 5173 编辑器、普通树后端，并自动托管本机
ROS2 graph bridge。已安装 `bt_ros2` 时使用 `ros2 launch`，未安装时直接运行仓库中的
`bt_web.py`，所以不需要用户额外维护一个 ROS2 业务节点。`bt_web` 只是浏览器访问 DDS 所需的
只读 HTTP 转接进程，真正的 ROS2 行为树仍由 `BtExecutorNode` 执行。

只有单独运行 Vite、调试 bridge 或部署到另一台机器时，才需要手动启动 bridge：

```bash
./scripts/dev.sh

source /opt/ros/humble/setup.bash
PYTHONPATH="$PWD/bt_ros2/scripts${PYTHONPATH:+:$PYTHONPATH}" python3 bt_ros2/scripts/bt_web.py --ros-args -p bind_address:=127.0.0.1 -p http_port:=8088
```

`BT_ROS_WEB_MODE=off ./scripts/dev.sh` 可关闭自动 bridge；`BT_ROS_WEB_MODE=on ./scripts/dev.sh`
会在 bridge 无法启动时直接退出。只运行 `ros2` 命令不会凭空产生业务 graph，目标节点或 launch
仍需在相同 `ROS_DOMAIN_ID` 中运行。

非 Humble 环境可通过 `BT_ROS_SETUP_FILE=/opt/ros/jazzy/setup.bash ./scripts/dev.sh` 指定 ROS
环境脚本；bridge 节点、topic 和 service 名称仍来自运行时 graph，不写死在编辑器中。

### 7.4 编辑器边界

`./scripts/dev.sh` 启动的普通 `bt_server` 只加载 `libbt_nodes`，节点面板显示 34 个非 ROS 节点。
ROS2 默认目录的 40 个节点只存在于 `BtExecutorNode` 进程，因为订阅/发布/service 节点执行时需要真实
`rclcpp::Node` 句柄。因此：

- 普通编辑器可以设计控制结构、黑板逻辑和 Tick 分级，并保存 XML。
- `http://127.0.0.1:5173` 会通过固定 `/ros-api` 代理自动连接本机 8088 bridge；右侧
  “连接 / 刷新 ROS2 图”可立即重读。`bt_web` 直接提供 node/topic/service/action 候选，
  executor 在线时再合并它的 46 节点 manifest；界面不要求用户填写基础设施 URL。
- 包含 `IsFlagTrue`、`ReadScalar`、`RosTopicAction` 等 ROS2 标签的最终 XML 由 ROS2 executor
  校验和运行；普通 `bt_server` 不应被当作 ROS2 仿真器。
- 当前 ROS2 Web 页面仍是只读监视器：它能给 5173 编辑器提供真实 manifest，但不接受
  `/api/tree/load` 或 `/api/tree/run`。若要在同一个后端完成 ROS2 树载入和运行，需要后续提供
  ROS2-aware editor backend，不能把“发现到 manifest”冒充成普通 `bt_server` 的执行能力。

### 7.5 开发自己的 ROS2 节点

建议按“输入适配器、条件、动作、状态化动作”四层选择实现方式：

1. 只读一个 topic 并把字段写入黑板：继承 `RosInputNode<MsgT>`，在 `onData` 中调用
   `setOutput`；输出端口在 XML 中用 `{blackboard_key}` 接线。
2. 只判断一个 topic：继承 `RosConditionNode<MsgT>`，在 `evaluate` 返回 bool；需要
   超时/心跳语义时复用 `subscriberPorts()` 的 `timeout_ms` 和 QoS 端口。
3. 发一条消息即完成：继承 `RosOutputNode<MsgT>`，在 `buildMsg` 读取输入并返回成功。
4. ROS2 Action、Service 或等待设备反馈：写 `ActionNode` 状态机，首拍发起并返回
   `RUNNING`，后续拍检查 future/反馈，成功或超时返回终态，`onHalted()` 必须取消并
   清理请求。`RechargeTask` 是完整参考。

每个新节点都应声明 `providedPorts()`，并建议同时声明节点级说明：

```cpp
static bt_core::NodeDocumentation providedDocumentation() {
  return {
      "监控自定义 ROS2 消息并写入黑板",
      "topic 指输入话题，value={temperature} 连接输出",
      "新鲜数据 SUCCESS，等待数据 RUNNING",
      "话题无效或超时返回 FAILURE",
      R"(<ReadTemperature topic="/temperature" value="{temperature}"/>)"};
}
```

注册后，`BtExecutorNode` 的 factory manifest 会携带这份文档；能力快照中的 ROS graph
只负责提供当前候选，不替代 XML 配置和启动时校验。这样新增消息类型或换 topic 时无需
修改前端白名单，也不会把某一台机器的运行状态写死进通用行为树工具。

## 8. Yuyi 生产树接入清单

Yuyi 项目中的 ``SubTreePlus``、``RunOnZoneTransition``、``TimeCondition``、
``FollowPath``、路径加载、雷达限速、区域检测以及业务 action 节点，属于项目专用扩展。
通用 Trigger/SetBool service 已在默认 40 个注册节点内；其余接入时按下面顺序检查：

1. 每个标签都有真实 C++ 类型、`providedPorts()` 和 `registerNodeType()`；XML 中出现的
   每个属性都必须是已声明端口。不要只添加静态 editor manifest。
2. ROS2 节点从 `getRosNodeHandle(blackboard)` 获取句柄；service/action 首拍异步发起，
   后续 tick 读取结果，超时和 `onHalted()` 都要取消请求。
3. ``SubTreePlus`` 约定输入/输出映射和未映射 key 的作用域；当前解析器支持
   ``foo="{bar}"`` 形式的映射，并把子树内部 ``{foo}`` 解析到父黑板 ``bar``。
   普通 ``SubTree`` 仍只接受 ``ID`` 属性。
4. ``RunOnZoneTransition`` 明确 enter/exit 边沿、首次采样、重复 transition、正在执行
   时的锁定和失败策略。`expected` / `expected_zones` 只能保留一个确定的端口名。
5. 路线、雷达参数、工具 service 和清理逻辑各自指定唯一所有者。不要让路线监控和区域
   监控并行写同一个参数集；`ForceSuccess` 包裹的辅助动作必须另行发布失败诊断。

推荐把树拆成 `ProductionScheduler -> ScheduledRoute -> (FollowRoute, ZoneToolPolicy,
ObstaclePolicy)` 四层。调度器负责时间窗口和单飞锁；路线负责长任务；两个策略节点只
计算最终策略并交给唯一资源所有者执行。多层嵌套不是问题，含义不清的共享资源和未定义
的 `halt()` 才是问题。完整的跨午夜、清理、黑板映射和 `Parallel` 阈值检查见
`docs/scheduling.rst`。

## 9. 完整回充功能

### 9.1 打包树与单条消息数据流

`trees/recharge.xml` 固定为 8 个节点：1 个 `Fallback`、2 个 `Sequence`、1 个 `ReadBattery`、2 个 `CompareBlackboard`、1 个 `RechargeTask`、1 个 `TaskDoneNotifier`。

一次低电量事件按以下路径执行：

1. 唯一的 `ReadBattery` 订阅 `/battery_state`，用 `sensor_data` QoS 把 `BatteryState.percentage` 写入 `{battery_level}`。
2. `enough_power` 和 `needs_recharge` 先后读取同一个黑板值；不会为两个分支各建一个电池订阅。
3. 低于 `0.20` 时，`RechargeTask` 向 `/robot/command` 发布一次 `start_recharge:main_dock`，随后跨 tick 返回 `RUNNING`。
4. 收到一次 `/dock/is_docked=true` 后，`RechargeTask` 返回 `SUCCESS`。
5. `TaskDoneNotifier` 向 `/bt/task_done` 发布一次 `task_done:recharge`，整棵树返回 `SUCCESS`。

`Sequence` 和 `Fallback` 都保留正在运行的子节点游标，因此进入 `RechargeTask` 后不会每拍退回 `ReadBattery`，一条电池消息足以驱动这一轮回充。

`RosOutputNode` 额外提供 `subscriber_wait_timeout_ms` 公共端口，默认 `0` 表示保持原有的立即发布语义。打包树只给 `TaskDoneNotifier` 设置 `3000`：首次到达通知节点时先创建 publisher；若 DDS 订阅尚未匹配则返回 `RUNNING`，匹配后发布一次；3 秒内仍无观察者则照常发布并完成，避免监控端缺席永久阻塞业务树。

### 9.2 RechargeTask 的 7 个端口

| 端口 | 类型 | 默认值 | 契约 |
|---|---|---|---|
| `command_topic` | string | `/robot/command` | 发布回充命令的 topic；空字符串是配置错误 |
| `dock_topic` | string | `/dock/is_docked` | 订阅 `std_msgs/msg/Bool` 对接状态的 topic；空字符串是配置错误 |
| `target` | string | `main_dock` | 命令目标，示例消息为 `start_recharge:<target>` |
| `timeout_ms` | int | `30000` | 等待对接的超时毫秒数；`<=0` 表示禁用超时 |
| `command_qos_depth` | int | `10` | 命令发布队列深度；必须大于 0 |
| `dock_qos_depth` | int | `10` | 对接订阅队列深度；必须大于 0 |
| `dock_qos_profile` | string | `default` | 对接订阅 QoS，只接受 `default` 或 `sensor_data` |

状态机语义：

- `IDLE` 的首拍惰性创建并保留 publisher/subscription，清除可能滞留的 dock 状态，发布**一条**命令，然后返回 `RUNNING`。
- `RUNNING` 阶段先检查 dock 成功，再检查超时；因此 dock 消息与超时同时满足时以 `SUCCESS` 为准。未 dock 且未超时时继续返回 `RUNNING`。
- `SUCCESS` / `FAILURE` 会锁存到 `halt()`，终态后的重复 tick 不会重发命令。
- `halt()` 清理本次 phase、dock 状态和计时起点，但保留 ROS publisher/subscription。父级 `Retry` 在下一次尝试前会 halt 子节点，因此每次尝试恰好再发布一条命令，同时避免重复创建 ROS 端点。

### 9.3 QoS 选择

所有 `RosSubscriberNode` 子类都支持 `qos_depth` 和 `qos_profile`；`RechargeTask` 对 dock 订阅提供对应的 `dock_qos_*` 端口。

| profile | rclcpp 构造 | 适合场景 |
|---|---|---|
| `default` | `rclcpp::QoS(KeepLast(depth))` | 可靠控制状态、命令确认等常规 topic |
| `sensor_data` | `rclcpp::SensorDataQoS().keep_last(depth)` | 允许丢旧帧、优先低延迟的传感器流 |

打包树明确让 `/battery_state` 使用 `sensor_data`，让 `/dock/is_docked` 使用 `default`。发布端只有 `command_qos_depth`，没有 `command_qos_profile` 端口。

### 9.4 可复制的一电池、一对接演示

以下步骤故意先启动观察者，再发布一次性事件，避免漏掉瞬时消息。每个“终端”代码块都在一个独立终端运行，并先加载同一 colcon 工作区。

终端 1：以手动启动、终态自动停止模式加载安装后的 8 节点树。

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
TREE_FILE="$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml"
ros2 launch bt_ros2 bt_executor.launch.py \
  tree_file:="$TREE_FILE" \
  tick_rate_hz:=10.0 \
  autostart:=false \
  stop_on_terminal:=true
```

终端 2：先观察本轮唯一的回充命令；收到一条后自动退出。

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 topic echo --once --field data /robot/command std_msgs/msg/String
```

终端 3：先观察完成通知；收到一条后自动退出。

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 topic echo --once --field data --qos-reliability reliable \
  /bt/task_done std_msgs/msg/String
```

终端 4：观察根状态，最终应看到 `SUCCESS`。

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 topic echo --field data /bt_executor/bt_status std_msgs/msg/String
```

终端 5：开始 tick，并只发布一条低电量消息。`--wait-matching-subscriptions 1` 会等 `ReadBattery` 订阅就绪，不依赖固定 sleep。

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 service call /bt_executor/start std_srvs/srv/Trigger '{}'
ros2 topic pub --once --wait-matching-subscriptions 1 \
  /battery_state sensor_msgs/msg/BatteryState '{percentage: 0.18}'
```

终端 2 输出 `start_recharge:main_dock` 后，在终端 5 只发布一条 dock 消息：

```bash
ros2 topic pub --once --wait-matching-subscriptions 1 \
  /dock/is_docked std_msgs/msg/Bool '{data: true}'
```

随后终端 3 输出 `task_done:recharge`，终端 4 的末状态为 `SUCCESS`；`stop_on_terminal=true` 已取消 tick timer。显式 stop 仍可安全调用，并会 halt 树、返回 `already stopped`：

```bash
ros2 service call /bt_executor/stop std_srvs/srv/Trigger '{}'
```

完整教程见 [`docs/tutorial/ROS2_RECHARGE_TUTORIAL.md`](../docs/tutorial/ROS2_RECHARGE_TUTORIAL.md)。

## 9.5 启动网页监视器

```bash
TREE_FILE="$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml"
ros2 launch bt_ros2 bt_web.launch.py tree_file:="$TREE_FILE" http_port:=8088
```

打开 `http://127.0.0.1:8088/` 后，页面可查看实时树、每拍节点状态、最近 48 拍的 Success/Failure
节点数柱状图和 service 时间线，并按分支折叠或全部折叠。页面是只读观察器，不能代替
`ros2 service call` 控制执行器。详情、
接口契约和离线快照流程见 [`docs/tutorial/ROS2_RECHARGE_TUTORIAL.md`](../docs/tutorial/ROS2_RECHARGE_TUTORIAL.md)
第 9 节。

柱状图以整棵树的节点总数作为固定纵轴，柱宽与 48 拍历史窗口保持不变；实时模式每次刷新
都会跟随到最右侧的最新 Tick。

## 9.6 隔离 Debug Sandbox

参考生产项目的独立 sandbox 入口，`bt_ros2` 提供一个只在调试 launch 中开启的控制面：

```bash
TREE_FILE="$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml"
ros2 launch bt_ros2 bt_debug.launch.py \
  tree_file:="$TREE_FILE" http_port:=8089 monitor_http_port:=8090 ros_domain_id:=77
```

访问 `http://127.0.0.1:8089/` 可以暂停、继续、单步、重载，并把任意 Condition 原子设为
`AUTO` / `SUCCESS` / `FAILURE`。默认 `ROS_DOMAIN_ID=77`，节点名为
`/bt_debug_executor`，与普通 `/bt_executor` 隔离。普通 `bt_web.launch.py` 仍然只读，
不会暴露 debug POST 路由或控制 service。

Debug 控制页和运行监视页使用不同端口：`http://127.0.0.1:8089/` 是控制页，
`http://127.0.0.1:8090/` 是独立的只读运行树（含每拍 Success/Failure 柱状图）。
可通过 `monitor_http_port:=<port>` 修改第二个端口。

调试服务是 `/bt_debug_executor/pause`、`resume`、`step`、`reload`，类型均为
`std_srvs/srv/Trigger`。完整网页接口和安全边界见教程第 10 节。

## 10. 从演示协议升级到生产协议

`RechargeTask` 当前用 `std_msgs/msg/String` 发布 `start_recharge:<target>`，这是为了让示例不依赖厂商接口。一次 `publish()` 只表示消息已交给 ROS2 middleware，**不表示底盘已接收、接受或执行回充**，也不是执行确认。

生产机器人，尤其是安全关键系统，应替换为以下任一协议：

1. 类型化 ROS2 Action：goal 包含目标桩和唯一 attempt ID，feedback 报告导航/对接阶段，result 明确成功、拒绝、取消或故障；`onHalted()` 取消未完成 goal。
2. 类型化、幂等的 command/ack：命令携带唯一 operation ID，控制器按 ID 去重，行为树等待同一 ID 的明确 ack/result，超时重试不会重复触发物理动作。

无论采用哪种方式，仍保持本节点的公开状态机形状：首拍发送并返回 `RUNNING`，后续 tick 等反馈，终态锁存，halt 负责取消/复位。

## 11. 验证状态

非 ROS mock gate：

```bash
cmake --build build --target test_ros_bases --parallel
./build/bin/test_ros_bases
```

`test_ros_bases` 覆盖 subscriber/publisher 基类、两种 QoS、`ReadBattery` 等待语义，以及 `RechargeTask` 的端口、单次发布、dock 成功、超时、成功优先、终态锁存、halt/retry 和端点复用。

ROS2 Humble 已用隔离 colcon 构建和真实 ROS graph smoke 验证：

```bash
source /opt/ros/humble/setup.bash
ROS_DOMAIN_ID=173 BT_ROS2_SMOKE_ROOT="$(mktemp -d)" ./scripts/smoke_ros2.sh
```

smoke 会验证 40 个注册类型、8 节点安装树、幂等 start/stop、恰好一条 battery / command / dock / notifier，以及最终 `SUCCESS`。

Jazzy 环境状态：**unverified: ROS 2 Jazzy is not installed on this machine.**
