/**
 * trigger.hpp - Minimal std_srvs/Trigger surface for ROS adapter tests.
 *
 * @author pony
 * @date 2026-08-19
 * @version v1.0.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.0.0 (2026-08-19): add request and response pointer aliases
 */
#pragma once

#include <memory>
#include <string>

namespace std_srvs::srv {

struct Trigger {
  struct Request {
    using SharedPtr = std::shared_ptr<Request>;
  };
  struct Response {
    using SharedPtr = std::shared_ptr<Response>;
    bool success{false};
    std::string message;
  };
};

}  // namespace std_srvs::srv
