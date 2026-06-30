// ============================================================================
//  tests/mock_rclcpp/rclcpp/rclcpp.hpp
//  最小 mock rclcpp —— **仅供 tests/ 单元测试使用**，让 bt_ros2 的订阅/发布
//  基类模板可以在本机零 ROS2 环境下被实例化、被调用、被断言。
//
//  覆盖范围 (按"被 ros_subscriber_node.hpp / ros_publisher_node.hpp 用到的
//  API 表面"裁剪):
//    rclcpp::QoS / rclcpp::KeepLast
//    rclcpp::Node::create_subscription<MsgT>(topic, QoS, callback) -> Subscription::SharedPtr
//    rclcpp::Node::create_publisher<MsgT>(topic, QoS)              -> Publisher::SharedPtr
//    Subscription<MsgT>::SharedPtr (内部存回调)
//    Publisher<MsgT>::publish(msg)  + 测试钩子 .published 向量记录所有发布过的消息
//    Node::deliver<PtrT>(ptr)       测试钩子:模拟"最后建立的订阅收到一条消息"
//
//  仅在 -Itests/mock_rclcpp 下生效;真实 ROS2 环境的测试不应包含本头文件。
// ============================================================================
#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace rclcpp {

struct KeepLast { size_t d; explicit KeepLast(size_t x) : d(x) {} };
struct QoS      { KeepLast k; explicit QoS(KeepLast x) : k(x) {} };

template <typename MsgT>
struct Subscription {
  using SharedPtr = std::shared_ptr<Subscription<MsgT>>;
  std::function<void(typename MsgT::SharedPtr)> cb;
};

template <typename MsgT>
struct Publisher {
  using SharedPtr = std::shared_ptr<Publisher<MsgT>>;
  std::vector<MsgT> published;          ///< 测试钩子:记录所有 publish 调用
  void publish(const MsgT& m) { published.push_back(m); }
};

class Node {
public:
  template <typename MsgT, typename CB>
  typename Subscription<MsgT>::SharedPtr create_subscription(
      const std::string& /*topic*/, QoS /*qos*/, CB cb) {
    auto s = std::make_shared<Subscription<MsgT>>();
    s->cb = cb;
    // 用类型擦除的派发器持有,使测试可通过 deliver() 模拟收到消息。
    dispatchers_.push_back([s](void* p) {
      s->cb(*reinterpret_cast<typename MsgT::SharedPtr*>(p));
    });
    last_sub_idx_ = dispatchers_.size() - 1;
    return s;
  }

  template <typename MsgT>
  typename Publisher<MsgT>::SharedPtr create_publisher(
      const std::string& topic, QoS /*qos*/) {
    auto p = std::make_shared<Publisher<MsgT>>();
    last_publisher_ = std::static_pointer_cast<void>(p);
    last_topic_ = topic;
    return p;
  }

  /// @brief 测试钩子:把消息派发给"最后建立的订阅"(模拟收到一条 ROS 消息)。
  template <typename PtrT>
  void deliver(PtrT* p) { dispatchers_[last_sub_idx_](p); }

  // 测试侧可读字段
  std::shared_ptr<void> last_publisher_;
  std::string           last_topic_;

private:
  std::vector<std::function<void(void*)>> dispatchers_;
  size_t                                  last_sub_idx_{0};
};

}  // namespace rclcpp
