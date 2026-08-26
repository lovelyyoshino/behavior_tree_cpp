/**
 * call_service_nodes.cpp - Trigger and SetBool BT service action behavior.
 *
 * @author pony
 * @date 2026-08-19
 * @version v1.0.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.0.0 (2026-08-19): implement typed request and response mapping
 */
#include "bt_ros2/call_service_nodes.hpp"

#include <memory>

namespace bt_ros2 {

CallTriggerServiceNode::SharedRequest
CallTriggerServiceNode::makeRequest() {
  return std::make_shared<std_srvs::srv::Trigger::Request>();
}

bt_core::NodeStatus CallTriggerServiceNode::handleResponse(
    const SharedResponse& response) {
  if (!response) {
    onTransportFailure("ROS2 Trigger service 返回空响应");
    return bt_core::NodeStatus::FAILURE;
  }
  setOutput<std::string>("message", response->message);
  return response->success ? bt_core::NodeStatus::SUCCESS
                           : bt_core::NodeStatus::FAILURE;
}

void CallTriggerServiceNode::onTransportFailure(const std::string& message) {
  setOutput<std::string>("message", message);
}

CallSetBoolServiceNode::SharedRequest
CallSetBoolServiceNode::makeRequest() {
  auto request = std::make_shared<std_srvs::srv::SetBool::Request>();
  request->data = getInput<bool>("data").value_or(false);
  return request;
}

bt_core::NodeStatus CallSetBoolServiceNode::handleResponse(
    const SharedResponse& response) {
  if (!response) {
    onTransportFailure("ROS2 SetBool service 返回空响应");
    return bt_core::NodeStatus::FAILURE;
  }
  setOutput<std::string>("message", response->message);
  return response->success ? bt_core::NodeStatus::SUCCESS
                           : bt_core::NodeStatus::FAILURE;
}

void CallSetBoolServiceNode::onTransportFailure(const std::string& message) {
  setOutput<std::string>("message", message);
}

}  // namespace bt_ros2
