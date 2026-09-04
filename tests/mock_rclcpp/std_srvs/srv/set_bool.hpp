/**
 * set_bool.hpp - Minimal std_srvs/SetBool surface for ROS adapter tests.
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

struct SetBool {
  struct Request {
    using SharedPtr = std::shared_ptr<Request>;
    bool data{false};
  };
  struct Response {
    using SharedPtr = std::shared_ptr<Response>;
    bool success{false};
    std::string message;
  };
};

}  // namespace std_srvs::srv
