/**
 * follow_path.hpp — 测试用 nav2_msgs/action/FollowPath 最小实现。
 *
 * 真实 action 类型由 rosidl 生成，含 Goal/Result/Feedback 三段。FollowPathNode
 * 只填 Goal 的 path/controller_id/goal_checker_id 并读结果码，因此 Result 与
 * Feedback 保留为空结构即可；rclcpp_action mock 依赖这三个嵌套类型存在。
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
#include <string>

#include "nav_msgs/msg/path.hpp"

namespace nav2_msgs {
namespace action {

struct FollowPath {
  struct Goal {
    nav_msgs::msg::Path path;
    std::string controller_id;
    std::string goal_checker_id;
  };

  struct Result {
    using SharedPtr = std::shared_ptr<Result>;
  };

  struct Feedback {
    using SharedPtr = std::shared_ptr<Feedback>;
    float distance_to_goal{0.0F};
    float speed{0.0F};
  };
};

}  // namespace action
}  // namespace nav2_msgs
