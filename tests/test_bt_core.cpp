// ============================================================================
//  tests/test_bt_core.cpp
//  bt_core 核心库单元测试(GoogleTest)。
//  覆盖：NodeStatus / Blackboard / 三大族基类 / NodeFactory / Tree。
//
//  @author pony
//  @date 2026-06-30
//  @version v1.2.0
//  @last_modified 2026-08-18
//  @changelog
//    - v1.3.0 (2026-08-18): 覆盖黑板初值快照替换和键值规范化
//    - v1.2.0 (2026-08-18): 覆盖可导出的黑板初值与运行时值隔离
//    - v1.1.0 (2026-08-18): 覆盖 NodeFactory 可选节点文档清单
// ============================================================================
#include <gtest/gtest.h>

#include "bt_core/node_factory.hpp"
#include "bt_core/tree.hpp"

using namespace bt_core;

// --------------------------- 测试用具体节点 ---------------------------------

/// 可配置固定返回值的桩动作。
class StubAction : public ActionNode {
 public:
  StubAction(std::string n, NodeConfig c) : ActionNode(std::move(n), std::move(c)) {}
  static PortsList providedPorts() {
    return makePorts(InputPort<std::string>("ret", "SUCCESS", "返回值"));
  }
  static NodeDocumentation providedDocumentation() {
    return {"桩动作", "用于测试", "按 ret 返回状态", "非法输入按默认成功", "<Stub ret=\"SUCCESS\"/>"};
  }
  NodeStatus tick() override {
    auto r = getInput<std::string>("ret").value_or("SUCCESS");
    if (r == "FAILURE") return NodeStatus::FAILURE;
    if (r == "RUNNING") return NodeStatus::RUNNING;
    return NodeStatus::SUCCESS;
  }
};

class StubCondition : public ConditionNode {
 public:
  using ConditionNode::ConditionNode;
  NodeStatus tick() override {
    ++tick_count;
    return NodeStatus::FAILURE;
  }
  int tick_count{0};
};

/// 最小 Sequence。
class MiniSequence : public ControlNode {
 public:
  using ControlNode::ControlNode;
  NodeStatus tick() override {
    for (auto& c : children_) {
      auto s = c->executeTick();
      if (s != NodeStatus::SUCCESS) return s;
    }
    return NodeStatus::SUCCESS;
  }
};

/// 最小 Inverter。
class MiniInverter : public DecoratorNode {
 public:
  using DecoratorNode::DecoratorNode;
  NodeStatus tick() override {
    auto s = child_->executeTick();
    if (s == NodeStatus::SUCCESS) return NodeStatus::FAILURE;
    if (s == NodeStatus::FAILURE) return NodeStatus::SUCCESS;
    return s;
  }
};

// ------------------------------- NodeStatus ---------------------------------

TEST(NodeStatus, CompletedAndToStr) {
  EXPECT_TRUE(isStatusCompleted(NodeStatus::SUCCESS));
  EXPECT_TRUE(isStatusCompleted(NodeStatus::FAILURE));
  EXPECT_FALSE(isStatusCompleted(NodeStatus::RUNNING));
  EXPECT_FALSE(isStatusCompleted(NodeStatus::IDLE));
  EXPECT_EQ(toStr(NodeStatus::RUNNING), "RUNNING");
  EXPECT_EQ(toStr(NodeType::CONTROL), "Control");
}

// ------------------------------- Blackboard ---------------------------------

TEST(Blackboard, SetGetAndTypeSafety) {
  auto bb = Blackboard::create();
  bb->set<std::string>("msg", "hello");
  bb->set<int>("n", 7);
  EXPECT_EQ(bb->get<std::string>("msg").value(), "hello");
  EXPECT_EQ(bb->get<int>("n").value(), 7);
  EXPECT_FALSE(bb->get<int>("missing").has_value());
  EXPECT_TRUE(bb->contains("msg"));
  EXPECT_THROW(bb->get<int>("msg"), std::runtime_error);  // 类型不匹配
}

