# bt_ros2：bt_core 的可选 ROS2 wrapper

`bt_ros2` 把零 ROS 依赖的 `bt_core` 行为树接到 ROS2 的参数、topic、timer 上。核心库不依赖 ROS2；本包只在 ROS2/ament 环境编译。

## 1. 设计边界

```text
ROS2 topic/timer/param
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
| `include/bt_ros2/bt_executor_node.hpp` / `src/bt_executor_node.cpp` | ROS2 执行器：参数、注册、加载树、周期 tick、发布根状态 |
| `include/bt_ros2/node_registration.hpp` | 单例注册目录 + 注册函数引用列表，统一注册默认节点 |
| `include/bt_ros2/ros_subscriber_node.hpp` | `RosConditionNode<MsgT>` / `RosInputNode<MsgT>` 订阅基类 |
| `include/bt_ros2/ros_publisher_node.hpp` | `RosOutputNode<MsgT>` 发布基类 |
| `include/bt_ros2/example_data_nodes.hpp` | `ReadBattery`、`ReadScalar`、`IsDocked`、`PublishRechargeCommand` 等开箱节点 |
| `trees/example.xml` | 最小 topic 条件/动作示例 |
| `trees/recharge.xml` | 外部 BatteryState 消息驱动回充的完整示例 |
| `launch/bt_executor.launch.py` | launch 参数入口 |

## 3. BtExecutorNode 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `tree_file` | string | `""` | 必填，行为树 XML 文件路径 |
| `tick_rate_hz` | double | `10.0` | tick 频率 |
| `status_topic` | string | `~/bt_status` | 根状态发布 topic |
| `autostart` | bool | `true` | 构造后是否自动 tick |
| `stop_on_terminal` | bool | `false` | 根节点 SUCCESS/FAILURE 后是否停止 tick |

`stop_on_terminal=false` 是 ROS2 topic 驱动场景的推荐值。首拍无消息时树可能返回 `FAILURE`，执行器仍要继续 tick 等待后续 topic。

注意默认值来源有两层：`BtExecutorNode` 节点参数默认 `tick_rate_hz=10.0`；仓库提供的 `bt_executor.launch.py` 为演示更易观察，launch 参数默认覆盖为 `tick_rate_hz=2.0`。命令行传入 `tick_rate_hz:=5.0` 时以 launch 参数为准。

## 4. 默认注册节点

`BtExecutorNode` 调用：

```cpp
bt_ros2::registerDefaultNodes(factory_);
```

默认注册组：

| 注册函数 | 节点 |
|---|---|
| `registerBtNodes` | `Sequence`、`Fallback`、`Parallel`、装饰节点、数据节点、`FunctionAction`、`FunctionCondition` |
| `registerRosTopicNodes` | `RosTopicCondition`、`RosTopicAction` |
| `registerRosDataNodes` | `ReadBattery`、`ReadScalar`、`IsFlagTrue`、`IsObstacleClose` |
| `registerRechargeNodes` | `IsDocked`、`PublishRechargeCommand`、`TaskDoneNotifier` |

如果项目要追加节点，可复用 `NodeRegistrationCatalog::instance().add(yourRegisterFn)`，或在自定义 executor 中直接调用 `factory.registerNodeType<T>()`。

## 5. 构建

### 独立 colcon 工作区

```bash
mkdir -p ~/bt_ws/src
cp -r /path/to/behavior_tree_cpp ~/bt_ws/src/
source /opt/ros/$ROS_DISTRO/setup.bash
cd ~/bt_ws
colcon build --packages-select bt_ros2
source install/setup.bash
```

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

## 7. 回充示例

```bash
ros2 launch bt_ros2 bt_executor.launch.py \
  tree_file:=$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml \
  tick_rate_hz:=5.0 \
  stop_on_terminal:=false
```

另开终端：

```bash
ros2 topic echo /robot/command
ros2 topic pub /battery_state sensor_msgs/msg/BatteryState "{percentage: 0.12}"
ros2 topic pub /dock/is_docked std_msgs/msg/Bool "{data: true}"
ros2 topic echo /bt/task_done
```

预期数据流：

1. `ReadBattery` 订阅 `/battery_state`，把 `percentage` 写入 `{battery_level}`。
2. `CompareBlackboard key="battery_level" op="<" value="0.20"` 判定低电量。
3. `PublishRechargeCommand` 发布 `start_recharge:main_dock` 到 `/robot/command`。
4. `IsDocked` 等待 `/dock/is_docked=true`。
5. `TaskDoneNotifier` 发布 `task_done:recharge`。

完整教程见 [`docs/tutorial/ROS2_RECHARGE_TUTORIAL.md`](../docs/tutorial/ROS2_RECHARGE_TUTORIAL.md)。

## 8. 扩展 ROS2 Action

`RosTopicActionNode` 和 `RosOutputNode` 都是同步发布动作。如果要接长耗时 ROS2 Action：

1. 首拍创建 `rclcpp_action::Client` 并发送 goal，返回 `RUNNING`。
2. 后续 tick 轮询 future/结果回调。
3. 成功返回 `SUCCESS`，失败/取消返回 `FAILURE`。
4. 覆盖 `onHalted()`，取消未完成 goal。

## 9. 验证状态

本机无 ROS2/rclcpp/colcon，因此没有执行真实 `colcon build`、`ros2 launch`、`ros2 topic pub/echo`。

本机已验证的非 ROS 项：

```bash
cmake --build build
ctest --test-dir build --output-on-failure
```

其中 `test_ros_bases` 使用 mock `rclcpp` 覆盖订阅/发布基类，以及 BatteryState -> 黑板 -> 回充命令发布的完整链路。
