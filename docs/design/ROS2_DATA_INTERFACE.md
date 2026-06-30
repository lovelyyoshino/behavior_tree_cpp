# ROS2 数据接入接口契约（已验证，文档/测试 agent 必读）

> bt_ros2 新增的"在状态里接收 ROS2 数据"可复用接口。本机无 ROS2，rclcpp 部分
> 用 mock 验证了模板形状 + 分派逻辑（exit=0）；纯逻辑部分有完整单测。
> 路径相对 `/Users/pony.ai/Documents/文档/behavior_tree_cpp`。

## 新增文件
- `bt_ros2/include/bt_ros2/data_freshness.hpp` — **ROS-free 纯逻辑**，数据新鲜度判定，本机可单测
- `bt_ros2/include/bt_ros2/ros_subscriber_node.hpp` — 可复用订阅基类（核心）
- `bt_ros2/include/bt_ros2/example_data_nodes.hpp` — 开箱即用范例节点（需真实 ROS2 msg）

## data_freshness.hpp（纯逻辑，可本机测）
```cpp
namespace bt_ros2 {
  using SteadyTime = std::chrono::steady_clock::time_point;
  // received: 是否收到过; timeout_ms<=0 表示永不过期; 防时钟回拨
  bool isFresh(bool received, SteadyTime last_recv, SteadyTime now, int timeout_ms);
  long dataAgeMs(bool received, SteadyTime last_recv, SteadyTime now); // 从未收到返回 -1
}
```
已验证：从未收到→不新鲜；timeout<=0→收到过即新鲜；窗口边界（age==timeout 仍算新鲜）；窗口外过期；时钟回拨视为刚收到。

## ros_subscriber_node.hpp（核心可复用基类）
三个模板，用户**只继承别名基类、只实现一个方法**：

```cpp
// 用法 A：把 ROS2 数据当条件
template <typename MsgT>
class RosConditionNode : public ... {
  virtual bool evaluate(const MsgT& msg) = 0;   // ← 用户只写这个
};

// 用法 B：把 ROS2 数据录入黑板
template <typename MsgT>
class RosInputNode : public ... {
  virtual void onData(const MsgT& msg) = 0;     // ← 用户只写这个，里面 setOutput
};
```

**公共端口**（所有子类自动拥有，来自 `subscriberPorts()`）：
- `topic` (input) 订阅话题名
- `timeout_ms` (input) 数据时效窗口，<=0 永不过期
- `qos_depth` (input) QoS 队列深度，默认 10

**追加自定义端口**的模式（已验证）：
```cpp
static PortsList providedPorts() {
  auto p = subscriberPorts();                           // 复用公共端口
  p.insert(InputPort<double>("threshold","0.5","阈值")); // 追加自有
  return p;
}
```

**钩子语义**：
- 有新鲜数据 → RosConditionNode 走 evaluate→SUCCESS/FAILURE；RosInputNode 走 onData→SUCCESS
- 无新鲜数据（从未收到 or 已过期）→ `onNoFreshData()`，默认 FAILURE；可覆盖为 RUNNING 实现"阻塞等首帧"

**线程模型前提**：BtExecutorNode 用**单线程 executor**，tick 与订阅回调同线程交替，无竞争、无需锁。多线程 executor 需自行加锁。

**句柄获取**：复用现有 `ros_blackboard_keys.hpp` 的 `getRosNodeHandle(blackboard)`；BtExecutorNode 建树前 `setRosNodeHandle(bb, this)`。首次 tick 惰性 create_subscription。

## example_data_nodes.hpp（范例，照抄模板）
- `IsObstacleClose`（RosConditionNode<Range>，带 threshold 端口）
- `IsFlagTrue`（RosConditionNode<Bool>）
- `ReadBattery`（RosInputNode<BatteryState>，输出端口 level）
- `ReadScalar`（RosInputNode<Float64>，输出端口 value）

## 已验证（exit=0，mock rclcpp + 纯逻辑单测）
1. data_freshness 全部边界
2. RosConditionNode：无数据→FAILURE；evaluate 真→SUCCESS/假→FAILURE；多次数据更新
3. RosInputNode：onData 写黑板 + SUCCESS
4. providedPorts 合并自定义端口（共 4 端口）+ 自定义阈值读取
