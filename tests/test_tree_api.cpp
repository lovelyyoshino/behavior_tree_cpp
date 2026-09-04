// ============================================================================
//  tests/test_tree_api.cpp
//  bt_server 黑板初始化 API 契约回归。
//
//  @author pony
//  @date 2026-08-18
//  @version v1.2.0
//  @last_modified 2026-08-18
//  @changelog
//    - v1.1.0 (2026-08-18): 覆盖 XML 内嵌黑板初值的载入、执行与再次导出
//    - v1.2.0 (2026-08-18): 覆盖服务导出时保留多树和 SubTreePlus 调用
//    - v1.0.0 (2026-08-18): 覆盖未加载树、string/bool/int/double 和错误类型
// ============================================================================
#include <gtest/gtest.h>

#include <memory>

#include "demo_nodes.hpp"
#include "json_util.hpp"
#include "tree_api_service.hpp"

namespace {

class CheckMessageNode : public bt_core::ConditionNode {
 public:
  using bt_core::ConditionNode::ConditionNode;

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>("value", "", "要匹配的黑板文本"));
  }

  bt_core::NodeStatus tick() override {
    return getInput<std::string>("value").value_or("") == "hello"
               ? bt_core::NodeStatus::SUCCESS
               : bt_core::NodeStatus::FAILURE;
  }
};

std::unique_ptr<bt_server::TreeApiService> makeService(
    bt_core::NodeFactory& factory) {
  bt_server::registerDemoNodes(factory);
  return std::make_unique<bt_server::TreeApiService>(factory, "examples/trees");
}

constexpr const char* kTree =
    R"(<root main_tree_to_execute="MainTree">
         <BehaviorTree ID="MainTree"><SaySomething message="{message}"/></BehaviorTree>
       </root>)";

constexpr const char* kBlackboardTree =
    R"(<root main_tree_to_execute="MainTree">
         <BehaviorTree ID="MainTree"><CheckMessage value="{message}"/></BehaviorTree>
       </root>)";

constexpr const char* kBoundBlackboardTree =
    R"(<root main_tree_to_execute="MainTree">
         <TreeNodesModel>
           <Blackboard>
             <Entry key="message" type="string" value="hello" description="启动问候语"/>
           </Blackboard>
         </TreeNodesModel>
         <BehaviorTree ID="MainTree"><CheckMessage value="{message}"/></BehaviorTree>
       </root>)";

constexpr const char* kMultiTree =
    R"(<root main_tree_to_execute="Main">
         <TreeNodesModel><Blackboard>
           <Entry key="message" type="string" value="hello"/>
         </Blackboard></TreeNodesModel>
         <BehaviorTree ID="Main"><SubTreePlus ID="Helper" message="{message}"/></BehaviorTree>
         <BehaviorTree ID="Helper"><SaySomething message="{message}"/></BehaviorTree>
       </root>)";

}  // namespace

TEST(TreeApiBlackboard, RequiresLoadedTree) {
  bt_core::NodeFactory factory;
  auto service = makeService(factory);

  const auto response = service->setBlackboardValue(
      R"({"key":"message","type":"string","value":"hello"})");
  EXPECT_EQ(response.status, 404);
  EXPECT_NE(response.body.find("当前没有已加载的树"), std::string::npos);
}

TEST(TreeApiBlackboard, AcceptsSupportedTypesAfterLoad) {
  bt_core::NodeFactory factory;
  auto service = makeService(factory);
  const std::string request = std::string(R"({"xml":")") +
                                bt_server::jsonEscape(kTree) + R"("})";
  const auto loaded = service->loadTree(request);
  ASSERT_EQ(loaded.status, 200);

  for (const auto& body : {
           R"({"key":"text","type":"string","value":"hello"})",
           R"({"key":"enabled","type":"bool","value":"true"})",
           R"({"key":"count","type":"int","value":"7"})",
           R"({"key":"temperature","type":"double","value":"25.5"})",
       }) {
    const auto response = service->setBlackboardValue(body);
    EXPECT_EQ(response.status, 200) << body;
    EXPECT_NE(response.body.find("\"ok\":true"),
              std::string::npos);
  }
}

