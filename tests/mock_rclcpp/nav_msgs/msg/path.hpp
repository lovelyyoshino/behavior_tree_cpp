/**
 * path.hpp — 测试用 nav_msgs/Path 最小实现。
 *
 * LoadPathFromFile 构造 Path 并 push_back 位姿，FollowPathTopic 按索引推进，
 * FollowPath 把整条 Path 作为 action goal 发出，因此 poses 必须是可拷贝的
 * std::vector 而非固定数组。
 *
 * @author pony
 * @date 2026-09-04
 * @version v1.0.0
 * @last_modified 2026-09-04
 * @changelog
 *   - v1.0.0 (2026-09-04): 初始创建
 */
#pragma once

#include <memory>
#include <vector>

#include "geometry_msgs/msg/pose_stamped.hpp"
#include "std_msgs/msg/header.hpp"

namespace nav_msgs {
namespace msg {

struct Path {
  using SharedPtr = std::shared_ptr<Path>;
  std_msgs::msg::Header header;
  std::vector<geometry_msgs::msg::PoseStamped> poses;
};

}  // namespace msg
}  // namespace nav_msgs
