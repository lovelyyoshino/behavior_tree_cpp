/**
 * laser_scan.hpp — 测试用 sensor_msgs/LaserScan 最小实现。
 *
 * ObstacleSpeedLimiter 遍历 ranges 并用 range_min/range_max 过滤无效读数。
 * ranges 的元素类型必须是 float（真实消息为 float32），被测代码用
 * `for (float r : scan.ranges)` 取值。
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

#include "std_msgs/msg/header.hpp"

namespace sensor_msgs {
namespace msg {

struct LaserScan {
  using SharedPtr = std::shared_ptr<LaserScan>;
  std_msgs::msg::Header header;
  float angle_min{0.0F};
  float angle_max{0.0F};
  float angle_increment{0.0F};
  float range_min{0.0F};
  float range_max{0.0F};
  std::vector<float> ranges;
};

}  // namespace msg
}  // namespace sensor_msgs
