// ============================================================================
//  tests/test_generic_nodes.cpp
//  通用核心节点回归测试(GoogleTest)：验证新增的 KeepRunningUntilFailure /
//  KeepRunningUntilSuccess / ReactiveSequence / ReactiveFallback 语义。
//
//  这些节点是 header-only，注册进 NodeFactory 后经 XmlParser 建树再 tick，
//  与真实运行路径一致。
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 初始版本
// ============================================================================
#include <gtest/gtest.h>

#include "bt_core/node_factory.hpp"
#include "bt_core/tree.hpp"
#include "bt_core/xml_parser.hpp"

#include "bt_nodes/control/reactive_sequence_node.hpp"
#include "bt_nodes/control/reactive_fallback_node.hpp"
#include "bt_nodes/decorator/keep_running_until_failure_node.hpp"
#include "bt_nodes/decorator/keep_running_until_success_node.hpp"
#include "bt_nodes/action/always_success_node.hpp"
#include "bt_nodes/action/always_failure_node.hpp"
#include "bt_nodes/data/blackboard_gate_node.hpp"

using namespace bt_core;

namespace {

/// 永远返回 RUNNING 的桩动作，用于验证 RUNNING 沿控制节点透传。
class RunningAction : public ActionNode {
 public:
  using ActionNode::ActionNode;
  static PortsList providedPorts() { return makePorts(); }
  NodeStatus tick() override { return NodeStatus::RUNNING; }
};

NodeFactory buildFactory() {
  NodeFactory factory;
  factory.registerNodeType<bt_nodes::KeepRunningUntilFailureNode>(
      "KeepRunningUntilFailure");
  factory.registerNodeType<bt_nodes::KeepRunningUntilSuccessNode>(
      "KeepRunningUntilSuccess");
  factory.registerNodeType<bt_nodes::ReactiveSequenceNode>("ReactiveSequence");
  factory.registerNodeType<bt_nodes::ReactiveFallbackNode>("ReactiveFallback");
  factory.registerNodeType<bt_nodes::AlwaysSuccessNode>("AlwaysSuccess");
  factory.registerNodeType<bt_nodes::AlwaysFailureNode>("AlwaysFailure");
  factory.registerNodeType<bt_nodes::BlackboardGateNode>("BlackboardGate");
  factory.registerNodeType<RunningAction>("RunningAction");
  return factory;
}

Tree load(NodeFactory& factory, const std::string& xml) {
  XmlParser parser(factory);
  return parser.loadFromText(xml);
}

}  // namespace

// KeepRunningUntilFailure：子节点一直成功 → 节点一直 RUNNING（永不停）。
TEST(GenericNodes, KeepRunningUntilFailureKeepsRunningOnSuccess) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <KeepRunningUntilFailure name="root">
          <AlwaysSuccess/>
        </KeepRunningUntilFailure>
      </BehaviorTree>
    </root>
  )");
  // 子节点 SUCCESS → 父节点继续 RUNNING。
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::RUNNING);
}

// KeepRunningUntilFailure：子节点失败 → 节点立即 FAILURE。
TEST(GenericNodes, KeepRunningUntilFailureStopsOnFailure) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <KeepRunningUntilFailure name="root">
          <AlwaysFailure/>
        </KeepRunningUntilFailure>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::FAILURE);
}

// KeepRunningUntilSuccess：子节点一直失败 → 节点一直 RUNNING。
TEST(GenericNodes, KeepRunningUntilSuccessKeepsRunningOnFailure) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <KeepRunningUntilSuccess name="root">
          <AlwaysFailure/>
        </KeepRunningUntilSuccess>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::RUNNING);
}

// KeepRunningUntilSuccess：子节点成功 → 节点 SUCCESS。
TEST(GenericNodes, KeepRunningUntilSuccessStopsOnSuccess) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <KeepRunningUntilSuccess name="root">
          <AlwaysSuccess/>
        </KeepRunningUntilSuccess>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::SUCCESS);
}

