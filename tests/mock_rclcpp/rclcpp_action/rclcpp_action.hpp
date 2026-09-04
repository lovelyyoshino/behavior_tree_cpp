/**
 * rclcpp_action.hpp — 测试用 rclcpp_action 最小实现。
 *
 * 覆盖 FollowPathNode 实际使用的 API 表面：ResultCode、ClientGoalHandle、
 * Client::SendGoalOptions（goal_response_callback / result_callback）、
 * wait_for_action_server / async_send_goal / async_cancel_goal、create_client。
 * 回调由测试钩子同步触发，不模拟真实 action server 的异步握手。
 *
 * @author pony
 * @date 2026-09-04
 * @version v1.0.0
 * @last_modified 2026-09-04
 * @changelog
 *   - v1.0.0 (2026-09-04): 初始创建，让 test_ros_bases 在零 ROS2 环境编译
 */
#pragma once

#include <chrono>
#include <functional>
#include <memory>

#include "rclcpp/rclcpp.hpp"

namespace rclcpp_action {

enum class ResultCode {
  UNKNOWN = 0,
  SUCCEEDED = 1,
  CANCELED = 2,
  ABORTED = 3,
};

template <typename ActionT>
struct ClientGoalHandle {
  using SharedPtr = std::shared_ptr<ClientGoalHandle<ActionT>>;
  bool accepted{true};
};

template <typename ActionT>
class Client {
 public:
  using SharedPtr = std::shared_ptr<Client<ActionT>>;
  using GoalHandle = ClientGoalHandle<ActionT>;

  struct WrappedResult {
    typename GoalHandle::SharedPtr goal_handle;
    ResultCode code{ResultCode::UNKNOWN};
    typename ActionT::Result::SharedPtr result;
  };

  struct SendGoalOptions {
    std::function<void(typename GoalHandle::SharedPtr)> goal_response_callback;
    std::function<void(const WrappedResult&)> result_callback;
    std::function<void(typename GoalHandle::SharedPtr,
                       typename ActionT::Feedback::SharedPtr)>
        feedback_callback;
  };

  explicit Client(std::string server_name) : server_name_(std::move(server_name)) {}

  bool wait_for_action_server(const std::chrono::nanoseconds& /*timeout*/) {
    return server_available_;
  }

  // 默认收下 goal 并立即以 SUCCEEDED 回包；测试可改钩子模拟拒绝或失败。
  void async_send_goal(const typename ActionT::Goal& goal,
                       const SendGoalOptions& opts) {
    last_goal_ = goal;
    if (reject_goal_) {
      if (opts.goal_response_callback) opts.goal_response_callback(nullptr);
      return;
    }
    auto handle = std::make_shared<GoalHandle>();
    active_handle_ = handle;
    if (opts.goal_response_callback) opts.goal_response_callback(handle);
    if (complete_immediately_ && opts.result_callback) {
      WrappedResult wr;
      wr.goal_handle = handle;
      wr.code = immediate_result_code_;
      wr.result = std::make_shared<typename ActionT::Result>();
      opts.result_callback(wr);
      active_handle_.reset();
    }
  }

  void async_cancel_goal(const typename GoalHandle::SharedPtr& /*handle*/) {
    cancel_requested_ = true;
    active_handle_.reset();
  }

  // ---- 测试钩子 ----
  bool server_available_{true};
  bool reject_goal_{false};
  bool complete_immediately_{true};
  ResultCode immediate_result_code_{ResultCode::SUCCEEDED};
  bool cancel_requested_{false};
  typename ActionT::Goal last_goal_{};
  typename GoalHandle::SharedPtr active_handle_;

  // 未立即回包时，由测试主动派发结果。
  void deliver_result(ResultCode code, const SendGoalOptions& opts) {
    WrappedResult wr;
    wr.goal_handle = active_handle_;
    wr.code = code;
    wr.result = std::make_shared<typename ActionT::Result>();
    if (opts.result_callback) opts.result_callback(wr);
    active_handle_.reset();
  }

  const std::string& server_name() const { return server_name_; }

 private:
  std::string server_name_;
};

template <typename ActionT>
typename Client<ActionT>::SharedPtr create_client(rclcpp::Node* /*node*/,
                                                  const std::string& server_name) {
  return std::make_shared<Client<ActionT>>(server_name);
}

}  // namespace rclcpp_action