TEST(Blackboard, InitialEntriesRemainSeparateFromRuntimeUpdates) {
  auto bb = Blackboard::create();
  bb->setInitialValue("temperature", "double", "25.5", "启动测试值");
  ASSERT_EQ(bb->initialEntries().size(), 1u);
  EXPECT_DOUBLE_EQ(bb->get<double>("temperature").value(), 25.5);

  bb->set<double>("temperature", 80.0);
  EXPECT_DOUBLE_EQ(bb->get<double>("temperature").value(), 80.0);
  ASSERT_EQ(bb->initialEntries().size(), 1u);
  EXPECT_EQ(bb->initialEntries().front().value, "25.5");
  EXPECT_EQ(bb->initialEntries().front().description, "启动测试值");
}

TEST(Blackboard, ReplaceInitialValuesKeepsNonInitialRuntimeData) {
  auto bb = Blackboard::create();
  bb->set<std::string>("ros_node_handle", "runtime-only");
  bb->setInitialValue(" stale ", "string", "old");

  bb->replaceInitialValues({
      {" fresh ", "int", " 7 ", ""},
  });

  EXPECT_FALSE(bb->contains("stale"));
  EXPECT_EQ(bb->get<std::string>("ros_node_handle").value(), "runtime-only");
  ASSERT_EQ(bb->initialEntries().size(), 1u);
  EXPECT_EQ(bb->initialEntries().front().key, "fresh");
  EXPECT_EQ(bb->initialEntries().front().value, "7");
  EXPECT_EQ(bb->get<int>("fresh").value(), 7);
}

TEST(Blackboard, ReplaceInitialValuesRejectsAsOneTransaction) {
  auto bb = Blackboard::create();
  bb->setInitialValue("stable", "int", "3", "旧配置");
  bb->set<std::string>("runtime_only", "preserve");

  EXPECT_THROW(
      bb->replaceInitialValues({
          {"new_value", "double", "1.5", "新配置"},
          {"broken", "int", "not-a-number", "非法"},
      }),
      std::invalid_argument);

  ASSERT_EQ(bb->initialEntries().size(), 1u);
  EXPECT_EQ(bb->initialEntries().front().key, "stable");
  EXPECT_EQ(bb->get<int>("stable").value(), 3);
  EXPECT_FALSE(bb->contains("new_value"));
  EXPECT_EQ(bb->get<std::string>("runtime_only").value(), "preserve");
}

TEST(Blackboard, Ports) {
  auto ports = makePorts(
      InputPort<std::string>("in", "def", "输入"),
      OutputPort<int>("out", "输出"));
  EXPECT_EQ(ports.size(), 2u);
  EXPECT_EQ(ports.at("in").direction, PortDirection::INPUT);
  EXPECT_EQ(ports.at("out").direction, PortDirection::OUTPUT);
}

// ------------------------------ 基类层逻辑 ----------------------------------

TEST(ControlNode, SequenceSuccessAndFailure) {
  auto bb = Blackboard::create();
  NodeConfig cfg{bb, {}};

  auto seq = std::make_shared<MiniSequence>("seq", cfg);
  auto c1 = std::make_shared<StubAction>("c1", cfg);
  auto c2 = std::make_shared<StubAction>("c2", cfg);
  seq->addChild(c1);
  seq->addChild(c2);
  EXPECT_EQ(seq->type(), NodeType::CONTROL);
  EXPECT_EQ(seq->childrenCount(), 2u);
  EXPECT_EQ(seq->executeTick(), NodeStatus::SUCCESS);

  // 让 c1 失败 -> 整体失败
  bb->set<std::string>("ret", "FAILURE");
  EXPECT_EQ(seq->executeTick(), NodeStatus::FAILURE);
}

TEST(DecoratorNode, InverterAndSingleChildGuard) {
  auto bb = Blackboard::create();
  NodeConfig cfg{bb, {}};

  auto inv = std::make_shared<MiniInverter>("inv", cfg);
  inv->setChild(std::make_shared<StubAction>("c", cfg));  // 默认返回 SUCCESS
  EXPECT_EQ(inv->type(), NodeType::DECORATOR);
  EXPECT_EQ(inv->executeTick(), NodeStatus::FAILURE);      // 反转

  // 重复 setChild 抛异常
  EXPECT_THROW(inv->setChild(std::make_shared<StubAction>("c2", cfg)),
               std::logic_error);
}

TEST(LeafNode, ActionTypeFixed) {
  auto bb = Blackboard::create();
  NodeConfig cfg{bb, {}};
  StubAction a("a", cfg);
  EXPECT_EQ(a.type(), NodeType::ACTION);
}

// ------------------------------ NodeFactory ---------------------------------

