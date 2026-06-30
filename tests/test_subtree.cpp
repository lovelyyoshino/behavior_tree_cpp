// ============================================================================
//  tests/test_subtree.cpp
//  XmlParser 的 <SubTree ID="..."/> 引用支持单元测试。
//
//  覆盖:
//    - 基本子树引用:Main 引用 Patrol,展开后正常 tick
//    - 多引用 + 嵌套(SubTree 内再引 SubTree)
//    - 循环引用检测(Main 引 Main / A引B,B引A 都应抛错)
//    - 未定义 ID 报错
//    - <SubTree> 缺 ID 属性报错
//    - 嵌套深度超限报错(用大量层级触发,边界场景可选验证)
//
//  风格与 test_data_nodes.cpp 一致:直接 include bt_nodes 节点头文件,
//  在测试里 NodeFactory 手动注册,无需依赖外部 .dylib 插件。
// ============================================================================
#include <gtest/gtest.h>

#include "bt_core/node_factory.hpp"
#include "bt_core/xml_parser.hpp"

#include "control/sequence_node.hpp"
#include "action/always_success_node.hpp"
#include "action/always_failure_node.hpp"

using namespace bt_core;

namespace {

/// 注册 SubTree 测试所需的最小节点集合。
void registerCore(NodeFactory& f) {
  f.registerNodeType<bt_nodes::SequenceNode>("Sequence");
  f.registerNodeType<bt_nodes::AlwaysSuccessNode>("AlwaysSuccess");
  f.registerNodeType<bt_nodes::AlwaysFailureNode>("AlwaysFailure");
}

}  // namespace

// ---------------------------- 基本引用 -------------------------------------

TEST(SubTree, BasicReferenceExpandsAndTicks) {
  NodeFactory f; registerCore(f);
  XmlParser p(f);
  const char* xml = R"(<root main_tree_to_execute="Main">
    <BehaviorTree ID="Main">
      <Sequence><SubTree ID="Helper"/></Sequence>
    </BehaviorTree>
    <BehaviorTree ID="Helper">
      <Sequence><AlwaysSuccess/><AlwaysSuccess/></Sequence>
    </BehaviorTree>
  </root>)";
  Tree t = p.loadFromText(xml);
  EXPECT_EQ(t.tickWhileRunning(), NodeStatus::SUCCESS);
  // 展开后节点总数 = Main的Sequence + Helper的Sequence + 2 个 AlwaysSuccess = 4
  EXPECT_EQ(t.nodes().size(), 4u);
}

// ---------------------------- 多引用 + 嵌套 ---------------------------------

TEST(SubTree, MultipleReferencesAndNestedSubtrees) {
  NodeFactory f; registerCore(f);
  XmlParser p(f);
  // Main 调 A 两次 + 调 B(B 内部又调 A)
  const char* xml = R"(<root main_tree_to_execute="Main">
    <BehaviorTree ID="Main">
      <Sequence><SubTree ID="A"/><SubTree ID="A"/><SubTree ID="B"/></Sequence>
    </BehaviorTree>
    <BehaviorTree ID="A"><AlwaysSuccess/></BehaviorTree>
    <BehaviorTree ID="B">
      <Sequence><SubTree ID="A"/><AlwaysSuccess/></Sequence>
    </BehaviorTree>
  </root>)";
  Tree t = p.loadFromText(xml);
  EXPECT_EQ(t.tickWhileRunning(), NodeStatus::SUCCESS);
  EXPECT_GE(t.nodes().size(), 5u);  // 至少 5 个展开节点
}

// ---------------------------- 循环引用 -------------------------------------

TEST(SubTree, SelfCycleIsDetected) {
  NodeFactory f; registerCore(f);
  XmlParser p(f);
  const char* xml = R"(<root main_tree_to_execute="Main">
    <BehaviorTree ID="Main"><SubTree ID="Main"/></BehaviorTree>
  </root>)";
  EXPECT_THROW(p.loadFromText(xml), std::runtime_error);
}

TEST(SubTree, MutualCycleIsDetected) {
  NodeFactory f; registerCore(f);
  XmlParser p(f);
  // A → B → A 互相引用
  const char* xml = R"(<root main_tree_to_execute="Main">
    <BehaviorTree ID="Main"><SubTree ID="A"/></BehaviorTree>
    <BehaviorTree ID="A"><SubTree ID="B"/></BehaviorTree>
    <BehaviorTree ID="B"><SubTree ID="A"/></BehaviorTree>
  </root>)";
  EXPECT_THROW(p.loadFromText(xml), std::runtime_error);
}

// ---------------------------- 错误路径 -------------------------------------

TEST(SubTree, UndefinedIdThrows) {
  NodeFactory f; registerCore(f);
  XmlParser p(f);
  const char* xml = R"(<root main_tree_to_execute="Main">
    <BehaviorTree ID="Main"><SubTree ID="Ghost"/></BehaviorTree>
  </root>)";
  EXPECT_THROW(p.loadFromText(xml), std::runtime_error);
}

TEST(SubTree, MissingIdAttributeThrows) {
  NodeFactory f; registerCore(f);
  XmlParser p(f);
  const char* xml = R"(<root main_tree_to_execute="Main">
    <BehaviorTree ID="Main"><SubTree/></BehaviorTree>
  </root>)";
  EXPECT_THROW(p.loadFromText(xml), std::runtime_error);
}

// ---------------------------- 不影响旧 XML 兼容 -----------------------------

TEST(SubTree, BackwardCompatibilityWithoutSubTree) {
  NodeFactory f; registerCore(f);
  XmlParser p(f);
  // 不含 <SubTree> 的旧 XML 必须仍正常工作(回归)
  const char* xml = R"(<root main_tree_to_execute="M">
    <BehaviorTree ID="M">
      <Sequence><AlwaysSuccess/><AlwaysSuccess/></Sequence>
    </BehaviorTree>
  </root>)";
  Tree t = p.loadFromText(xml);
  EXPECT_EQ(t.tickWhileRunning(), NodeStatus::SUCCESS);
  EXPECT_EQ(t.nodes().size(), 3u);
}
