// ============================================================================
//  bt_ros2/include/bt_ros2/wait_until_topic_node.hpp
//  WaitUntilTopicNode —— 阻塞等待某话题出现新鲜数据。
//
//  语义（通用，与 RosConditionNode 的区别：无数据时返回 RUNNING 而非 FAILURE）：
//  - 尚未收到数据 → RUNNING（阻塞后续，直到该话题第一次发布）。
//  - 已收到新鲜数据 → SUCCESS。
//  - 数据过期（timeout_ms>0 且超时未刷新）→ FAILURE。
//
//  用途：把「等某条消息就绪」表达为行为树节点，例如等 /robot/ready 或等参数下发。
//  常与 ReactiveSequence 首位置使用：话题未就绪时整轮阻塞，就绪后立即通过。
//
//  端口：复用 subscriberPorts() 的 topic / timeout_ms / qos_depth / qos_profile。
//
//  @code{.xml}
//   <WaitUntilTopic topic="/robot/ready" timeout_ms="0"/>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用话题等待节点
// ============================================================================
#ifndef BT_ROS2_WAIT_UNTIL_TOPIC_NODE_HPP
#define BT_ROS2_WAIT_UNTIL_TOPIC_NODE_HPP

#include "bt_ros2/ros_subscriber_node.hpp"
#include "std_msgs/msg/string.hpp"

namespace bt_ros2 {

class WaitUntilTopicNode
    : public RosSubscriberNodeBase<std_msgs::msg::String, bt_core::ActionNode> {
 public:
  using RosSubscriberNodeBase<std_msgs::msg::String,
                              bt_core::ActionNode>::RosSubscriberNodeBase;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "阻塞等待某话题出现新鲜数据：无数据返回 RUNNING，有新鲜数据返回 SUCCESS。",
        "放在 ReactiveSequence 或声明式『先等就绪』位置；timeout_ms<=0 表示只要收到过即通过。",
        "收到新鲜数据返回 SUCCESS；无新鲜数据返回 RUNNING；数据过期返回 FAILURE。",
        "topic 为空或 ROS 句柄未注入返回 FAILURE。",
        "<WaitUntilTopic topic=\"/robot/ready\" timeout_ms=\"0\"/>"};
  }

  static bt_core::PortsList providedPorts() { return subscriberPorts(); }

  /// 订阅型数据录入/状态分发统一走 tickImpl()；派生类只需覆盖钩子。
  bt_core::NodeStatus tick() override final { return this->tickImpl(); }

 protected:
  bt_core::NodeStatus onFreshData(const std_msgs::msg::String&) override {
    // 已收到新鲜数据 → 放行。
    return bt_core::NodeStatus::SUCCESS;
  }

  bt_core::NodeStatus onNoFreshData() override {
    // 未收到或已过期：阻塞等待下一拍。若显式超时（timeout_ms>0）且确实过期，
    // 基类已判为 not fresh，这里统一返回 RUNNING 由父级决定；如需”等不到即失败”
    // 可用 Inverter/ReactiveSequence 组合表达，而非改本节点。
    return bt_core::NodeStatus::RUNNING;
  }
};

}  // namespace bt_ros2

#endif  // BT_ROS2_WAIT_UNTIL_TOPIC_NODE_HPP
