// ============================================================================
//  bt_ros2/include/bt_ros2/follow_path_node.hpp
//  FollowPathNode —— 通用路径跟随节点：把路径话题发给 nav2 FollowPath 动作服务器。
//
//  职责（通用，不绑定任何机器人）：
//    - 连接 server_name（默认 /follow_path）的 nav2_msgs/action/FollowPath。
//    - 订阅 path_topic，把最新 nav_msgs::msg::Path 作为目标发给动作服务器。
//    - 发送后返回 RUNNING；目标成功 SUCCEEDED → SUCCESS，结果其它/被拒 → FAILURE。
//    - onHalted() / halt() 取消未完成目标。
//
//  引入本节点后，Yuyi 树里的 FollowPath 可完全由它替代，只配置 server_name /
//    controller_id / goal_checker_id / path_topic 等端口，无需自定义插件。
//
//  端口：
//  - server_name      (input) FollowPath 动作服务器名，默认 /follow_path
//  - controller_id    (input) 传给动作的 controller_id，默认 ""
//  - goal_checker_id  (input) 传给动作的 goal_checker_id，默认 ""
//  - path_topic       (input) 订阅的路径话题，默认 /reference_path
//  - timeout_sec      (input) 目标超时，<=0 表示不超时
//
//  与 LoadPathFromFile 的自然搭配：前者发布 nav_msgs/Path 到 path_topic，
//  本节点订阅同一话题并把最新路径发送给 nav2 FollowPath 动作服务器。
//
//  @code{.xml}
//   <FollowPath server_name="/follow_path" controller_id="YuyiTEB"
//               goal_checker_id="PrecisionGoalChecker" path_topic="/reference_path"
//               timeout_sec="1000.0"/>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-26
//  @changelog
//    - v1.1.0 (2026-08-26): 移除节点内自建 SingleThreadedExecutor + spin_some，
//      回调改由 main.cpp 主执行器单线程派发，消除第二 executor 与 tick 的调度争抢
//    - v1.0.0 (2026-08-24): 新增通用 nav2 FollowPath 客户端节点
// ============================================================================
#ifndef BT_ROS2_FOLLOW_PATH_NODE_HPP
#define BT_ROS2_FOLLOW_PATH_NODE_HPP

#include <chrono>
#include <memory>
#include <mutex>
#include <string>

#include "bt_core/leaf_node.hpp"
#include "bt_ros2/ros_blackboard_keys.hpp"
#include "nav2_msgs/action/follow_path.hpp"
#include "nav_msgs/msg/path.hpp"
#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"

