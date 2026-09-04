/**
 * twist.hpp — 测试用 geometry_msgs/Twist 最小实现。
 *
 * ObstacleSpeedLimiter 只读写 linear.x 和 angular.z，其余分量保留为零值以保持
 * 与真实消息一致的结构，避免被测代码换用 linear.y 时静默编译失败。
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

namespace geometry_msgs {
namespace msg {

struct Vector3 {
  double x{0.0};
  double y{0.0};
  double z{0.0};
};

struct Twist {
  using SharedPtr = std::shared_ptr<Twist>;
  Vector3 linear;
  Vector3 angular;
};

}  // namespace msg
}  // namespace geometry_msgs
