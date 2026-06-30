// ============================================================================
//  bt_ros2/ros_publisher_node.hpp
//  ROS2 发布型状态节点的可复用基类 —— 把"状态完成→发给 ROS2"收敛成
//  "继承 + 实现一个 buildMsg() 方法"。
//
//  ────────────────────────────────────────────────────────────────────────
//  对称设计
//  ────────────────────────────────────────────────────────────────────────
//    ros_subscriber_node.hpp 解决了"ROS2 → 状态"的数据录入；
//    本头文件解决对称的"状态 → ROS2"——状态本拍完成时把结果发给 ROS。
//    这样一对基类完整覆盖了"行为树状态"和"ROS2 话题"的双向桥接。
//
//  ────────────────────────────────────────────────────────────────────────
//  典型用法：状态完成后通知 ROS2，流程交给父控制节点自动判断
//  ────────────────────────────────────────────────────────────────────────
//    场景："巡逻状态完成 → 发送 task_done 通知 → 后续节点据状态决定流程"。
//    Sequence 控制节点遇 FAILURE 立即短路、SUCCESS 继续——这就是"状态自判流程"。
//
//    class TaskDoneNotifier : public RosOutputNode<std_msgs::msg::String> {
//     public:
//      using RosOutputNode::RosOutputNode;
//      static PortsList providedPorts() {
//        auto p = publisherPorts();
//        p.insert(InputPort<std::string>("task_name", "patrol", "上报的任务名"));
//        return p;
//      }
//      bool buildMsg(std_msgs::msg::String& msg) override {
//        msg.data = "task_done:" + getInput<std::string>("task_name").value_or("?");
//        return true;  // 返回 true → 发送 + SUCCESS；返回 false → 不发送 + FAILURE
//      }
//    };
//    // XML: <TaskDoneNotifier topic="/bt/task_done" task_name="patrol"/>
//
//  ────────────────────────────────────────────────────────────────────────
//  公共端口
//  ────────────────────────────────────────────────────────────────────────
//    topic     (input) 要发布到的话题名
//    qos_depth (input) 发布 QoS 队列深度，默认 10
// ============================================================================
#ifndef BT_ROS2_ROS_PUBLISHER_NODE_HPP
#define BT_ROS2_ROS_PUBLISHER_NODE_HPP

#include <memory>
#include <string>

#include "bt_core/leaf_node.hpp"
#include "bt_core/node_status.hpp"
#include "bt_ros2/ros_blackboard_keys.hpp"
#include "rclcpp/rclcpp.hpp"

namespace bt_ros2 {

/**
 * @brief 发布型动作节点基类。
 * @tparam MsgT ROS2 消息类型(如 std_msgs::msg::String)。
 *
 * 子类只需实现 `buildMsg(MsgT& out) -> bool`，在里面用 `getInput<T>(port)` 从黑板
 * 读取数据并填充消息字段。返回 true 表示消息已构造好可以发送(发送后返回 SUCCESS)；
 * 返回 false 表示拒绝发送(节点返回 FAILURE，由父控制节点决定走向)。
 *
 * 此节点是**同步动作**：发布即视为完成，单拍 SUCCESS/FAILURE，不返回 RUNNING。
 * 若需异步桥接 ROS2 Action / 长耗时服务，参考 ros_topic_action_node.cpp 末尾
 * 的扩展提示，自行写异步 Action 节点。
 */
template <typename MsgT>
class RosOutputNode : public bt_core::ActionNode {
public:
  using bt_core::ActionNode::ActionNode;  // 继承 (std::string, NodeConfig) 构造

  /// @brief 公共端口：topic / qos_depth。子类如需追加自定义端口，在自己的
  ///        providedPorts() 里合并本函数返回值即可（同 RosSubscriberNodeBase）。
  static bt_core::PortsList publisherPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>("topic", "", "要发布到的话题名"),
        bt_core::InputPort<int>("qos_depth", "10", "发布 QoS 队列深度"));
  }

  static bt_core::PortsList providedPorts() { return publisherPorts(); }

  /// @brief 子类实现：构造要发布的消息。
  /// @param out [out] 待填充的消息对象。
  /// @return true → 发送 out 并返回 SUCCESS；false → 不发送，返回 FAILURE。
  virtual bool buildMsg(MsgT& out) = 0;

  bt_core::NodeStatus tick() override final {
    ensurePublisher();

    MsgT msg{};
    if (!buildMsg(msg)) {
      // 子类显式拒绝发送：父控制节点把它当一次失败处理(Sequence 短路、Fallback 走下一候选)。
      return bt_core::NodeStatus::FAILURE;
    }
    pub_->publish(msg);
    return bt_core::NodeStatus::SUCCESS;
  }

private:
  /// @brief 首次 tick 惰性创建发布器(此时才能从黑板拿到 ROS 句柄)。
  void ensurePublisher() {
    if (pub_) return;

    rclcpp::Node* node = getRosNodeHandle(this->blackboard());

    const std::string topic = this->template getInput<std::string>("topic").value_or("");
    if (topic.empty()) {
      throw std::runtime_error("RosOutputNode '" + this->name() +
                               "': 端口 'topic' 未设置");
    }
    const int depth = this->template getInput<int>("qos_depth").value_or(10);

    pub_ = node->template create_publisher<MsgT>(
        topic, rclcpp::QoS(rclcpp::KeepLast(depth)));
  }

  typename rclcpp::Publisher<MsgT>::SharedPtr pub_;  ///< 发布器(惰性)
};

}  // namespace bt_ros2

#endif  // BT_ROS2_ROS_PUBLISHER_NODE_HPP