namespace bt_ros2 {

class FollowPathNode : public bt_core::ActionNode {
 public:
  using bt_core::ActionNode::ActionNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "订阅路径话题并把最新路径发送给 nav2 FollowPath 动作服务器。",
        "path_topic 应与 LoadPathFromFile 的 topic 保持一致；server_name 指向 /follow_path。",
        "目标发送成功且最终 SUCCEEDED 返回 SUCCESS；发送失败或结果 ABORTED/REJECTED 返回 FAILURE；执行中返回 RUNNING。",
        "动作服务器不存在、path_topic 未设或超时返回 FAILURE；父节点 halt 会取消目标。",
        "<FollowPath server_name=\"/follow_path\" controller_id=\"YuyiTEB\" "
        "goal_checker_id=\"PrecisionGoalChecker\" path_topic=\"/reference_path\" "
        "timeout_sec=\"1000.0\"/>"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>("server_name", "/follow_path",
                                        "FollowPath 动作服务器名"),
        bt_core::InputPort<std::string>("controller_id", "",
                                        "传给动作的 controller_id"),
        bt_core::InputPort<std::string>("goal_checker_id", "",
                                        "传给动作的 goal_checker_id"),
        bt_core::InputPort<std::string>("path_topic", "/reference_path",
                                        "订阅的路径话题"),
        bt_core::InputPort<double>("timeout_sec", "0.0",
                                   "目标超时，<=0 表示不超时"));
  }

  bt_core::NodeStatus tick() override {
    if (goal_started_) {
      return pollResult();
    }
    return sendGoal();
  }

  void onHalted() override { cancelGoal(); }

 private:
  using FollowPathAction = nav2_msgs::action::FollowPath;
  using ActionClient = rclcpp_action::Client<FollowPathAction>;
  using GoalHandle = rclcpp_action::ClientGoalHandle<FollowPathAction>;

  ActionClient::SharedPtr ensureClient() {
    if (client_) return client_;
    rclcpp::Node* node = getRosNodeHandle(blackboard());
    const std::string server =
        getInput<std::string>("server_name").value_or("/follow_path");
    client_ = rclcpp_action::create_client<FollowPathAction>(node, server);
    return client_;
  }

  void ensureSubscription() {
    if (path_sub_) return;
    rclcpp::Node* node = getRosNodeHandle(blackboard());
    const std::string topic =
        getInput<std::string>("path_topic").value_or("/reference_path");
    path_sub_ = node->create_subscription<nav_msgs::msg::Path>(
        topic, rclcpp::QoS(10),
        [this](const nav_msgs::msg::Path::SharedPtr m) {
          std::lock_guard<std::mutex> lk(mutex_);
          latest_path_ = *m;
          has_path_ = true;
        });
  }

  bool takePath(nav_msgs::msg::Path& out) {
    ensureSubscription();
    std::lock_guard<std::mutex> lk(mutex_);
    if (!has_path_) return false;
    out = latest_path_;
    return true;
  }

  bt_core::NodeStatus sendGoal() {
    auto client = ensureClient();
    if (!client->wait_for_action_server(std::chrono::seconds(1))) {
      return bt_core::NodeStatus::FAILURE;
    }

    nav_msgs::msg::Path path;
    if (!takePath(path)) {
      RCLCPP_WARN(rclcpp::get_logger("FollowPath"),
                  "path_topic 尚未收到任何路径");
      return bt_core::NodeStatus::FAILURE;
    }

    FollowPathAction::Goal goal;
    goal.path = path;
    goal.controller_id = getInput<std::string>("controller_id").value_or("");
    goal.goal_checker_id =
        getInput<std::string>("goal_checker_id").value_or("");

    // 用回调接收：goal_response_callback 捕获是否被接受，result_callback 捕获结果码。
    // 这是 ClientGoalHandle 的公开用法（async_get_result 为私有）。
    result_received_ = false;
    result_code_ = rclcpp_action::ResultCode::UNKNOWN;
    typename ActionClient::SendGoalOptions opts;
    opts.goal_response_callback =
        [this](typename GoalHandle::SharedPtr handle) {
          std::lock_guard<std::mutex> lk(mutex_);
          goal_handle_ = handle;
          if (!handle) {
            result_received_ = true;  // 被拒绝，视为失败
            result_code_ = rclcpp_action::ResultCode::ABORTED;
          }
        };
    opts.result_callback = [this](const auto& result) {
      std::lock_guard<std::mutex> lk(mutex_);
      result_code_ = result.code;
      result_received_ = true;
    };

    client->async_send_goal(goal, opts);
    goal_started_ = true;
    deadline_ = std::chrono::steady_clock::now() +
                std::chrono::milliseconds(static_cast<long long>(
                    getInput<double>("timeout_sec").value_or(0.0) * 1000.0));
    return bt_core::NodeStatus::RUNNING;
  }

  bt_core::NodeStatus pollResult() {
    if (deadline_.time_since_epoch().count() > 0 &&
        std::chrono::steady_clock::now() > deadline_) {
      cancelGoal();
      return bt_core::NodeStatus::FAILURE;
    }

    // 不在节点内自建 executor 或 spin_some：main.cpp 已用 SingleThreadedExecutor
    // 单线程 spin 本节点，动作客户端的 response/result 回调由主执行器派发。
    // 这里只读取回调写入的快照，避免第二个 executor 对同一节点产生调度争抢。
    bool received = false;
    rclcpp_action::ResultCode code = rclcpp_action::ResultCode::UNKNOWN;
    {
      std::lock_guard<std::mutex> lk(mutex_);
      received = result_received_;
      code = result_code_;
    }
    if (!received) {
      return bt_core::NodeStatus::RUNNING;
    }

    cancelGoal();
    return (code == rclcpp_action::ResultCode::SUCCEEDED)
               ? bt_core::NodeStatus::SUCCESS
               : bt_core::NodeStatus::FAILURE;
  }

  void cancelGoal() {
    {
      std::lock_guard<std::mutex> lk(mutex_);
      if (goal_handle_ && client_) {
        client_->async_cancel_goal(goal_handle_);
      }
      goal_handle_.reset();
    }
    goal_started_ = false;
    result_received_ = false;
  }

  ActionClient::SharedPtr client_;
  std::shared_ptr<GoalHandle> goal_handle_;
  bool goal_started_{false};
  bool result_received_{false};
  rclcpp_action::ResultCode result_code_{rclcpp_action::ResultCode::UNKNOWN};
  std::chrono::steady_clock::time_point deadline_{};
  std::mutex mutex_;
  rclcpp::Subscription<nav_msgs::msg::Path>::SharedPtr path_sub_;
  nav_msgs::msg::Path latest_path_;
  bool has_path_{false};
};

}  // namespace bt_ros2

#endif  // BT_ROS2_FOLLOW_PATH_NODE_HPP
