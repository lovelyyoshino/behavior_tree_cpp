/**
 * header.hpp — 测试用 std_msgs/Header 最小实现。
 *
 * 真实 ROS 的 Header.stamp 是 builtin_interfaces::msg::Time；mock 直接复用
 * rclcpp::Time，省掉一层转换类型。被测代码只做 `header.stamp = Clock().now()`
 * 和 header 之间互相赋值，语义等价。
 *
 * @author pony
 * @date 2026-09-04
 * @version v1.0.0
 * @last_modified 2026-09-04
 * @changelog
 *   - v1.0.0 (2026-09-04): 初始创建，供 nav_msgs/geometry_msgs mock 复用
 */
#pragma once

#include <string>

#include "rclcpp/rclcpp.hpp"

namespace std_msgs {
namespace msg {

struct Header {
  rclcpp::Time stamp{};
  std::string frame_id;
};

}  // namespace msg
}  // namespace std_msgs
