// ============================================================================
//  bt_ros2/bt_executor_node.hpp
//  BtExecutorNode —— 把 bt_core 行为树“跑”在 ROS2 里的执行器节点。
//
//  @author lovelyyoshino
//  @date 2026-06-30
//  @version v1.2.0
//  @last_modified 2026-08-18
//  @changelog
//    - v1.3.0 (2026-08-18): 发布真实 ROS graph 与 factory manifest 能力快照
//    - v1.2.0 (2026-08-18): 串行化 tick、服务与调试回调，防止多线程 executor 争抢树状态
//    - v1.1.0 (2026-07-13): 增加可外部调用且幂等的 start/stop Trigger 服务
//
//  职责（一个标准的 rclcpp::Node 包装器）：
//    1. 从 ROS2 参数读取：
//         - tree_file    : 要加载的行为树 XML 路径
//         - tick_rate_hz : 周期 tick 频率（Hz）
//         - status_topic : 发布根状态的 topic 名
//         - autostart    : 是否在构造后立即开始 tick
//    2. 构造 NodeFactory，注册：
//         - bt_ros2 的 ROS 适配器节点（条件/动作）
//         - bt_nodes 的常用控制/装饰节点（Sequence/Fallback/Parallel/Inverter/Retry）
//    3. 把自身（rclcpp::Node*）写入共享黑板（供适配器节点桥接 ROS，见
//       ros_blackboard_keys.hpp），再用 XmlParser 从文件加载成 Tree。
//    4. 用一个 ROS2 wall timer 周期性 tickOnce()，并把根节点状态发布到 status_topic。
//
//  设计取舍：
//    - 核心库 bt_core 始终零 ROS 依赖；ROS 的“时间驱动 + 参数 + 话题”全部封装在本类，
//      这正是 architecture.md 第 5 节“bt_ros2 为可选包”的体现。
//    - tick 由 ROS executor 的单线程定时器驱动，避免在节点 tick 里手动 sleep。
// ============================================================================
#ifndef BT_ROS2_BT_EXECUTOR_NODE_HPP
#define BT_ROS2_BT_EXECUTOR_NODE_HPP

#include <memory>
#include <cstdint>
#include <chrono>
#include <mutex>
#include <unordered_map>
#include <string>

#include "bt_core/node_factory.hpp"
#include "bt_core/tree.hpp"
#include "rclcpp/rclcpp.hpp"
#include "std_msgs/msg/string.hpp"
#include "std_srvs/srv/trigger.hpp"

namespace bt_ros2 {

/**
 * @brief 周期性 tick 一棵 bt_core 行为树的 ROS2 执行器节点。
 */
class BtExecutorNode : public rclcpp::Node {
public:
  /**
   * @param options ROS2 节点选项（支持参数覆盖、remap、intra-process 等）。
   */
  explicit BtExecutorNode(
      const rclcpp::NodeOptions& options = rclcpp::NodeOptions());

  /// @brief 手动开始周期 tick（autostart=false 时由外部调用）。
  void start();

  /// @brief 停止周期 tick 并 halt 行为树（释放正在 RUNNING 的子树）。
  void stop();

private:
  using Trigger = std_srvs::srv::Trigger;

  /// @brief 声明并读取本节点的 ROS2 参数（带默认值）。
  void declareAndLoadParameters();

  /// @brief 向工厂注册 ROS 适配器节点 + bt_nodes 常用节点。
  void registerNodeTypes();

  /// @brief 加载 tree_file 指定的 XML 为可执行 Tree（失败抛 runtime_error）。
  void loadTree();

  /// @brief timer 回调：tick 一拍 + 发布根状态。
  void onTick();

  /// @brief 发布一份可由只读 Web 观察器消费的完整运行快照。
  void publishTreeSnapshot(bt_core::NodeStatus root_status);

  /// @brief 发布当前工厂清单和 ROS graph，供编辑器动态生成候选项。
  void publishCapabilities();

  /// @brief 发布 start/stop service 生命周期事件。
  void publishServiceEvent(const std::string& interface_name,
                           const std::string& call_id,
                           const std::string& phase,
                           bool success,
                           const std::string& message,
                           std::int64_t duration_ms);

  /// @brief 处理 ~/start：幂等地启动周期 tick。
  void handleStart(
      const std::shared_ptr<Trigger::Request>,
      std::shared_ptr<Trigger::Response> response);

