# ROS2 回充教程：一条电池消息驱动完整状态机

目标：外部只发布一条 `BatteryState`，行为树判断低电量，`RechargeTask` 每次尝试只发布一条回充命令并等待对接；收到一条 dock 成功消息后发布一次完成通知，根节点最终为 `SUCCESS`。

## 1. 当前数据流

```text
/battery_state sensor_msgs/BatteryState
  -> ReadBattery(qos_profile="sensor_data", level="{battery_level}")
  -> blackboard["battery_level"] = percentage
  -> CompareBlackboard: battery_level < 0.20
  -> RechargeTask: publish once, then RUNNING
       /robot/command = start_recharge:main_dock
       wait /dock/is_docked std_msgs/Bool
  -> TaskDoneNotifier(subscriber_wait_timeout_ms="3000")
       /bt/task_done = task_done:recharge
  -> SUCCESS
```

`BtExecutorNode` 把非拥有的 `rclcpp::Node*` 放入黑板保留 key。ROS2 适配节点首次 tick 时取出句柄并惰性创建 endpoint，`bt_core` 因此保持零 ROS 依赖。

## 2. 打包的八节点树

文件：`bt_ros2/trees/recharge.xml`。它包含 1 个 `Fallback`、2 个 `Sequence`、1 个 `ReadBattery`、2 个 `CompareBlackboard`、1 个 `RechargeTask` 和 1 个 `TaskDoneNotifier`。

```xml
<root main_tree_to_execute="RechargeTree">
  <BehaviorTree ID="RechargeTree">
    <Fallback name="battery_guard">
      <Sequence name="battery_ok">
        <ReadBattery name="read_battery" topic="/battery_state"
                     timeout_ms="2000" qos_profile="sensor_data"
                     level="{battery_level}"/>
        <CompareBlackboard name="enough_power" key="battery_level"
                           op="&gt;=" value="0.20"/>
      </Sequence>
      <Sequence name="recharge_flow">
        <CompareBlackboard name="needs_recharge" key="battery_level"
                           op="&lt;" value="0.20"/>
        <RechargeTask name="recharge"
                      command_topic="/robot/command"
                      dock_topic="/dock/is_docked"
                      target="main_dock" timeout_ms="30000"
                      command_qos_depth="10" dock_qos_depth="10"
                      dock_qos_profile="default"/>
        <TaskDoneNotifier name="notify_recharge_done"
                          topic="/bt/task_done"
                          subscriber_wait_timeout_ms="3000"
                          task_name="recharge"/>
      </Sequence>
    </Fallback>
  </BehaviorTree>
</root>
```

`Sequence` 和 `Fallback` 保留 `RUNNING` 子节点的游标，所以进入 `RechargeTask` 后不会每拍重新订阅/读取电池；一条电池消息足够驱动这一轮。

## 3. RechargeTask 的七端口状态机

| 端口 | 默认 | 语义 |
|---|---|---|
| `command_topic` | `/robot/command` | 回充命令 topic，不能为空 |
| `dock_topic` | `/dock/is_docked` | dock 状态 topic，不能为空 |
| `target` | `main_dock` | 消息为 `start_recharge:<target>` |
| `timeout_ms` | `30000` | 等待 dock 超时；`<=0` 禁用超时 |
| `command_qos_depth` | `10` | 发布队列深度，必须大于 0 |
| `dock_qos_depth` | `10` | 订阅队列深度，必须大于 0 |
| `dock_qos_profile` | `default` | `default` 或 `sensor_data` |

首拍创建或复用 endpoint、清除旧 dock 状态、只发布一条命令并返回 `RUNNING`。后续 tick 不重发；先检查 `dock=true`，再检查超时，因此同一拍同时满足时成功优先。`SUCCESS`/`FAILURE` 会锁存到 `halt()`，终态重复 tick 没有副作用。父级 `Retry` halt 后开始新尝试，恰好再发一条命令，同时复用 endpoint。

`TaskDoneNotifier` 的 `subscriber_wait_timeout_ms=3000` 会等待 DDS 观察者匹配；等待时返回 `RUNNING`，匹配后发布。即使 3 秒内没有观察者也会发布并完成，不会永久卡住树。

旧的 `PublishRechargeCommand` 和 `IsDocked` 仍在默认目录中，供旧 XML 兼容；新回充功能不要再用 `CooldownCondition + PublishRechargeCommand + IsDocked` 拼装。

## 4. 默认注册：单例 + 工厂 + 函数引用

`BtExecutorNode` 调用 `registerDefaultNodes(factory)`。`NodeRegistrationCatalog::instance()` 保存四个注册函数：

