// ============================================================================
//  tests/test_ros_bases.cpp
//  bt_ros2 订阅/发布可复用基类的单元测试 —— 用 tests/mock_rclcpp 让本机零
//  ROS2 环境也能跑回归。
//
//  覆盖目标:
//    - RosConditionNode<MsgT>     (从 ROS topic 拿数据当条件)
//    - RosInputNode<MsgT>         (从 ROS topic 录入黑板)
//    - RosOutputNode<MsgT>        (状态完成发布到 ROS topic)
//    - providedPorts() 合并自定义端口模式
//    - 数据新鲜度 timeout_ms 行为
//
//  不验证:真实 rclcpp 行为(那需要 ROS2 环境;mock 只能验证"我们的模板逻辑
//  在符合 ROS API 表面的运行时下,行为正确")。
// ============================================================================
#include <gtest/gtest.h>

#include <memory>
#include <thread>
#include <chrono>

#include "bt_ros2/ros_publisher_node.hpp"
#include "bt_ros2/ros_subscriber_node.hpp"

namespace {

// ---------------------------- mock 消息类型 ---------------------------------
struct RangeMsg  { double range{0};            using SharedPtr = std::shared_ptr<RangeMsg>;  };
struct StringMsg { std::string data;           using SharedPtr = std::shared_ptr<StringMsg>; };

// ---------------------------- 测试用具体节点 --------------------------------
using namespace bt_core;

// 条件节点:range < threshold 则 SUCCESS;覆盖端口合并 + 自定义阈值
class IsClose : public bt_ros2::RosConditionNode<RangeMsg> {
 public:
  using RosConditionNode::RosConditionNode;
  static PortsList providedPorts() {
    auto p = subscriberPorts();
    p.insert(InputPort<double>("threshold", "0.5", "阈值"));
    return p;
  }
  bool evaluate(const RangeMsg& m) override {
    return m.range < getInput<double>("threshold").value_or(0.5);
  }
};

// 录入节点:把 range 写入输出端口(可被 XML 重映射到任意黑板 key)
class ReadRange : public bt_ros2::RosInputNode<RangeMsg> {
 public:
  using RosInputNode::RosInputNode;
  static PortsList providedPorts() {
    auto p = subscriberPorts();
    p.insert(OutputPort<double>("value", "录入的距离值"));
    return p;
  }
  void onData(const RangeMsg& m) override { setOutput<double>("value", m.range); }
};

// 发布节点:从 task_name 端口取值,发送 "task_done:<name>";name=="reject" 则拒发
class TaskDone : public bt_ros2::RosOutputNode<StringMsg> {
 public:
  using RosOutputNode::RosOutputNode;
  static PortsList providedPorts() {
    auto p = publisherPorts();
    p.insert(InputPort<std::string>("task_name", "unknown", "任务名"));
    return p;
  }
  bool buildMsg(StringMsg& out) override {
    auto name = getInput<std::string>("task_name").value_or("?");
    if (name == "reject") return false;
    out.data = "task_done:" + name;
    return true;
  }
};

// 通用测试 fixture:每个用例都需要 bb + node + setRosNodeHandle
struct RosBasesTest : ::testing::Test {
  Blackboard::Ptr bb = Blackboard::create();
  rclcpp::Node    node;
  void SetUp() override { bt_ros2::setRosNodeHandle(bb, &node); }
};

// 工具:构造一个 NodeConfig
NodeConfig makeCfg(Blackboard::Ptr bb,
                   std::unordered_map<std::string, std::string> vals = {},
                   std::unordered_map<std::string, std::string> remap = {}) {
  NodeConfig c;
  c.blackboard = bb;
  c.port_values = std::move(vals);
  c.port_remap = std::move(remap);
  return c;
}

}  // namespace

// ──────────────────────────── RosConditionNode ─────────────────────────────

TEST_F(RosBasesTest, ConditionFailsWhenNoDataReceived) {
  auto cfg = makeCfg(bb, {{"topic", "/range"}, {"timeout_ms", "0"}});
  IsClose n("c", cfg);
  EXPECT_EQ(n.tick(), NodeStatus::FAILURE);  // 从未收到 → onNoFreshData → FAILURE
}

TEST_F(RosBasesTest, ConditionSuccessAndFailureBasedOnEvaluate) {
  auto cfg = makeCfg(bb, {{"topic", "/range"}, {"timeout_ms", "0"}, {"threshold", "1.0"}});
  IsClose n("c", cfg);

  // 首次 tick 触发惰性 create_subscription(此时无数据 → FAILURE),
  // 之后 deliver 才有合法的派发器可调。
  EXPECT_EQ(n.tick(), NodeStatus::FAILURE);

  auto m1 = std::make_shared<RangeMsg>(); m1->range = 0.5;
  node.deliver(&m1);
  EXPECT_EQ(n.tick(), NodeStatus::SUCCESS);  // 0.5 < 1.0 → 成立

  auto m2 = std::make_shared<RangeMsg>(); m2->range = 1.5;
  node.deliver(&m2);
  EXPECT_EQ(n.tick(), NodeStatus::FAILURE);  // 1.5 不 < 1.0 → 不成立
}

