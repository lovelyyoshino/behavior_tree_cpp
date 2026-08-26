/**
 * ros_graph_condition_node.cpp - Generic ROS graph availability condition.
 *
 * @author pony
 * @date 2026-08-19
 * @version v1.0.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.0.0 (2026-08-19): implement current graph lookup on every tick
 */
#include "bt_ros2/ros_graph_condition_node.hpp"

#include "bt_ros2/ros_blackboard_keys.hpp"
#include "bt_ros2/ros_graph_utils.hpp"

namespace bt_ros2 {

bt_core::NodeStatus RosGraphConditionNode::tick() {
  const auto entity_type = getInput<std::string>("entity_type");
  const auto entity_name = getInput<std::string>("entity_name");
  if (!entity_type || !entity_name || entity_name->empty()) {
    return bt_core::NodeStatus::FAILURE;
  }
  rclcpp::Node* ros_node = getRosNodeHandle(blackboard());
  return rosGraphEntityExists(inspectRosGraph(*ros_node), *entity_type,
                              *entity_name)
             ? bt_core::NodeStatus::SUCCESS
             : bt_core::NodeStatus::FAILURE;
}

}  // namespace bt_ros2