| 注册组 | 数量 |
|---|---:|
| `registerBtNodes` | 25 |
| `registerRosTopicNodes` | 2 |
| `registerRosDataNodes` | 4 |
| `registerRechargeNodes` | 4 |
| 合计 | 35 |

项目可用 `NodeRegistrationCatalog::instance().add(registerMyRobotNodes)` 追加一组注册函数，最终仍由 `NodeFactory` 创建节点。

## 5. 启动执行器与观察者

```bash
source /opt/ros/humble/setup.bash
cd ~/bt_ws
colcon build --packages-select bt_ros2
source install/setup.bash

TREE_FILE="$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml"
ros2 launch bt_ros2 bt_executor.launch.py \
  tree_file:="$TREE_FILE" tick_rate_hz:=10.0 \
  autostart:=false stop_on_terminal:=true
```

在独立终端先启动三个观察者：

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 topic echo --once --field data /robot/command std_msgs/msg/String
```

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 topic echo --once --field data --qos-reliability reliable \
  /bt/task_done std_msgs/msg/String
```

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 topic echo --field data /bt_executor/bt_status std_msgs/msg/String
```

## 6. 只发布一次事件

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 service call /bt_executor/start std_srvs/srv/Trigger '{}'
ros2 topic pub --once --wait-matching-subscriptions 1 \
  /battery_state sensor_msgs/msg/BatteryState '{percentage: 0.18}'
```

第一次 start 返回 `success=True, message='started'`，运行中再次调用返回 `success=True, message='already running'`。命令观察者收到一条 `start_recharge:main_dock` 后再执行：

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 topic pub --once --wait-matching-subscriptions 1 \
  /dock/is_docked std_msgs/msg/Bool '{data: true}'
```

完成观察者收到 `task_done:recharge`，根状态最终为 `SUCCESS`。运行中 stop 返回 `stopped`，已停止时返回 `already stopped`；stop 总会 halt 树并清除本轮锁存状态。`stop_on_terminal=true` 已自动停止计时器，此时可显式验证幂等 stop 和复位：

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 service call /bt_executor/stop std_srvs/srv/Trigger '{}'
```

预期返回 `success=True, message='already stopped'`。

## 7. 换成项目自定义消息

输入消息节点只需继承 `RosInputNode<YourMsg>`，复用订阅公共端口并追加输出端口：

```cpp
class ReadRobotPower : public bt_ros2::RosInputNode<my_msgs::msg::Power> {
 public:
  using RosInputNode::RosInputNode;
  static bt_core::PortsList providedPorts() {
    auto ports = subscriberPorts();
    ports.insert(bt_core::OutputPort<double>("level", "电量百分比"));
    return ports;
  }
  void onData(const my_msgs::msg::Power& msg) override {
    setOutput<double>("level", msg.soc);
  }
};
```

`subscriberPorts()` 自动提供 `topic`、`timeout_ms`、`qos_depth` 和 `qos_profile`。严格 XML 会拒绝未在 `providedPorts()` 声明的属性。

生产机器人不应把 `std_msgs/String` 的 publish 当作执行确认。安全关键项目应换成带 attempt ID、明确 ack/result 和 halt 取消语义的类型化 ROS2 Action 或幂等 command/ack 协议，同时保留本状态机的公开形状。

## 8. 验证

```bash
cmake --build build --target test_ros_bases --parallel
./build/bin/test_ros_bases
```

mock gate 覆盖 QoS、发布者等待、`RechargeTask` 的七端口、单次发布、dock 成功、超时、成功优先、终态锁存、halt/retry 和 endpoint 复用。

真实 Humble 验收直接使用第 5、6 节的可复制命令，覆盖 35 个注册、8 节点安装树、幂等
start/stop、各一条 battery/command/dock/notifier 和最终 `SUCCESS`。需要隔离并行 ROS 图时，
在各终端设置同一个未占用的 `ROS_DOMAIN_ID`。

Jazzy 环境状态：**unverified: ROS 2 Jazzy is not installed on this machine.**

## 9. 启动只读 Web 监视器

`BtExecutorNode` 每次 tick 发布完整节点快照，并把 `start/stop` service 的
`started`/`completed` 生命周期发布到两个 transient-local topic。网页适配器只订阅这两类
观察数据，不提供控制机器人或调用 service 的 HTTP 接口。

先在执行器终端启动本教程的树：

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
TREE_FILE="$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml"
ros2 launch bt_ros2 bt_executor.launch.py \
  tree_file:="$TREE_FILE" autostart:=false stop_on_terminal:=true
```

在第二个终端使用**同一个** `TREE_FILE` 启动网页：

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
ros2 launch bt_ros2 bt_web.launch.py \
  tree_file:="$TREE_FILE" http_port:=8088
```

