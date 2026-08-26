/**
 * ros_service_action_node.hpp - Non-blocking ROS2 service action lifecycle.
 *
 * @author pony
 * @date 2026-08-19
 * @version v1.0.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.0.0 (2026-08-19): add reusable RUNNING/future/timeout/halt service state machine
 */
#ifndef BT_ROS2_ROS_SERVICE_ACTION_NODE_HPP
#define BT_ROS2_ROS_SERVICE_ACTION_NODE_HPP

#include <chrono>
#include <cstdint>
#include <future>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>

#include "bt_core/leaf_node.hpp"
#include "bt_ros2/ros_blackboard_keys.hpp"
#include "rclcpp/rclcpp.hpp"

namespace bt_ros2 {

/**
 * Shared asynchronous service state machine for concrete, compile-time service
 * types. ROS2 service payloads are not safely constructible from arbitrary
 * strings, so generic discovery remains separate from typed request nodes.
 */
template <typename ServiceT>
class RosServiceActionNode : public bt_core::ActionNode {
public:
  using bt_core::ActionNode::ActionNode;
  using Client = rclcpp::Client<ServiceT>;
  using SharedRequest = typename ServiceT::Request::SharedPtr;
  using SharedResponse = typename ServiceT::Response::SharedPtr;

  bt_core::NodeStatus tick() override {
    try {
      if (!attempt_started_) {
        const auto service_name = getInput<std::string>("service_name");
        if (!service_name || service_name->empty()) {
          onTransportFailure("service_name 不能为空");
          return bt_core::NodeStatus::FAILURE;
        }
        ensureClient(*service_name);
        attempt_started_ = true;
        attempt_started_at_ = std::chrono::steady_clock::now();
      }

      if (!future_.valid()) {
        if (!client_->service_is_ready()) {
          if (timedOut()) {
            onTransportFailure("等待 ROS2 service 可用超时");
            resetAttempt(false);
            return bt_core::NodeStatus::FAILURE;
          }
          return bt_core::NodeStatus::RUNNING;
        }
        auto pending = client_->async_send_request(makeRequest());
        request_id_ = pending.request_id;
        future_ = pending.future.share();
        return bt_core::NodeStatus::RUNNING;
      }

      if (future_.wait_for(std::chrono::seconds(0)) != std::future_status::ready) {
        if (timedOut()) {
          onTransportFailure("等待 ROS2 service 响应超时");
          resetAttempt(true);
          return bt_core::NodeStatus::FAILURE;
        }
        return bt_core::NodeStatus::RUNNING;
      }

      SharedResponse response = future_.get();
      resetAttempt(false);
      return handleResponse(response);
    } catch (const std::exception& error) {
      resetAttempt(true);
      onTransportFailure(error.what());
      return bt_core::NodeStatus::FAILURE;
    }
  }

  void onHalted() override { resetAttempt(true); }

protected:
  virtual SharedRequest makeRequest() = 0;
  virtual bt_core::NodeStatus handleResponse(const SharedResponse& response) = 0;
  virtual void onTransportFailure(const std::string& message) = 0;

private:
  void ensureClient(const std::string& service_name) {
    if (client_ && resolved_service_name_ == service_name) return;
    rclcpp::Node* ros_node = getRosNodeHandle(blackboard());
    client_ = ros_node->create_client<ServiceT>(service_name);
    resolved_service_name_ = service_name;
  }

  bool timedOut() const {
    const double timeout_sec =
        getInput<double>("timeout_sec").value_or(2.0);
    if (timeout_sec <= 0.0) return false;
    return std::chrono::steady_clock::now() - attempt_started_at_ >=
           std::chrono::duration<double>(timeout_sec);
  }

  void resetAttempt(bool remove_pending_request) {
    if (remove_pending_request && client_ && request_id_) {
      client_->remove_pending_request(*request_id_);
    }
    future_ = typename Client::SharedFuture{};
    request_id_.reset();
    attempt_started_ = false;
  }

  typename Client::SharedPtr client_;
  typename Client::SharedFuture future_;
  std::optional<std::int64_t> request_id_;
  std::string resolved_service_name_;
  bool attempt_started_{false};
  std::chrono::steady_clock::time_point attempt_started_at_{};
};

}  // namespace bt_ros2

#endif  // BT_ROS2_ROS_SERVICE_ACTION_NODE_HPP
