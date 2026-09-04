// ============================================================================
//  bt_nodes/decorator/tick_rate_node.hpp
//  TickRateNode - 按分级策略降低子树 tick 频率。
//
//  @author pony
//  @date 2026-08-18
//  @version v1.0.0
//  @last_modified 2026-08-18
//  @changelog
//    - v1.0.0 (2026-08-18): 初始实现 critical/normal/background 分级 tick
// ============================================================================
#ifndef BT_NODES_DECORATOR_TICK_RATE_NODE_HPP
#define BT_NODES_DECORATOR_TICK_RATE_NODE_HPP

#include <cstdint>
#include <stdexcept>
#include <string>

#include "bt_core/blackboard.hpp"
#include "bt_core/decorator_node.hpp"

namespace bt_nodes {

/**
 * @brief 分级 tick 装饰器。
 *
 * 默认分级：critical 每拍执行、normal 每 2 拍执行、background 每 5 拍执行。
 * `every_n_ticks > 0` 时覆盖 tier 的默认周期。首拍总会执行；跳过拍不会启动线程，
 * 只返回子节点上次状态，因此所有子树仍由同一个行为树线程串行推进。
 */
class TickRateNode : public bt_core::DecoratorNode {
 public:
  using bt_core::DecoratorNode::DecoratorNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "按分级或自定义周期降低子树 tick 频率，不创建线程也不改变父树的单线程模型。",
        "将需要降频的监控/日志分支包起来；critical、normal、background 默认对应每 1、2、5 个父 tick。",
        "首拍一定执行；跳过拍返回子节点上次状态；halt 会清零计数，下一次重新从首拍开始。",
        "没有子节点返回 FAILURE；every_n_ticks 为负数或 tier 不在枚举中会抛配置错误。",
        R"(<TickRate tier="background"><RosTopicAction topic="/bt/events" message="heartbeat missing"/></TickRate>)"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>(
            "tier", "normal", "tick 分级",
            {"critical", "normal", "background"}),
        bt_core::InputPort<int>(
            "every_n_ticks", "0", "自定义周期；>0 时覆盖 tier 默认值"));
  }

  bt_core::NodeStatus tick() override {
    if (!child()) return bt_core::NodeStatus::FAILURE;

    const std::uint64_t interval = resolveInterval();
    const bool due = (parent_tick_count_ % interval) == 0;
    ++parent_tick_count_;

    if (!due) {
      const auto previous = child()->status();
      return previous == bt_core::NodeStatus::IDLE
                 ? bt_core::NodeStatus::RUNNING
                 : previous;
    }
    return child()->executeTick();
  }

  void halt() override {
    parent_tick_count_ = 0;
    bt_core::DecoratorNode::halt();
  }

 private:
  std::uint64_t resolveInterval() const {
    const int explicit_interval = getInput<int>("every_n_ticks").value_or(0);
    if (explicit_interval < 0) {
      throw std::invalid_argument("TickRate every_n_ticks must be >= 0");
    }
    if (explicit_interval > 0) {
      return static_cast<std::uint64_t>(explicit_interval);
    }

    const std::string tier = getInput<std::string>("tier").value_or("normal");
    if (tier == "critical") return 1;
    if (tier == "normal") return 2;
    if (tier == "background") return 5;
    throw std::invalid_argument(
        "TickRate tier must be critical, normal, or background");
  }

  std::uint64_t parent_tick_count_{0};  ///< 本装饰器收到的父 tick 数
};

}  // namespace bt_nodes

#endif  // BT_NODES_DECORATOR_TICK_RATE_NODE_HPP
