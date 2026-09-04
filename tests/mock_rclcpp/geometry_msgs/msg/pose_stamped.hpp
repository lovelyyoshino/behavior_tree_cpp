/**
 * pose_stamped.hpp — 测试用 geometry_msgs/PoseStamped 最小实现。
 *
 * LoadPathFromFile 写 position.{x,y,z} 与 orientation.{z,w}（由 yaw 换算），
 * FollowPathTopic 读 position.{x,y} 做距离判断，因此四元数四个分量全部保留。
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

#include "std_msgs/msg/header.hpp"

namespace geometry_msgs {
namespace msg {

struct Point {
  double x{0.0};
  double y{0.0};
  double z{0.0};
};

struct Quaternion {
  double x{0.0};
  double y{0.0};
  double z{0.0};
  double w{1.0};  ///< 单位四元数默认朝向，与真实消息默认值一致
};

struct Pose {
  Point position;
  Quaternion orientation;
};

struct PoseStamped {
  using SharedPtr = std::shared_ptr<PoseStamped>;
  std_msgs::msg::Header header;
  Pose pose;
};

}  // namespace msg
}  // namespace geometry_msgs
