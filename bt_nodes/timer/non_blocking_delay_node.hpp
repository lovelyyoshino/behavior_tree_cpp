// ============================================================================
//  bt_nodes/timer/non_blocking_delay_node.hpp
//  NonBlockingDelayNode —— 非阻塞延时：等待 msec 毫秒，期间返回 RUNNING。
//
//  语义（作为通用核心节点）：
//      - 自首拍起计时，未满 msec 毫秒一直返回 RUNNING。
//      - 满 msec 后返回 SUCCESS，并复位以允许再次调度。
//      - onHalted() 复位计时，父节点 halt 后可重新计时。
//
//  与 DelayNode 的差异：Delay 使用 delay_ms 端口；本节点使用 msec，与 Yuyi 树的
//    NonBlockingDelay 端口名保持兼容，方便直接迁移而不改属性名。
//
//  用途：在 KeepRunningUntilFailure 内做"每 N 毫秒采样一次"的节拍器，或
//    在 ReactiveSequence 里做"轮询等待"。
//
//  @code{.xml}
//   <NonBlockingDelay msec="1000"/>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用非阻塞延时节点
// ============================================================================
#ifndef BT_NODES_TIMER_NON_BLOCKING_DELAY_NODE_HPP
#define BT_NODES_TIMER_NON_BLOCKING_DELAY_NODE_HPP

#include <chrono>

#include "bt_core/leaf_node.hpp"

namespace bt_nodes {

class NonBlockingDelayNode : public bt_core::ActionNode {
 public:
  using bt_core::ActionNode::ActionNode;

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(bt_core::InputPort<int>(
        "msec", "1000", "延时时长（毫秒），自首拍起计时；<=0 表示不延时"));
  }

  bt_core::NodeStatus tick() override {
    const int msec = getInput<int>("msec").value_or(1000);
    if (msec <= 0) {
      started_ = false;
      return bt_core::NodeStatus::SUCCESS;
    }

    const auto now = std::chrono::steady_clock::now();
    if (!started_) {
      started_ = true;
      start_ = now;
      return bt_core::NodeStatus::RUNNING;
    }

    const auto elapsed_ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(now - start_).count();
    if (elapsed_ms >= msec) {
      started_ = false;
      return bt_core::NodeStatus::SUCCESS;
    }
    return bt_core::NodeStatus::RUNNING;
  }

  void onHalted() override { started_ = false; }

 private:
  bool started_{false};
  std::chrono::steady_clock::time_point start_{};
};

}  // namespace bt_nodes

#endif  // BT_NODES_TIMER_NON_BLOCKING_DELAY_NODE_HPP
