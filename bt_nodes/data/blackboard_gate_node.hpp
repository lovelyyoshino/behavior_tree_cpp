// ============================================================================
//  bt_nodes/data/blackboard_gate_node.hpp
//  BlackboardGateNode —— 黑板键门控：键存在，且（可选）字符串值等于 expected。
//
//  语义（通用，纯逻辑）：
//  - 黑板中存在 key 且（未设置 expected 或值等于 expected）→ SUCCESS。
//  - 键不存在 / 值不匹配 → FAILURE。
//
//  用途：用黑板值充当"单刀开关"，让同一棵树按配置/结果走不同分支。
//    例如 value=="zone2" 时走障蔽禁用分支，否则走启用分支。
//
//  端口：
//  - key      (input) 要读取的黑板键。
//  - expected (input) 期望值（字符串）。为空表示只检查存在性。
//
//  @code{.xml}
//   <BlackboardGate key="{mode}" expected="zone2"/>   <!-- 黑板 mode=="zone2" 才通过 -->
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用黑板门控节点
// ============================================================================
#ifndef BT_NODES_DATA_BLACKBOARD_GATE_NODE_HPP
#define BT_NODES_DATA_BLACKBOARD_GATE_NODE_HPP

#include <string>

#include "bt_core/blackboard.hpp"
#include "bt_core/leaf_node.hpp"

namespace bt_nodes {

class BlackboardGateNode : public bt_core::ConditionNode {
 public:
  using bt_core::ConditionNode::ConditionNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "黑板键门控：键存在且（可选）值等于 expected 则通过。",
        "key 填黑板键，expected 填期望字符串；期望为空则只检查存在性。",
        "存在且匹配返回 SUCCESS；未设置 key、键不存在或值不匹配返回 FAILURE。",
        "只读黑板，不写副作用；值类型以字符串比较（非 string 键按通用 to-string 语义）。",
        "<BlackboardGate key=\"{mode}\" expected=\"zone2\"/>"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>("key", "", "要读取的黑板键"),
        bt_core::InputPort<std::string>("expected", "",
                                        "期望字符串值；为空表示仅检查存在性"));
  }

  bt_core::NodeStatus tick() override {
    const std::string key = getInput<std::string>("key").value_or("");
    if (key.empty()) return bt_core::NodeStatus::FAILURE;

    const auto bb = blackboard();
    if (!bb || !bb->contains(key)) return bt_core::NodeStatus::FAILURE;

    const std::string expected =
        getInput<std::string>("expected").value_or("");
    if (expected.empty()) return bt_core::NodeStatus::SUCCESS;  // 仅检查存在

    // 值比较：字符串门控。
    auto val = bb->get<std::string>(key);
    if (!val.has_value()) return bt_core::NodeStatus::FAILURE;
    return (*val == expected) ? bt_core::NodeStatus::SUCCESS
                              : bt_core::NodeStatus::FAILURE;
  }
};

}  // namespace bt_nodes

#endif  // BT_NODES_DATA_BLACKBOARD_GATE_NODE_HPP
