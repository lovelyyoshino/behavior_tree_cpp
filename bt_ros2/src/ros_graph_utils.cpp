/**
 * ros_graph_utils.cpp - ROS graph discovery and action inference.
 *
 * @author pony
 * @date 2026-08-19
 * @version v1.0.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.0.0 (2026-08-19): add graph snapshot and action inference implementation
 */
#include "bt_ros2/ros_graph_utils.hpp"

#include <algorithm>
#include <string_view>

namespace bt_ros2 {
namespace {

constexpr std::string_view kActionSendGoalSuffix = "/_action/send_goal";
constexpr std::string_view kActionSendGoalTypeSuffix = "_SendGoal";

bool endsWith(const std::string& value, std::string_view suffix) {
  return value.size() >= suffix.size() &&
         value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

void appendUnique(std::vector<std::string>& values, std::string value) {
  if (std::find(values.begin(), values.end(), value) == values.end()) {
    values.push_back(std::move(value));
  }
}

}  // namespace

RosGraphSnapshot inspectRosGraph(const rclcpp::Node& node) {
  RosGraphSnapshot snapshot;
  snapshot.nodes = node.get_node_names();
  std::sort(snapshot.nodes.begin(), snapshot.nodes.end());
  snapshot.nodes.erase(
      std::unique(snapshot.nodes.begin(), snapshot.nodes.end()),
      snapshot.nodes.end());
  snapshot.topics = node.get_topic_names_and_types();
  snapshot.services = node.get_service_names_and_types();

  // Humble does not expose actions from rclcpp::Node directly. Every ROS2
  // action has a typed /_action/send_goal service, which is the stable graph
  // contract used here instead of maintaining a project-specific action list.
  for (const auto& [service_name, service_types] : snapshot.services) {
    if (!endsWith(service_name, kActionSendGoalSuffix)) continue;
    const std::string action_name = service_name.substr(
        0, service_name.size() - kActionSendGoalSuffix.size());
    if (action_name.empty()) continue;
    for (const std::string& service_type : service_types) {
      if (!endsWith(service_type, kActionSendGoalTypeSuffix)) continue;
      appendUnique(
          snapshot.actions[action_name],
          service_type.substr(
              0, service_type.size() - kActionSendGoalTypeSuffix.size()));
    }
  }
  for (auto& [unused, action_types] : snapshot.actions) {
    (void)unused;
    std::sort(action_types.begin(), action_types.end());
  }
  return snapshot;
}

bool rosGraphEntityExists(const RosGraphSnapshot& snapshot,
                          const std::string& entity_type,
                          const std::string& entity_name) {
  if (entity_type == "node") {
    return std::find(snapshot.nodes.begin(), snapshot.nodes.end(), entity_name) !=
           snapshot.nodes.end();
  }
  if (entity_type == "topic") {
    return snapshot.topics.find(entity_name) != snapshot.topics.end();
  }
  if (entity_type == "service") {
    return snapshot.services.find(entity_name) != snapshot.services.end();
  }
  if (entity_type == "action") {
    return snapshot.actions.find(entity_name) != snapshot.actions.end();
  }
  return false;
}

}  // namespace bt_ros2