浏览器打开 <http://127.0.0.1:8088/>。网页会显示树结构、每拍节点状态、最近 48 拍的
Success/Failure 节点数柱状图、根状态和
`/bt_executor/start`、`/bt_executor/stop` 的服务时间线。网页晚于执行器启动时仍能收到最新
transient-local 快照；如果网页显示 `revision 不一致`，说明两个进程加载了不同 XML，必须
统一 `tree_file`。

运行树面板支持节点级 `+/-` 折叠，也支持“折叠全部/展开全部”。折叠只改变页面显示，
不会修改 XML、tick 顺序或运行时状态。点击“导出快照”可保存当前 JSON；“打开快照”会
切换到离线模式，适合把现场状态交给其他人复盘；离线模式会以单拍显示柱状图。
柱状图以整棵树节点总数作为固定纵轴，保留最近 48 拍，并在实时刷新时自动跟随最新 Tick。

### Web 观察接口

| 接口 | 作用 |
|---|---|
| `GET /api/v1/health` | 查看 HTTP 适配器是否在线 |
| `GET /api/v1/bt/structure` | 返回 XML 展开的稳定 DFS 结构和 `tree_revision` |
| `GET /api/v1/bt/snapshots/latest` | 返回最新完整节点快照 |
| `GET /api/v1/bt/snapshots?limit=60` | 返回最近快照历史 |
| `GET /api/v1/bt/service-events?limit=60` | 返回 service 生命周期事件 |

ROS 侧默认 topic 为 `/bt_executor/tree_snapshot` 和 `/bt_executor/service_event`，也可通过
`bt_executor.launch.py` 与 `bt_web.launch.py` 的 `snapshot_topic`、`service_event_topic`
参数同时改名。所有 HTTP 路由均为只读，POST 请求会返回 `405`。

## 10. 隔离 Debug 模式

Debug 模式使用独立执行器和 Web 控制面，不连接上面的 `/bt_executor`。launch 默认设置
`ROS_DOMAIN_ID=77`，避免调试树订阅或发布到生产 ROS graph：

```bash
source /opt/ros/humble/setup.bash
source ~/bt_ws/install/setup.bash
TREE_FILE="$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml"
ros2 launch bt_ros2 bt_debug.launch.py \
  tree_file:="$TREE_FILE" http_port:=8089 monitor_http_port:=8090 ros_domain_id:=77
```

浏览器打开 <http://127.0.0.1:8089/> 进入 Debug 控制页。调试执行器初始处于暂停状态，页面支持：

- `暂停` / `继续`：停止或恢复周期 tick；暂停不会 halt 或清空当前树状态。
- `单步`：暂停时只执行一拍，并立即发布新的完整快照。
- `重载`：重新读取同一个 XML，清空覆盖，创建新 session，并停在 `IDLE`。
- Condition 覆盖：每个条件可设为 `Auto`、`成功` 或 `失败`；也可整树设为全部成功、
  全部失败或全部自动。覆盖会在条件自身 `tick()` 前返回强制结果，不执行该条件的 ROS
  订阅或判断逻辑。

Debug 运行树使用独立端口 <http://127.0.0.1:8090/>，只读显示隔离执行器的完整树、最近
48 拍 Success/Failure 节点数柱状图和 service 事件；控制页与运行树互不占用同一个 HTTP 端口。

`运行树` 链接打开同一 debug session 的完整树监视页，节点快照中的 `override` 字段可区分
真实结果与强制结果。Action、Control 和 Decorator 不允许覆盖。

### Debug HTTP 接口

| 接口 | 请求体 / 作用 |
|---|---|
| `GET /api/v1/debug/state` | 当前运行模式、session、Condition key 和活动覆盖 |
| `POST /api/v1/debug/control` | `{"action":"pause|resume|step|reload"}` |
| `POST /api/v1/debug/overrides` | `{"scenario_id":"manual","overrides":{"node/4":"SUCCESS"}}` |

命令行也可直接验证四个 Trigger service，但必须使用与 launch 相同的 domain：

```bash
export ROS_DOMAIN_ID=77
ros2 service call /bt_debug_executor/step std_srvs/srv/Trigger '{}'
ros2 service call /bt_debug_executor/resume std_srvs/srv/Trigger '{}'
ros2 service call /bt_debug_executor/pause std_srvs/srv/Trigger '{}'
ros2 service call /bt_debug_executor/reload std_srvs/srv/Trigger '{}'
```

Debug 模式仍会执行 Action。自定义树若含物理控制 Action，必须继续使用隔离 domain，或把
这些 Action 替换为测试实现；Condition 覆盖不是动作仿真器，也不是生产安全机制。
