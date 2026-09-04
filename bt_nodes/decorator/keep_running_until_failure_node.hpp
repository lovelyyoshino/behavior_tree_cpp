// ============================================================================
//  bt_nodes/decorator/keep_running_until_failure_node.hpp
//  KeepRunningUntilFailureNode —— 持续运行子节点，直到子节点返回 FAILURE。
//
//  语义（与 BehaviorTree.CPP 的 KeepRunningUntilFailure 一致，作为通用核心节点）：
//  - 子节点 SUCCESS 或 RUNNING → 本节点 RUNNING（继续拖着子节点跑下一拍）。
//  - 子节点 FAILURE → 本节点立即 FAILURE（整轮结束）。
//  - 无子节点 → 视为配置错误，返回 FAILURE。
//
//  用途：把「主循环」放在 KeepRunningUntilFailure 里，让它一直维持到被触发中断。
//    Yuyi 树的「KeepProductionSchedulerAlive」「MonitorCurrentWorkArea」等长驻分支
//    都可用此节点表达，不再依赖机器人专属插件。
//
//  与 RepeatNode 的区别：Repeat 在子节点成功时计数并继续；本节点对成功**不计数**，
//  只在失败时停止。典型场景是"持续监视/持续调度"。
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用 KeepRunningUntilFailure 节点
// ============================================================================
#ifndef BT_NODES_DECORATOR_KEEP_RUNNING_UNTIL_FAILURE_NODE_HPP
#define BT_NODES_DECORATOR_KEEP_RUNNING_UNTIL_FAILURE_NODE_HPP

#include "bt_core/decorator_node.hpp"

namespace bt_nodes {

class KeepRunningUntilFailureNode : public bt_core::DecoratorNode {
 public:
  using bt_core::DecoratorNode::DecoratorNode;

  bt_core::NodeStatus tick() override {
    if (!child()) {
      return bt_core::NodeStatus::FAILURE;
    }
    switch (child()->executeTick()) {
      case bt_core::NodeStatus::SUCCESS:
      case bt_core::NodeStatus::RUNNING:
        // 子节点成功或仍在运行：本节点继续 RUNNING 以保持循环。
        return bt_core::NodeStatus::RUNNING;
      case bt_core::NodeStatus::FAILURE:
        // 子节点失败 → 结束循环，整体失败。
        return bt_core::NodeStatus::FAILURE;
      case bt_core::NodeStatus::IDLE:
      default:
        return bt_core::NodeStatus::FAILURE;
    }
  }
};

}  // namespace bt_nodes

#endif  // BT_NODES_DECORATOR_KEEP_RUNNING_UNTIL_FAILURE_NODE_HPP
