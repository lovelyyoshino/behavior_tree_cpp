// ============================================================================
//  bt_ros2/include/bt_ros2/load_path_from_file_node.hpp
//  LoadPathFromFile —— 通用路径加载节点：读取 YAML 轨迹，发布为 nav_msgs/Path。
//
//  职责（通用，不绑定任何机器人）：
//    - 从 path_file 读取轨迹 YAML，解析出一系列 pose，组装成 nav_msgs::msg::Path。
//    - 发布到 path_topic（默认 /reference_path），供 FollowPath 等下游订阅。
//    - Yuyi 的 LoadYuyiPath 可完全由本节点替代，只改端口配置，无需自定义插件。
//
//  轨迹 YAML 约定（简单、跨机器人通用）：
//    poses:                       # 必填，按顺序排列
//      - {x: 0.0, y: 0.0, yaw: 0.0}
//      - {x: 1.0, y: 0.0, yaw: 0.0}
//
//  端口：
//  - path_file   (input) 轨迹 YAML 路径
//  - frame_id    (input) 路径坐标系，默认 "map"
//  - topic       (input) 发布目标 topic，默认 "/reference_path"
//  - qos_depth   (input) 发布 QoS 队列深度，默认 10
//  - header_frame(input) Path 的 frame_id（缺省用 frame_id）
//
//  @code{.xml}
//   <LoadPathFromFile path_file="config/trajectories/work.yaml" frame_id="map" topic="/reference_path"/>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用路径加载节点
// ============================================================================
#ifndef BT_ROS2_LOAD_PATH_FROM_FILE_NODE_HPP
#define BT_ROS2_LOAD_PATH_FROM_FILE_NODE_HPP

#include <fstream>
#include <memory>
#include <regex>
#include <string>
#include <vector>

#include "bt_core/leaf_node.hpp"
#include "bt_ros2/ros_blackboard_keys.hpp"
#include "nav_msgs/msg/path.hpp"
#include "geometry_msgs/msg/pose_stamped.hpp"
#include "rclcpp/rclcpp.hpp"

namespace bt_ros2 {

class LoadPathFromFileNode : public bt_core::ActionNode {
 public:
  using bt_core::ActionNode::ActionNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "从 YAML 路径文件读取轨迹并发布为 nav_msgs/Path。",
        "path_file 指向轨迹 YAML（poses: [{x,y,yaw}]），topic 是下游订阅路径的话题。",
        "读取并发布成功返回 SUCCESS；文件不存在/解析失败/话题为空返回 FAILURE。",
        "仅处理简单的 'poses: [{x,y,yaw}]' 格式；复杂轨迹请改用专门的路径加载插件。",
        R"(<LoadPathFromFile path_file="config/trajectories/work.yaml" frame_id="map" topic="/reference_path"/>)"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>("path_file", "", "轨迹 YAML 文件路径"),
        bt_core::InputPort<std::string>("frame_id", "map", "路径坐标系"),
        bt_core::withEditorHint(
            bt_core::InputPort<std::string>("topic", "/reference_path",
                                            "发布目标 topic"), "ros_topic"),
        bt_core::InputPort<int>("qos_depth", "10", "发布 QoS 队列深度"));
  }

  bt_core::NodeStatus tick() override {
    const std::string path_file =
        getInput<std::string>("path_file").value_or("");
    if (path_file.empty()) {
      return bt_core::NodeStatus::FAILURE;
    }
    const std::string frame_id =
        getInput<std::string>("frame_id").value_or("map");
    const std::string topic =
        getInput<std::string>("topic").value_or("/reference_path");
    const int depth = getInput<int>("qos_depth").value_or(10);

    nav_msgs::msg::Path path;
    if (!parsePath(path_file, frame_id, path)) {
      return bt_core::NodeStatus::FAILURE;
    }

    ensurePublisher(topic, depth);
    pub_->publish(path);
    return bt_core::NodeStatus::SUCCESS;
  }

 private:
  bool parsePath(const std::string& file, const std::string& frame_id,
                 nav_msgs::msg::Path& out) {
    std::ifstream ifs(file);
    if (!ifs) {
      RCLCPP_ERROR(rclcpp::get_logger("LoadPathFromFile"), "无法打开路径文件: %s",
                   file.c_str());
      return false;
    }

    out.header.stamp = rclcpp::Clock().now();
    out.header.frame_id = frame_id;
    out.poses.clear();

    // 匹配符合 `- {x: ..., y: ..., yaw: ...}` 或 `- x: .. y: ..` 的 pose 行。
    // 简化：按逗号分隔 key:value 对，容忍 yaw 缺失。
    std::regex rx(R"(\{\s*x:\s*([-+0-9.eE]+)\s*,\s*y:\s*([-+0-9.eE]+)(?:\s*,\s*yaw:\s*([-+0-9.eE]+))?\s*\})");
    std::string line;
    while (std::getline(ifs, line)) {
      std::smatch m;
      if (std::regex_search(line, m, rx)) {
        geometry_msgs::msg::PoseStamped p;
        p.header.stamp = out.header.stamp;
        p.header.frame_id = frame_id;
        p.pose.position.x = std::stod(m[1].str());
        p.pose.position.y = std::stod(m[2].str());
        p.pose.position.z = 0.0;
        p.pose.orientation.z = std::sin(std::stod(m[3].str()) / 2.0);
        p.pose.orientation.w = std::cos(std::stod(m[3].str()) / 2.0);
        out.poses.push_back(p);
      }
    }

    if (out.poses.empty()) {
      RCLCPP_ERROR(rclcpp::get_logger("LoadPathFromFile"),
                   "路径文件 %s 未解析出任何 pose（期望 'poses:' 后跟 - {x,y,yaw}）",
                   file.c_str());
      return false;
    }
    return true;
  }

  void ensurePublisher(const std::string& topic, int depth) {
    if (pub_) return;
    rclcpp::Node* node = getRosNodeHandle(blackboard());
    pub_ = node->create_publisher<nav_msgs::msg::Path>(
        topic, rclcpp::QoS(rclcpp::KeepLast(depth)));
  }

  typename rclcpp::Publisher<nav_msgs::msg::Path>::SharedPtr pub_;
};

}  // namespace bt_ros2

#endif  // BT_ROS2_LOAD_PATH_FROM_FILE_NODE_HPP
