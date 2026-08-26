// ============================================================================
//  bt_ros2/include/bt_ros2/command_subscriber_node.hpp
//  CommandSubscriber —— 订阅一个 String 话题并写入黑板，供命令切换分支读取。
//
//  职责：
//    把外部通过 ROS2 话题（如 /robot/command 的 "patrol"/"idle"）下发的命令，
//    在每次收到新消息时写入黑板键 out。它本身返回 SUCCESS（写入成功），
//    父级用 KeepRunningUntilFailure 包住即可保持跨 tick 持续刷新。
//
//  设计要点（与 ros_subscriber_node.hpp 对齐）：
//    - 继承 RosInputNode<std_msgs::msg::String>：实现 onData 写黑板即可。
//    - 公共端口复用 subscriberPorts()：topic / timeout_ms / qos_depth / qos_profile。
//    - 追加输出端口 out：把命令字符串写入黑板，供 CompareBlackboard 等下游读取。
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增命令订阅节点
// ============================================================================
#ifndef BT_ROS2_COMMAND_SUBSCRIBER_NODE_HPP
#define BT_ROS2_COMMAND_SUBSCRIBER_NODE_HPP

#include <string>

#include "bt_ros2/ros_subscriber_node.hpp"
#include "std_msgs/msg/string.hpp"

namespace bt_ros2 {

/**
 * @brief 订阅 String 话题并写入黑板的输入节点。
 *
 * @code{.xml}
 *   <CommandSubscriber topic="/robot/command" out="{current_command}" timeout_ms="0"/>
 * @endcode
 */
class CommandSubscriber : public RosInputNode<std_msgs::msg::String> {
public:
  using RosInputNode::RosInputNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "订阅一个 String 话题，把最新命令写入黑板，供后续分支按命令切换。",
        "topic 填命令话题名；out 建议绑定到 {current_command} 供下游读取。父级通常用 KeepRunningUntilFailure 包住以持续刷新。",
        "收到新鲜消息写入黑板后返回 SUCCESS；无新鲜数据返回 FAILURE（除非覆盖 onNoFreshData 为 RUNNING）。",
        "topic 为空、ROS 句柄未注入或订阅创建失败返回 FAILURE。",
        R"(<CommandSubscriber topic="/robot/command" out="{current_command}" timeout_ms="0"/>)"};
  }

  static bt_core::PortsList providedPorts() {
    auto p = subscriberPorts();
    p.insert(bt_core::OutputPort<std::string>("out", "写入黑板的命令字符串"));
    return p;
  }

  void onData(const std_msgs::msg::String& msg) override {
    setOutput<std::string>("out", msg.data);
  }
};

}  // namespace bt_ros2

#endif  // BT_ROS2_COMMAND_SUBSCRIBER_NODE_HPP
