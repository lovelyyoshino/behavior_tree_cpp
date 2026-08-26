// ============================================================================
//  bt_ros2/include/bt_ros2/follow_path_topic_node.hpp
//  FollowPathTopicNode —— 纯话题版路径跟随：沿路径发布 cmd_vel，无需动作服务器。
//
//  职责（通用，且不依赖 nav2 动作服务器）：
//    - 订阅 path_topic（nav_msgs/Path），记录最新路径。
//    - 每次 tick 根据当前路径进度，发布一个朝下一个路点的 cmd_vel（geometry_msgs/Twist）。
//    - 到达最后一个路点后返回 SUCCESS，否则 RUNNING。
//
//  与 FollowPathNode 的区别：
//    FollowPathNode 通过 nav2 FollowPath 动作服务器执行（依赖 /follow_path 在线）；
//    本节点直接在 BT 内发布 cmd_vel，适合无动作服务器或希望完全自控的场景。
//
//  端口：
//  - path_topic        (input) 订阅的路径话题，默认 /reference_path
//  - cmd_vel_topic     (input) 发布速度话题，默认 /cmd_vel
//  - linear_speed      (input) 线速度，默认 0.2
//  - angular_gain      (input) 角速度增益，默认 0.5
//  - goal_tolerance    (input) 到达路点的距离容差，默认 0.05
//  - timeout_ms        (input) 路径数据时效，<=0 表示收到过即有效
//
//  @code{.xml}
//   <FollowPathTopic path_topic="/reference_path" cmd_vel_topic="/cmd_vel"
//                    linear_speed="0.2" angular_gain="0.5"/>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增纯话题路径跟随节点
// ============================================================================
#ifndef BT_ROS2_FOLLOW_PATH_TOPIC_NODE_HPP
#define BT_ROS2_FOLLOW_PATH_TOPIC_NODE_HPP

#include <cmath>
#include <mutex>
#include <string>

#include "bt_core/leaf_node.hpp"
#include "bt_ros2/ros_blackboard_keys.hpp"
#include "geometry_msgs/msg/twist.hpp"
#include "nav_msgs/msg/path.hpp"
#include "rclcpp/rclcpp.hpp"

namespace bt_ros2 {

class FollowPathTopicNode : public bt_core::ActionNode {
 public:
  using bt_core::ActionNode::ActionNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "纯话题版路径跟随：沿路径发布 cmd_vel，不依赖 nav2 动作服务器。",
        "订阅 path_topic（nav_msgs/Path），按当前进度朝下一个路点发布速度；到达终点返回成功。",
        "到达最后一个路点返回 SUCCESS；无路径或无新鲜数据返回 FAILURE；行进中返回 RUNNING。",
        "需要自主控制/Robust 场景可用本节点；nano 精度/复杂控制建议改用 FollowPathNode。",
        "<FollowPathTopic path_topic=\"/reference_path\" cmd_vel_topic=\"/cmd_vel\" "
        "linear_speed=\"0.2\" angular_gain=\"0.5\"/>"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::withEditorHint(bt_core::InputPort<std::string>(
                                    "path_topic", "/reference_path", "订阅的路径话题"),
                                "ros_topic"),
        bt_core::withEditorHint(bt_core::InputPort<std::string>(
                                    "cmd_vel_topic", "/cmd_vel", "发布速度话题"),
                                "ros_topic"),
        bt_core::InputPort<double>("linear_speed", "0.2", "线速度"),
        bt_core::InputPort<double>("angular_gain", "0.5", "角速度增益"),
        bt_core::InputPort<double>("goal_tolerance", "0.05", "到达路点容差"),
        bt_core::InputPort<int>("timeout_ms", "0",
                                "路径数据时效，<=0 表示收到过即有效"));
  }

  bt_core::NodeStatus tick() override {
    ensureSubscriptions();

    nav_msgs::msg::Path path;
    bool has_path = false;
    {
      std::lock_guard<std::mutex> lk(mutex_);
      has_path = has_path_ && isFresh();
      if (has_path) path = path_;
    }
    if (!has_path || path.poses.empty()) {
      publishZero();
      return bt_core::NodeStatus::FAILURE;
    }

    // 当前目标 = 第 next_idx_ 个路点。
    if (next_idx_ >= path.poses.size()) {
      next_idx_ = 0;
      publishZero();
      return bt_core::NodeStatus::SUCCESS;  // 已走完
    }

    const auto& target = path.poses[next_idx_];
    const double dx =
        target.pose.position.x - current_pose_.pose.position.x;
    const double dy =
        target.pose.position.y - current_pose_.pose.position.y;

    const double dist = std::sqrt(dx * dx + dy * dy);
    const double tol =
        getInput<double>("goal_tolerance").value_or(0.05);

    if (dist <= tol) {
      ++next_idx_;
      // 到达最后一个路点即成功。
      if (next_idx_ >= path.poses.size()) {
        publishZero();
        return bt_core::NodeStatus::SUCCESS;
      }
      return bt_core::NodeStatus::RUNNING;
    }

    // 朝向：朝目标路点转（这里用当前位置与目标的位置差近似朝向差）。
    const double angle = std::atan2(dy, dx);
    const double linear =
        std::min(getInput<double>("linear_speed").value_or(0.2), dist);
    const double angular =
        getInput<double>("angular_gain").value_or(0.5) * angle;

    geometry_msgs::msg::Twist out;
    out.linear.x = linear;
    out.angular.z = angular;
    pub_->publish(out);
    return bt_core::NodeStatus::RUNNING;
  }

  void onHalted() override {
    publishZero();
    next_idx_ = 0;
  }

 private:
  bool isFresh() const {
    if (timeout_ms_ <= 0) return true;
    const rclcpp::Time now = rclcpp::Clock().now();
    return (now - stamp_).seconds() * 1000.0 < static_cast<double>(timeout_ms_);
  }

  void ensureSubscriptions() {
    if (path_sub_ && pub_) return;
    rclcpp::Node* node = getRosNodeHandle(blackboard());
    const auto pt = getInput<std::string>("path_topic").value_or("/reference_path");
    const auto vt = getInput<std::string>("cmd_vel_topic").value_or("/cmd_vel");
    timeout_ms_ = getInput<int>("timeout_ms").value_or(0);
    const auto qos = rclcpp::QoS(rclcpp::KeepLast(10));

    path_sub_ = node->create_subscription<nav_msgs::msg::Path>(
        pt, qos, [this](const nav_msgs::msg::Path::SharedPtr m) {
          std::lock_guard<std::mutex> lk(mutex_);
          path_ = *m;
          stamp_ = rclcpp::Clock().now();
          has_path_ = true;
          if (!path_.poses.empty()) {
            current_pose_ = path_.poses.front();
          }
        });
    pub_ = node->create_publisher<geometry_msgs::msg::Twist>(vt, qos);
    current_pose_.header.frame_id = "base_link";
  }

  void publishZero() {
    geometry_msgs::msg::Twist out;
    if (pub_) pub_->publish(out);
  }

  rclcpp::Subscription<nav_msgs::msg::Path>::SharedPtr path_sub_;
  rclcpp::Publisher<geometry_msgs::msg::Twist>::SharedPtr pub_;
  std::mutex mutex_;
  nav_msgs::msg::Path path_;
  geometry_msgs::msg::PoseStamped current_pose_;
  rclcpp::Time stamp_{};
  int timeout_ms_{0};
  bool has_path_{false};
  size_t next_idx_{0};
};

}  // namespace bt_ros2

#endif  // BT_ROS2_FOLLOW_PATH_TOPIC_NODE_HPP
