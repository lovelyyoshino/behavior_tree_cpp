// ============================================================================
//  bt_nodes/control/priority_selector_node.hpp
//  PrioritySelectorNode - 按输入优先级响应式选择并抢占运行分支。
//
//  @author pony
//  @date 2026-08-18
//  @version v1.0.0
//  @last_modified 2026-08-18
//  @changelog
//    - v1.0.0 (2026-08-18): 初始实现高优先级输入重评与低优先级分支抢占
// ============================================================================
#ifndef BT_NODES_CONTROL_PRIORITY_SELECTOR_NODE_HPP
#define BT_NODES_CONTROL_PRIORITY_SELECTOR_NODE_HPP

#include <cstddef>
#include <optional>

#include "bt_core/control_node.hpp"

namespace bt_nodes {

/**
 * @brief 响应式优先级选择器：子节点顺序即输入优先级，越靠前优先级越高。
 *
 * 每个父 tick 都从第一个子节点重新评估。高优先级分支从 FAILURE 变为
 * RUNNING/SUCCESS 时，会 halt 当前低优先级 RUNNING 分支，再切换到高优先级分支。
 * 这与记忆型 Fallback 不同：Fallback 会从上次 RUNNING 子节点继续，不支持抢占。
 *
 * 推荐把每个子节点写成 `Sequence(输入条件, 任务动作...)`。ROS 回调只更新输入
 * 快照，PrioritySelector 在行为树单线程 tick 边界统一完成选择和抢占。
 */
class PrioritySelectorNode : public bt_core::ControlNode {
 public:
  using bt_core::ControlNode::ControlNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "按子节点顺序从高到低选择可执行分支，并在高优先级分支出现时抢占低优先级任务。",
        "把每个子节点组织成“条件 + 动作”的 Sequence；子节点从左到右就是优先级，不要把普通 Fallback 当作可抢占调度器。",
        "每拍从第一个子节点重评；首个 RUNNING 或 SUCCESS 分支获得控制权，切换前会 halt 旧的低优先级分支。",
        "无子节点或所有候选返回 FAILURE/IDLE 时返回 FAILURE；被抢占的长任务必须正确实现 halt 清理。",
        R"(<PrioritySelector name="watchdog"><IsFlagTrue topic="/planner/healthy" timeout_ms="1500"/><RosTopicAction topic="/bt/events" message="planner unhealthy"/></PrioritySelector>)"};
  }

  bt_core::NodeStatus tick() override {
    if (children_.empty()) {
      active_child_.reset();
      return bt_core::NodeStatus::FAILURE;
    }

    for (std::size_t index = 0; index < children_.size(); ++index) {
      auto& child = children_[index];
      const bt_core::NodeStatus status = child->executeTick();

      if (status == bt_core::NodeStatus::FAILURE ||
          status == bt_core::NodeStatus::IDLE) {
        // 先前占用调度权的分支已经退出，显式 halt 其内部状态，允许下次重新进入。
        if (active_child_ && *active_child_ == index) {
          if (child->needsHalt()) child->halt();
          active_child_.reset();
        }
        continue;
      }

      if (active_child_ && *active_child_ != index) {
        auto& previous = children_[*active_child_];
        if (previous->needsHalt()) previous->halt();
        previous->setStatus(bt_core::NodeStatus::IDLE);
      }

      // 当前分支获得调度权，所有更低优先级分支都必须停止。
      haltChildren(index + 1);
      if (status == bt_core::NodeStatus::RUNNING) {
        active_child_ = index;
      } else {
        active_child_.reset();
      }
      return status;
    }

    active_child_.reset();
    return bt_core::NodeStatus::FAILURE;
  }

  void halt() override {
    active_child_.reset();
    bt_core::ControlNode::halt();
  }

 private:
  std::optional<std::size_t> active_child_;  ///< 当前持有调度权的 RUNNING 分支
};

}  // namespace bt_nodes

#endif  // BT_NODES_CONTROL_PRIORITY_SELECTOR_NODE_HPP