TEST(TreeApiBlackboard, ValueIsVisibleToLoadedTree) {
  bt_core::NodeFactory factory;
  auto service = makeService(factory);
  factory.registerNodeType<CheckMessageNode>("CheckMessage");

  const std::string request = std::string(R"({"xml":")") +
                                bt_server::jsonEscape(kBlackboardTree) + R"("})";
  ASSERT_EQ(service->loadTree(request).status, 200);
  ASSERT_EQ(service->setBlackboardValue(
                 R"({"key":"message","type":"string","value":"hello"})")
                .status,
            200);

  const auto run = service->runTree();
  EXPECT_EQ(run.status, 200);
  EXPECT_NE(run.body.find(R"("final_status":"SUCCESS")"), std::string::npos);
}

TEST(TreeApiBlackboard, XmlMetadataInitializesAndRoundTripsWithTree) {
  bt_core::NodeFactory factory;
  auto service = makeService(factory);
  factory.registerNodeType<CheckMessageNode>("CheckMessage");

  const std::string request = std::string(R"({"xml":")") +
                                bt_server::jsonEscape(kBoundBlackboardTree) + R"("})";
  ASSERT_EQ(service->loadTree(request).status, 200);

  const auto run = service->runTree();
  EXPECT_EQ(run.status, 200);
  EXPECT_NE(run.body.find(R"("final_status":"SUCCESS")"), std::string::npos);

  const auto exported = service->exportTree();
  EXPECT_EQ(exported.status, 200);
  EXPECT_NE(exported.body.find("TreeNodesModel"), std::string::npos);
  EXPECT_NE(exported.body.find("Blackboard"), std::string::npos);
  EXPECT_NE(exported.body.find("message"), std::string::npos);
  EXPECT_NE(exported.body.find("启动问候语"), std::string::npos);
}

TEST(TreeApiBlackboard, ExportKeepsMultiTreeDefinitionsAndSubTreePlusCall) {
  bt_core::NodeFactory factory;
  auto service = makeService(factory);
  const std::string request = std::string(R"({"xml":")") +
                                bt_server::jsonEscape(kMultiTree) + R"("})";
  ASSERT_EQ(service->loadTree(request).status, 200);
  const auto exported = service->exportTree();
  ASSERT_EQ(exported.status, 200);
  EXPECT_NE(exported.body.find("BehaviorTree ID=\\\"Main\\\""), std::string::npos);
  EXPECT_NE(exported.body.find("BehaviorTree ID=\\\"Helper\\\""), std::string::npos);
  EXPECT_NE(exported.body.find("SubTreePlus"), std::string::npos);
  EXPECT_NE(exported.body.find("message=\\\"{message}\\\""), std::string::npos);
}

TEST(TreeApiBlackboard, RejectsInvalidValuesAndUnknownTypes) {
  bt_core::NodeFactory factory;
  auto service = makeService(factory);
  const std::string request = std::string(R"({"xml":")") +
                                bt_server::jsonEscape(kTree) + R"("})";
  const auto loaded = service->loadTree(request);
  ASSERT_EQ(loaded.status, 200);

  EXPECT_EQ(service->setBlackboardValue(
                 R"({"key":"enabled","type":"bool","value":"yes"})")
                .status,
            400);
  EXPECT_EQ(service->setBlackboardValue(
                 R"({"key":"count","type":"int","value":"oops"})")
                .status,
            400);
  EXPECT_EQ(service->setBlackboardValue(
                 R"({"key":"x","type":"float32","value":"1.0"})")
                .status,
            400);
  EXPECT_EQ(service->setBlackboardValue(
                 R"({"key":"","type":"string","value":"x"})")
                .status,
            400);
}
