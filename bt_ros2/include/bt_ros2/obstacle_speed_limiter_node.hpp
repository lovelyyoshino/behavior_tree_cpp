// ============================================================================
//  bt_ros2/include/bt_ros2/obstacle_speed_limiter_node.hpp
//  ObstacleSpeedLimiter —— 通用激光雷达限速：减速指令，遇近距障碍则减速/停车。
//
//  职责（通用，不绑定任何机器人）：
//    - 订阅 scan_topic（sensor_msgs/LaserScan）与 input_cmd_vel（geometry_msgs/Twist）。
//    - 当扫描到前方最短距离 < slow_distance 时，把输出线速度按比例降低；
//      低于 stop_distance 时输出零速（停车）。
//    - 结果发布到 output_cmd_vel，供下游控制器消费。
//
//  端口：
//  - scan_topic          (input) 激光数据话题，默认 /scan
//  - input_cmd_vel_topic (input) 原始速度话题，默认 /cmd_vel_nav_raw
//  - output_cmd_vel_topic(input) 限速后速度话题，默认 /cmd_vel_smoothed
//  - slow_distance       (input) 开始减速的距离，默认 3.0
//  - stop_distance       (input) 停车距离，默认 1.5
//  - slow_scale          (input) 减速比例，默认 0.5
//  - timeout_ms          (input) 数据时效，<=0 表示只要收到过即有效
//
//  无新鲜数据/指令时输出零速并返回 FAILURE，避免限速器失效时误放行。
//
//  @code{.xml}
//   <ObstacleSpeedLimiter scan_topic="/scan" input_cmd_vel_topic="/cmd_vel_nav_raw"
//                         output_cmd_vel_topic="/cmd_vel_smoothed"
//                         slow_distance="3.0" stop_distance="1.5"/>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用激光雷达限速节点
// ============================================================================
#ifndef BT_ROS2_OBSTACLE_SPEED_LIMITER_NODE_HPP
#define BT_ROS2_OBSTACLE_SPEED_LIMITER_NODE_HPP

#include <mutex>
#include <string>

#include "bt_core/leaf_node.hpp"
#include "bt_ros2/ros_blackboard_keys.hpp"
#include "sensor_msgs/msg/laser_scan.hpp"
#include "geometry_msgs/msg/twist.hpp"
#include "rclcpp/rclcpp.hpp"