  /// @brief 处理 ~/stop：幂等地停止 tick 并 halt 行为树。
  void handleStop(
      const std::shared_ptr<Trigger::Request>,
      std::shared_ptr<Trigger::Response> response);

  /// @brief Debug sandbox controls. These services exist only in debug_mode.
  void handlePause(const std::shared_ptr<Trigger::Request>,
                   std::shared_ptr<Trigger::Response> response);
  void handleResume(const std::shared_ptr<Trigger::Request>,
                    std::shared_ptr<Trigger::Response> response);
  void handleStep(const std::shared_ptr<Trigger::Request>,
                  std::shared_ptr<Trigger::Response> response);
  void handleReload(const std::shared_ptr<Trigger::Request>,
                    std::shared_ptr<Trigger::Response> response);

  /// @brief Apply a line-based condition override command from the debug Web node.
  /// Format: scenario_id|node/2=SUCCESS,node/4=FAILURE (empty list clears all).
  void handleDebugOverrides(const std_msgs::msg::String& message);

  void publishDebugState();
  void publishDebugServiceEvent(const std::string& action,
                                const std::string& call_id,
                                const std::string& phase,
                                bool success,
                                const std::string& message,
                                std::int64_t duration_ms);

  // -- 配置参数（来自 ROS2 param）------------------------------------------
  std::string tree_file_;          ///< 行为树 XML 文件路径
  double      tick_rate_hz_{10.0}; ///< tick 频率（Hz）
  std::string status_topic_{"~/bt_status"};  ///< 根状态发布 topic
  std::string snapshot_topic_{"~/tree_snapshot"};  ///< 完整节点快照 topic
  std::string service_event_topic_{"~/service_event"};  ///< service 事件 topic
  std::string capabilities_topic_{"~/capabilities"};  ///< 动态节点/topic 能力 topic
  bool        autostart_{true};    ///< 是否构造后自动开始
  bool        stop_on_terminal_{false};  ///< 根节点终结后是否停止 tick
  bool        debug_mode_{false};  ///< 是否启用隔离 debug 控制面
  std::string debug_state_topic_{"~/debug_state"};
  std::string debug_override_topic_{"~/debug_overrides"};

  // -- bt_core 运行期对象 ---------------------------------------------------
  bt_core::NodeFactory     factory_;     ///< 节点工厂（注册 + 建树）
  bt_core::Blackboard::Ptr blackboard_;  ///< 共享黑板（持有 ROS 句柄）
  std::unique_ptr<bt_core::Tree> tree_;  ///< 已加载的行为树
  std::string session_id_;      ///< 本次执行器进程的观察会话 ID
  std::string tree_revision_;   ///< XML 内容的稳定 FNV-1a revision
  std::string tree_id_;         ///< 网页展示用主树标识
  std::uint64_t snapshot_sequence_{0};
  std::uint64_t service_event_sequence_{0};
  std::uint64_t service_call_sequence_{0};
  std::uint64_t capabilities_sequence_{0};
  std::uint64_t session_sequence_{0};
  std::string debug_scenario_id_{"all_auto"};
  std::chrono::steady_clock::time_point last_capabilities_publish_{};
  std::unordered_map<std::uint16_t, bt_core::NodeStatus> debug_overrides_;
  // Tree/Blackboard 按单线程设计；所有可能触达运行态的入口统一经过此锁。
  mutable std::recursive_mutex execution_mutex_;

  // -- ROS2 资源 ------------------------------------------------------------
  rclcpp::TimerBase::SharedPtr timer_;   ///< 周期 tick 定时器
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;  ///< 根状态发布器
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr snapshot_pub_;  ///< 树快照发布器
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr service_event_pub_;  ///< service 事件发布器
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr capabilities_pub_;  ///< 动态能力发布器
  rclcpp::Service<Trigger>::SharedPtr start_service_;  ///< 幂等启动服务
  rclcpp::Service<Trigger>::SharedPtr stop_service_;   ///< 幂等停止服务
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr debug_state_pub_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr debug_override_sub_;
  rclcpp::Service<Trigger>::SharedPtr pause_service_;
  rclcpp::Service<Trigger>::SharedPtr resume_service_;
  rclcpp::Service<Trigger>::SharedPtr step_service_;
  rclcpp::Service<Trigger>::SharedPtr reload_service_;
};

}  // namespace bt_ros2

#endif  // BT_ROS2_BT_EXECUTOR_NODE_HPP
