// ============================================================================
//  bt_nodes/control/reactive_fallback_node.hpp
//  ReactiveFallbackNode —— 反应式选择：任一子节点 RUNNING 即整轮重头评估。
//
//  语义（作为通用核心节点，与 ReactiveSequence 对称）：
//  - 从 index 0 开始 tick 子节点；子节点 SUCCESS → 整体 SUCCESS（短路）。
//  - 子节点 FAILURE → 前进到下一个候选。
//  - 子节点 RUNNING → 立即 halt 当前子节点并复位游标到 0，本节点返回 RUNNING。
//    下一执行拍从第一个候选重新评估，使「优先级候选」的条件能随 ROS2 数据立即变化。
//  - 无子节点视为 FAILURE。
//
//  与 FallbackNode 的差异：Fallback 在子节点 RUNNING 时保留游标"续跑"；
//    ReactiveFallback 在 RUNNING 时重头从第一个候选评估，实现条件优先级抢占。
//
//  用途：与 ReactiveSequence 配合，构成"反应式顺序/反应式选择"两种抢占组合。
//
//  @code{.xml}
//   <ReactiveFallback>
//     <RosTopicCondition topic="/safety/e_stop" default="false"/>
//     <FollowPath path_topic="/reference_path"/>
//   </ReactiveFallback>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用反应式选择节点
// ============================================================================
#ifndef BT_NODES_CONTROL_REACTIVE_FALLBACK_NODE_HPP
#define BT_NODES_CONTROL_REACTIVE_FALLBACK_NODE_HPP

#include "bt_core/control_node.hpp"

namespace bt_nodes {

class ReactiveFallbackNode : public bt_core::ControlNode {
 public:
  using bt_core::ControlNode::ControlNode;

  bt_core::NodeStatus tick() override {
    if (childrenCount() == 0) {
      return bt_core::NodeStatus::FAILURE;
    }

    // 反应式：每拍都从第一个候选重新评估。
    size_t idx = 0;
    while (idx < children_.size()) {
      auto& child = children_[idx];
      const bt_core::NodeStatus st = child->executeTick();

      switch (st) {
        case bt_core::NodeStatus::RUNNING:
          // 当前候选未完成：为"反应式"语义，中止它并复位游标，
          // 本节点返回 RUNNING；下一拍重新从 idx=0 评估。
          if (child->needsHalt()) {
            child->halt();
          }
          child->setStatus(bt_core::NodeStatus::IDLE);
          haltChildren(idx + 1);
          return bt_core::NodeStatus::RUNNING;

        case bt_core::NodeStatus::FAILURE:
          // 当前候选失败，尝试下一个。
          ++idx;
          break;

        case bt_core::NodeStatus::SUCCESS:
          haltChildren();
          return bt_core::NodeStatus::SUCCESS;

        case bt_core::NodeStatus::IDLE:
        default:
          ++idx;
          break;
      }
    }

    return bt_core::NodeStatus::FAILURE;
  }

  void halt() override { bt_core::ControlNode::halt(); }
};

}  // namespace bt_nodes

#endif  // BT_NODES_CONTROL_REACTIVE_FALLBACK_NODE_HPP