TEST_F(RosBasesTest, ConditionRespectsTimeoutMs) {
  // timeout=50ms,睡 100ms 后数据过期 → FAILURE
  auto cfg = makeCfg(bb, {{"topic", "/range"}, {"timeout_ms", "50"}, {"threshold", "10.0"}});
  IsClose n("c", cfg);

  // 同上:先 tick 一次触发惰性订阅。
  EXPECT_EQ(n.tick(), NodeStatus::FAILURE);

  auto m = std::make_shared<RangeMsg>(); m->range = 0.1;
  node.deliver(&m);
  EXPECT_EQ(n.tick(), NodeStatus::SUCCESS);  // 刚收到,新鲜

  std::this_thread::sleep_for(std::chrono::milliseconds(120));
  EXPECT_EQ(n.tick(), NodeStatus::FAILURE);  // 过期 → onNoFreshData
}

TEST_F(RosBasesTest, ConditionMergesCustomPorts) {
  auto ports = IsClose::providedPorts();
  EXPECT_EQ(ports.size(), 4u);  // topic / timeout_ms / qos_depth / threshold
  EXPECT_TRUE(ports.count("topic"));
  EXPECT_TRUE(ports.count("timeout_ms"));
  EXPECT_TRUE(ports.count("qos_depth"));
  EXPECT_TRUE(ports.count("threshold"));
}

// ─────────────────────────────── RosInputNode ──────────────────────────────

TEST_F(RosBasesTest, InputNodeWritesBlackboardAndSucceeds) {
  // 用重映射把端口 value 输出到黑板 key "r"
  auto cfg = makeCfg(bb,
                     {{"topic", "/range"}, {"timeout_ms", "0"}},
                     {{"value", "r"}});
  ReadRange n("r", cfg);

  EXPECT_EQ(n.tick(), NodeStatus::FAILURE);  // 无数据

  auto m = std::make_shared<RangeMsg>(); m->range = 2.71;
  node.deliver(&m);
  EXPECT_EQ(n.tick(), NodeStatus::SUCCESS);
  EXPECT_DOUBLE_EQ(bb->get<double>("r").value(), 2.71);
}

// ─────────────────────────────── RosOutputNode ─────────────────────────────

TEST_F(RosBasesTest, OutputNodePublishesAndSucceeds) {
  auto cfg = makeCfg(bb, {{"topic", "/done"}, {"task_name", "patrol"}});
  TaskDone n("n", cfg);
  EXPECT_EQ(n.tick(), NodeStatus::SUCCESS);
  auto pub = std::static_pointer_cast<rclcpp::Publisher<StringMsg>>(node.last_publisher_);
  ASSERT_NE(pub, nullptr);
  ASSERT_EQ(pub->published.size(), 1u);
  EXPECT_EQ(pub->published[0].data, "task_done:patrol");
  EXPECT_EQ(node.last_topic_, "/done");
}

TEST_F(RosBasesTest, OutputNodeReturnsFailureWhenBuildMsgRefuses) {
  auto cfg = makeCfg(bb, {{"topic", "/done"}, {"task_name", "reject"}});
  TaskDone n("n", cfg);
  EXPECT_EQ(n.tick(), NodeStatus::FAILURE);  // buildMsg 返 false
  auto pub = std::static_pointer_cast<rclcpp::Publisher<StringMsg>>(node.last_publisher_);
  ASSERT_NE(pub, nullptr);
  EXPECT_TRUE(pub->published.empty());  // 拒发 → publisher 列表为空
}

TEST_F(RosBasesTest, OutputNodeThrowsOnMissingTopic) {
  auto cfg = makeCfg(bb, {{"task_name", "x"}});  // 缺 topic
  TaskDone n("n", cfg);
  EXPECT_THROW(n.tick(), std::runtime_error);
}

TEST_F(RosBasesTest, OutputNodeMergesCustomPorts) {
  auto ports = TaskDone::providedPorts();
  EXPECT_EQ(ports.size(), 3u);  // topic / qos_depth / task_name
  EXPECT_TRUE(ports.count("topic"));
  EXPECT_TRUE(ports.count("qos_depth"));
  EXPECT_TRUE(ports.count("task_name"));
}
