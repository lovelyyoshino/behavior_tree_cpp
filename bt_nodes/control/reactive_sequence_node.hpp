// ============================================================================
//  bt_nodes/control/reactive_sequence_node.hpp
//  ReactiveSequenceNode —— 反应式顺序：任一子节点 RUNNING 即整轮重头评估。
//
//  语义（作为通用核心节点）：
//  - 从 index 0 开始 tick 子节点；子节点 SUCCESS → 前进到下一个。
//  - 子节点 FAILURE → 整体立即 FAILURE（短路）。
//  - 子节点 RUNNING → 立即 halt 当前子节点并复位游标到 0，本节点返回 RUNNING。
//    下一执行拍会**从第一个子节点重新评估**——这正是"反应式"的关键：任何前置
//    条件(如 ROS2 急停/电量)一旦变化，能立刻打断当前动作而不是等它自然结束。
//  - 无子节点视为 SUCCESS。
//
//  与 SequenceNode 的差异：Sequence 在子节点 RUNNING 时保留游标"续跑"；
//    ReactiveSequence 在 RUNNING 时重头开始，实现条件优先级抢占。
//
//  用途：把"急停开关/电量门控"这类 ROS2 条件节点放在最前，用本节点包裹动作，
//    条件变假时动作会被立即中止。
//
//  @code{.xml}
//   <ReactiveSequence>
//     <RosTopicCondition topic="/yuyi_controller/e_stop" default="false"/>
//     <FollowPath path="{route_2_path}" .../>
//   </ReactiveSequence>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用反应式顺序节点
// ============================================================================
#ifndef BT_NODES_CONTROL_REACTIVE_SEQUENCE_NODE_HPP
#define BT_NODES_CONTROL_REACTIVE_SEQUENCE_NODE_HPP

#include "bt_core/control_node.hpp"

namespace bt_nodes {

class ReactiveSequenceNode : public bt_core::ControlNode {
 public:
  using bt_core::ControlNode::ControlNode;

  bt_core::NodeStatus tick() override {
    if (childrenCount() == 0) {
      return bt_core::NodeStatus::SUCCESS;
    }

    // 反应式：每拍都从第一个子节点重新评估。
    size_t idx = 0;
    while (idx < children_.size()) {
      auto& child = children_[idx];
      const bt_core::NodeStatus st = child->executeTick();

      switch (st) {
        case bt_core::NodeStatus::RUNNING:
          // 当前子节点未完成：为"反应式"语义，中止它并复位游标，
          // 本节点返回 RUNNING；下一拍重新从 idx=0 评估。
          if (child->needsHalt()) {
            child->halt();
          }
          child->setStatus(bt_core::NodeStatus::IDLE);
          haltChildren(idx + 1);
          return bt_core::NodeStatus::RUNNING;

        case bt_core::NodeStatus::FAILURE:
          haltChildren();
          return bt_core::NodeStatus::FAILURE;

        case bt_core::NodeStatus::SUCCESS:
          ++idx;
          break;

        case bt_core::NodeStatus::IDLE:
        default:
          haltChildren();
          return bt_core::NodeStatus::FAILURE;
      }
    }

    return bt_core::NodeStatus::SUCCESS;
  }

  void halt() override { bt_core::ControlNode::halt(); }
};

}  // namespace bt_nodes

#endif  // BT_NODES_CONTROL_REACTIVE_SEQUENCE_NODE_HPP
