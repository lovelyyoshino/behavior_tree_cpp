# ROS2 回充教程：外部消息如何驱动行为树

目标：机器人从外部 ROS2 topic 获取电量消息，行为树判断低电量后发布回充命令，并在对接充电桩后发布任务完成通知。

## 1. 数据流总览

```text
/battery_state sensor_msgs/BatteryState
  -> ReadBattery(level="{battery_level}")
  -> blackboard["battery_level"] = percentage
  -> CompareBlackboard key="battery_level" op="<" value="0.20"
  -> PublishRechargeCommand topic="/robot/command"
  -> /dock/is_docked std_msgs/Bool
  -> TaskDoneNotifier topic="/bt/task_done"
```

核心点：ROS2 消息不直接进入 `bt_core`。`BtExecutorNode` 把 `rclcpp::Node*` 放入黑板，ROS2 节点首次 tick 时惰性创建 subscription/publisher。

## 2. 示例树

文件：`bt_ros2/trees/recharge.xml`

关键片段：

```xml
<ReadBattery topic="/battery_state" timeout_ms="2000" level="{battery_level}"/>
<CompareBlackboard key="battery_level" op="&lt;" value="0.20"/>
<CooldownCondition cooldown_ms="5000"/>
<PublishRechargeCommand topic="/robot/command"
                        command="start_recharge"
                        target="main_dock"/>
<IsDocked topic="/dock/is_docked" timeout_ms="1000"/>
<TaskDoneNotifier topic="/bt/task_done" task_name="recharge"/>
```

为什么有 `CooldownCondition`：低电量可能持续很多 tick，不限流会每拍发布一次回充命令。这里设置 5 秒最多发布一次。

## 3. 启动执行器

在真实 ROS2 Humble/Jazzy 环境中：

```bash
source /opt/ros/$ROS_DISTRO/setup.bash
cd ~/bt_ws
colcon build --packages-select bt_ros2
source install/setup.bash

ros2 launch bt_ros2 bt_executor.launch.py \
  tree_file:=$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml \
  tick_rate_hz:=5.0 \
  stop_on_terminal:=false
```

`stop_on_terminal=false` 是 topic 驱动场景的默认值。首拍没有消息时树可能返回 `FAILURE`，但执行器必须继续 tick，等待下一条 topic 数据。

## 4. 发布外部电量消息

另开终端：

```bash
source /opt/ros/$ROS_DISTRO/setup.bash
source ~/bt_ws/install/setup.bash

ros2 topic pub /battery_state sensor_msgs/msg/BatteryState "{percentage: 0.12}"
```

期望：`ReadBattery` 把 `0.12` 写入黑板 `battery_level`，`CompareBlackboard` 判断 `<0.20` 成立，树进入回充分支。

## 5. 观察命令发布

```bash
ros2 topic echo /robot/command
```

期望看到：

```text
data: start_recharge:main_dock
```

## 6. 模拟对接完成

```bash
ros2 topic pub /dock/is_docked std_msgs/msg/Bool "{data: true}"
ros2 topic echo /bt/task_done
```

期望看到：

```text
data: task_done:recharge
```

## 7. 如何替换成项目自定义消息

1. 新建一个节点继承 `RosInputNode<YourMsg>`。
2. 在 `providedPorts()` 中复用 `subscriberPorts()` 并追加输出端口。
3. 在 `onData()` 中把消息字段写入黑板。
4. 把节点注册到 `NodeRegistrationCatalog` 或在你的 executor 中手动 `factory.registerNodeType<T>()`。

示例：

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

## 8. 本机已验证与未验证

已在无 ROS2 环境验证：

```bash
cmake --build build
ctest --test-dir build --output-on-failure
```

其中 `test_ros_bases` 使用 mock `rclcpp` 覆盖了完整链路：`BatteryState` mock 消息进入 `ReadBattery`，写入黑板，`CompareBlackboard` 判定低电量，`PublishRechargeCommand` 发布 `std_msgs/String` mock 消息。

未在本机验证：

```bash
colcon build --packages-select bt_ros2
ros2 launch bt_ros2 bt_executor.launch.py tree_file:=...
ros2 topic pub/echo ...
```

原因：当前机器没有 ROS2/rclcpp/colcon 环境。