// ReactiveSequence：全部子节点成功 → SUCCESS。
TEST(GenericNodes, ReactiveSequenceAllSuccess) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <ReactiveSequence name="root">
          <AlwaysSuccess/>
          <AlwaysSuccess/>
        </ReactiveSequence>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::SUCCESS);
}

// ReactiveSequence：任一子节点失败 → FAILURE。
TEST(GenericNodes, ReactiveSequenceFailsOnChildFailure) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <ReactiveSequence name="root">
          <AlwaysSuccess/>
          <AlwaysFailure/>
        </ReactiveSequence>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::FAILURE);
}

// ReactiveFallback：第一个子节点成功 → SUCCESS。
TEST(GenericNodes, ReactiveFallbackFirstSuccess) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <ReactiveFallback name="root">
          <AlwaysSuccess/>
          <AlwaysFailure/>
        </ReactiveFallback>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::SUCCESS);
}

// ReactiveFallback：全部失败 → FAILURE。
TEST(GenericNodes, ReactiveFallbackAllFail) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <ReactiveFallback name="root">
          <AlwaysFailure/>
          <AlwaysFailure/>
        </ReactiveFallback>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::FAILURE);
}

// 边界：ReactiveSequence 首个子节点 RUNNING → 整节点 RUNNING（不透传成功/失败）。
TEST(GenericNodes, ReactiveSequencePropagatesRunning) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <ReactiveSequence name="root">
          <RunningAction/>
          <AlwaysSuccess/>
        </ReactiveSequence>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::RUNNING);
}

// 边界：ReactiveFallback 首个子节点 RUNNING → 整节点 RUNNING（不落到下一候选）。
TEST(GenericNodes, ReactiveFallbackPropagatesRunning) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <ReactiveFallback name="root">
          <RunningAction/>
          <AlwaysSuccess/>
        </ReactiveFallback>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::RUNNING);
}

// 边界：KeepRunningUntilFailure 空子树 → XML 解析器拒绝（装饰节点必须恰好一个子节点）。
TEST(GenericNodes, KeepRunningUntilFailureEmptyRejected) {
  auto factory = buildFactory();
  XmlParser parser(factory);
  EXPECT_THROW(parser.loadFromText(R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <KeepRunningUntilFailure name="root"/>
      </BehaviorTree>
    </root>
  )"), std::runtime_error);
}

// 边界：KeepRunningUntilSuccess 空子树 → 解析器拒绝。
TEST(GenericNodes, KeepRunningUntilSuccessEmptyRejected) {
  auto factory = buildFactory();
  XmlParser parser(factory);
  EXPECT_THROW(parser.loadFromText(R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <KeepRunningUntilSuccess name="root"/>
      </BehaviorTree>
    </root>
  )"), std::runtime_error);
}

// BlackboardGate：键不存在 → FAILURE。
TEST(GenericNodes, BlackboardGateFailsWhenKeyMissing) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <BlackboardGate name="root" key="mode" expected="zone2"/>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::FAILURE);
}

// BlackboardGate：键存在且值匹配 → SUCCESS。
TEST(GenericNodes, BlackboardGatePassesWhenValueMatches) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <TreeNodesModel>
        <Blackboard>
          <Entry key="mode" type="string" value="zone2" description="test"/>
        </Blackboard>
      </TreeNodesModel>
      <BehaviorTree ID="MainTree">
        <BlackboardGate name="root" key="mode" expected="zone2"/>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::SUCCESS);
}

// BlackboardGate：键存在但值不匹配 → FAILURE。
TEST(GenericNodes, BlackboardGateFailsWhenValueMismatch) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <TreeNodesModel>
        <Blackboard>
          <Entry key="mode" type="string" value="zone1" description="test"/>
        </Blackboard>
      </TreeNodesModel>
      <BehaviorTree ID="MainTree">
        <BlackboardGate name="root" key="mode" expected="zone2"/>
      </BehaviorTree>
    </root>
  )");
  const auto status = tree.tickOnce();
  EXPECT_EQ(status, NodeStatus::FAILURE);
}