namespace bt_ros2 {

class ObstacleSpeedLimiterNode : public bt_core::ActionNode {
 public:
  using bt_core::ActionNode::ActionNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "订阅激光雷达与原始速度，按障碍距离减速/停车，结果发布到输出速度话题。",
        "scan_topic 指向 LaserScan；slow_distance/stop_distance 控制减速与停车阈值。",
        "有新鲜数据时输出限速指令并返回 SUCCESS；无新鲜数据时输出零速并失败。",
        "topic 无效、ROS 句柄未注入或从未收到任何数据会失败；应确保限速数据始终新鲜。",
        R"(<ObstacleSpeedLimiter scan_topic="/scan" input_cmd_vel_topic="/cmd_vel_nav_raw"
                              output_cmd_vel_topic="/cmd_vel_smoothed"
                              slow_distance="3.0" stop_distance="1.5"/>)"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::withEditorHint(bt_core::InputPort<std::string>(
                                    "scan_topic", "/scan", "激光雷达话题"),
                                "ros_topic"),
        bt_core::withEditorHint(bt_core::InputPort<std::string>(
                                    "input_cmd_vel_topic", "/cmd_vel_nav_raw",
                                    "原始速度话题"),
                                "ros_topic"),
        bt_core::withEditorHint(bt_core::InputPort<std::string>(
                                    "output_cmd_vel_topic", "/cmd_vel_smoothed",
                                    "限速后速度话题"),
                                "ros_topic"),
        bt_core::InputPort<double>("slow_distance", "3.0", "开始减速的距离(米)"),
        bt_core::InputPort<double>("stop_distance", "1.5", "停车距离(米)"),
        bt_core::InputPort<double>("slow_scale", "0.5", "减速比例(0~1)"),
        bt_core::InputPort<int>("timeout_ms", "0",
                                "数据时效窗口(ms)，<=0 表示收到过即有效"));
  }

  bt_core::NodeStatus tick() override {
    ensureSubscriptions();
    const int timeout_ms = getInput<int>("timeout_ms").value_or(0);

    sensor_msgs::msg::LaserScan scan;
    bool has_scan = false;
    {
      std::lock_guard<std::mutex> lk(mutex_);
      has_scan = hasData(scan_stamp_, timeout_ms);
      if (has_scan) scan = scan_;
    }
    geometry_msgs::msg::Twist in;
    bool has_cmd = false;
    {
      std::lock_guard<std::mutex> lk(mutex_);
      has_cmd = hasData(cmd_stamp_, timeout_ms);
      if (has_cmd) in = cmd_;
    }

    if (!has_scan || !has_cmd) {
      // 数据过期：不误放行，输出零速并判失败。
      publishZero();
      return bt_core::NodeStatus::FAILURE;
    }

    const double slow_distance = getInput<double>("slow_distance").value_or(3.0);
    const double stop_distance = getInput<double>("stop_distance").value_or(1.5);
    const double slow_scale = getInput<double>("slow_scale").value_or(0.5);

    const double nearest = nearestRange(scan);
    geometry_msgs::msg::Twist out = in;
    if (nearest < 0.0) {
      publishZero();
      return bt_core::NodeStatus::FAILURE;  // 无效距离
    } else if (nearest <= stop_distance) {
      out.linear.x = 0.0;
      out.angular.z = 0.0;
    } else if (nearest <= slow_distance) {
      out.linear.x *= slow_scale;
      out.angular.z *= slow_scale;
    }

    pub_->publish(out);
    return bt_core::NodeStatus::SUCCESS;
  }

 private:
  bool hasData(const rclcpp::Time& stamp, int timeout_ms) const {
    // rclcpp::Time 以零时间(epoch)作“未收到”哨兵；用 seconds()==0 判断。
    if (stamp.seconds() == 0.0) return false;  // 从未收到
    if (timeout_ms <= 0) return true;
    const rclcpp::Time now = rclcpp::Clock().now();
    return (now - stamp).seconds() * 1000.0 < static_cast<double>(timeout_ms);
  }

  double nearestRange(const sensor_msgs::msg::LaserScan& scan) const {
    double best = scan.range_max;
    for (float r : scan.ranges) {
      if (r < scan.range_min || r > scan.range_max) continue;
      if (!std::isfinite(r)) continue;
      if (r < best) best = r;
    }
    return best;
  }

  void ensureSubscriptions() {
    if (scan_sub_ && cmd_sub_ && pub_) return;

    rclcpp::Node* node = getRosNodeHandle(blackboard());
    const auto scan_topic = getInput<std::string>("scan_topic").value_or("/scan");
    const auto in_topic =
        getInput<std::string>("input_cmd_vel_topic").value_or("/cmd_vel_nav_raw");
    const auto out_topic =
        getInput<std::string>("output_cmd_vel_topic").value_or("/cmd_vel_smoothed");

    const auto qos = rclcpp::QoS(rclcpp::KeepLast(10));
    scan_sub_ = node->create_subscription<sensor_msgs::msg::LaserScan>(
        scan_topic, qos, [this](const sensor_msgs::msg::LaserScan::SharedPtr m) {
          std::lock_guard<std::mutex> lk(mutex_);
          scan_ = *m;
          scan_stamp_ = rclcpp::Clock().now();
        });
    cmd_sub_ = node->create_subscription<geometry_msgs::msg::Twist>(
        in_topic, qos, [this](const geometry_msgs::msg::Twist::SharedPtr m) {
          std::lock_guard<std::mutex> lk(mutex_);
          cmd_ = *m;
          cmd_stamp_ = rclcpp::Clock().now();
        });
    pub_ = node->create_publisher<geometry_msgs::msg::Twist>(out_topic, qos);
  }

  void publishZero() {
    geometry_msgs::msg::Twist out;
    if (pub_) pub_->publish(out);
  }

  rclcpp::Subscription<sensor_msgs::msg::LaserScan>::SharedPtr scan_sub_;
  rclcpp::Subscription<geometry_msgs::msg::Twist>::SharedPtr cmd_sub_;
  rclcpp::Publisher<geometry_msgs::msg::Twist>::SharedPtr pub_;

  std::mutex mutex_;
  sensor_msgs::msg::LaserScan scan_;
  geometry_msgs::msg::Twist cmd_;
  rclcpp::Time scan_stamp_{};
  rclcpp::Time cmd_stamp_{};
};

}  // namespace bt_ros2

#endif  // BT_ROS2_OBSTACLE_SPEED_LIMITER_NODE_HPP
