/**
 * ros_graph_utils.hpp - ROS graph capability discovery shared by executor and BT nodes.
 *
 * @author pony
 * @date 2026-08-19
 * @version v1.0.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.0.0 (2026-08-19): add node/topic/service/action discovery and exact lookup
 */
#ifndef BT_ROS2_ROS_GRAPH_UTILS_HPP
#define BT_ROS2_ROS_GRAPH_UTILS_HPP

#include <map>
#include <string>
#include <vector>

#include "rclcpp/rclcpp.hpp"

namespace bt_ros2 {

struct RosGraphSnapshot {
  std::vector<std::string> nodes;
  std::map<std::string, std::vector<std::string>> topics;
  std::map<std::string, std::vector<std::string>> services;
  std::map<std::string, std::vector<std::string>> actions;
};

/** Read a current graph snapshot without caching business-specific names. */
RosGraphSnapshot inspectRosGraph(const rclcpp::Node& node);

/** Match one exact node/topic/service/action name in a current snapshot. */
bool rosGraphEntityExists(const RosGraphSnapshot& snapshot,
                          const std::string& entity_type,
                          const std::string& entity_name);

}  // namespace bt_ros2

#endif  // BT_ROS2_ROS_GRAPH_UTILS_HPP
