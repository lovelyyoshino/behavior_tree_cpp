// ============================================================================
//  bt_nodes/decorator/keep_running_until_success_node.hpp
//  KeepRunningUntilSuccessNode —— 持续运行子节点，直到子节点返回 SUCCESS。
//
//  语义（作为通用核心节点，与 KeepRunningUntilFailure 对称）：
//  - 子节点 FAILURE 或 RUNNING → 本节点 RUNNING（继续拖着子节点跑下一拍）。
//  - 子节点 SUCCESS → 本节点立即 SUCCESS（整轮结束）。
//  - 无子节点 → 视为配置错误，返回 FAILURE。
//
//  用途：把「重试直到成功」留给本节点，如"等待某条件满足"或"重试某动作直到成功"。
//
//  与 KeepRunningUntilFailure 的区别：前者在失败时停止；本节点在成功时停止。
//
//  @code{.xml}
//   <KeepRunningUntilSuccess>
//     <RosTopicCondition topic="/robot/ready" default="false"/>
//   </KeepRunningUntilSuccess>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用 KeepRunningUntilSuccess 节点
// ============================================================================
#ifndef BT_NODES_DECORATOR_KEEP_RUNNING_UNTIL_SUCCESS_NODE_HPP
#define BT_NODES_DECORATOR_KEEP_RUNNING_UNTIL_SUCCESS_NODE_HPP

#include "bt_core/decorator_node.hpp"

namespace bt_nodes {

class KeepRunningUntilSuccessNode : public bt_core::DecoratorNode {
 public:
  using bt_core::DecoratorNode::DecoratorNode;

  bt_core::NodeStatus tick() override {
    if (!child()) {
      return bt_core::NodeStatus::FAILURE;
    }
    switch (child()->executeTick()) {
      case bt_core::NodeStatus::SUCCESS:
        return bt_core::NodeStatus::SUCCESS;
      case bt_core::NodeStatus::RUNNING:
      case bt_core::NodeStatus::FAILURE:
        // 子节点仍在运行或已经失败：本节点继续 RUNNING 以保持循环。
        return bt_core::NodeStatus::RUNNING;
      case bt_core::NodeStatus::IDLE:
      default:
        return bt_core::NodeStatus::FAILURE;
    }
  }
};

}  // namespace bt_nodes

#endif  // BT_NODES_DECORATOR_KEEP_RUNNING_UNTIL_SUCCESS_NODE_HPP