TEST(NodeFactory, RegisterCreateAndManifest) {
  NodeFactory factory;
  factory.registerNodeType<MiniSequence>("Sequence");
  factory.registerNodeType<StubAction>("Stub");

  EXPECT_EQ(factory.size(), 2u);
  EXPECT_TRUE(factory.isRegistered("Sequence"));
  EXPECT_FALSE(factory.isRegistered("Nope"));
  EXPECT_THROW(factory.registerNodeType<StubAction>("Stub"), std::logic_error);

  bool found_stub = false;
  for (auto& m : factory.manifests()) {
    if (m.registration_name == "Stub") {
      found_stub = true;
      EXPECT_EQ(m.type, NodeType::ACTION);
      EXPECT_EQ(m.ports.count("ret"), 1u);
      EXPECT_EQ(m.documentation.summary, "桩动作");
      EXPECT_EQ(m.documentation.example_xml, "<Stub ret=\"SUCCESS\"/>");
    }
  }
  EXPECT_TRUE(found_stub);

  auto bb = Blackboard::create();
  NodeConfig cfg{bb, {}};
  EXPECT_THROW(factory.createNode("Ghost", "x", cfg), std::runtime_error);
  auto node = factory.createNode("Stub", "x", cfg);
  EXPECT_EQ(node->registrationName(), "Stub");
}

// --------------------------------- Tree -------------------------------------

TEST(Tree, TickTraverseAndCallback) {
  NodeFactory factory;
  factory.registerNodeType<MiniSequence>("Sequence");
  factory.registerNodeType<StubAction>("Stub");

  auto bb = Blackboard::create();
  NodeConfig cfg{bb, {}};
  auto root = std::dynamic_pointer_cast<ControlNode>(
      factory.createNode("Sequence", "root", cfg));
  root->addChild(factory.createNode("Stub", "s1", cfg));
  root->addChild(factory.createNode("Stub", "s2", cfg));

  Tree tree(root, bb);
  EXPECT_EQ(tree.nodes().size(), 3u);
  for (auto& n : tree.nodes()) EXPECT_NE(n->id(), 0);

  int cb = 0;
  tree.setStatusCallback([&](uint16_t, NodeStatus, NodeStatus) { cb++; });
  EXPECT_EQ(tree.tickWhileRunning(), NodeStatus::SUCCESS);
  EXPECT_GT(cb, 0);

  int visited = 0, max_depth = 0;
  tree.visitNodes([&](const TreeNode::Ptr&, int d) {
    visited++;
    max_depth = std::max(max_depth, d);
  });
  EXPECT_EQ(visited, 3);
  EXPECT_EQ(max_depth, 1);
}

TEST(Tree, DebugConditionOverrideSkipsConditionLogicAndCanBeCleared) {
  auto bb = Blackboard::create();
  NodeConfig cfg{bb, {}};
  auto condition = std::make_shared<StubCondition>("guard", cfg);
  Tree tree(condition, bb);

  tree.setConditionOverrides({{condition->id(), NodeStatus::SUCCESS}});
  EXPECT_EQ(tree.tickOnce(), NodeStatus::SUCCESS);
  EXPECT_EQ(condition->tick_count, 0);
  ASSERT_TRUE(condition->forcedStatus().has_value());
  EXPECT_EQ(*condition->forcedStatus(), NodeStatus::SUCCESS);

  tree.setConditionOverrides({});
  EXPECT_EQ(tree.tickOnce(), NodeStatus::FAILURE);
  EXPECT_EQ(condition->tick_count, 1);
  EXPECT_FALSE(condition->forcedStatus().has_value());
}

TEST(Tree, DebugOverrideRejectsNonConditionWithoutPartialMutation) {
  auto bb = Blackboard::create();
  NodeConfig cfg{bb, {}};
  auto root = std::make_shared<MiniSequence>("root", cfg);
  auto condition = std::make_shared<StubCondition>("guard", cfg);
  auto action = std::make_shared<StubAction>("action", cfg);
  root->addChild(condition);
  root->addChild(action);
  Tree tree(root, bb);

  EXPECT_THROW(
      tree.setConditionOverrides({
          {condition->id(), NodeStatus::SUCCESS},
          {action->id(), NodeStatus::FAILURE},
      }),
      std::invalid_argument);
  EXPECT_FALSE(condition->forcedStatus().has_value());
}
