// ============================================================================
//  tests/test_data_nodes.cpp
//  数据层单元测试(GoogleTest)。
//
//  覆盖两块互相独立、均为 ROS-free 的纯逻辑：
//    A) bt_ros2/data_freshness.hpp —— isFresh / dataAgeMs 的时效判定纯函数
//       (只依赖 <chrono>，不依赖 rclcpp，可本机直接编译)。
//    B) bt_nodes/data/*.hpp —— 6 个 header-only 数据节点(依赖 bt_core)：
//       SetBlackboard / CompareBlackboard / CheckBool / Counter /
//       CooldownCondition / SetBool。
//
//  说明：
//    - data_freshness 与 bt_nodes/data 均为 header-only，本测试只需 include 头
//      文件 + link bt::core，不需要 link bt_ros2 库(那个需要 ROS2)。
//    - 数据节点通过 NodeConfig.port_values 注入“字面量端口值”，再直接构造节点
//      实例 executeTick()，等价于 XML 字面量端口的运行路径。
// ============================================================================
#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <string>
#include <thread>

#include "bt_core/blackboard.hpp"
#include "bt_core/node_status.hpp"
#include "bt_core/tree_node.hpp"

// 被测的纯逻辑头文件。
#include "bt_ros2/data_freshness.hpp"

// 被测的 6 个 header-only 数据节点。
#include "data/check_bool_node.hpp"
#include "data/compare_blackboard_node.hpp"
#include "data/cooldown_condition_node.hpp"
#include "data/counter_node.hpp"
#include "data/set_blackboard_node.hpp"
#include "data/set_bool_node.hpp"

using bt_core::Blackboard;
using bt_core::NodeConfig;
using bt_core::NodeStatus;

// ============================================================================
//  A) data_freshness 纯逻辑 —— isFresh / dataAgeMs
// ============================================================================

namespace {
using bt_ros2::SteadyTime;

/// 基准时刻 + 偏移(毫秒)，构造便于推理的 steady_clock 时间点。
SteadyTime base() { return SteadyTime{}; }
SteadyTime atMs(long ms) {
  return SteadyTime{} + std::chrono::milliseconds(ms);
}
}  // namespace

TEST(DataFreshness, NeverReceivedIsNotFresh) {
  // 从未收到过任何数据 → 无论窗口多大都不新鲜。
  EXPECT_FALSE(bt_ros2::isFresh(/*received=*/false, base(), atMs(0), 1000));
  EXPECT_FALSE(bt_ros2::isFresh(/*received=*/false, base(), atMs(0), 0));
  EXPECT_FALSE(bt_ros2::isFresh(/*received=*/false, base(), atMs(0), -5));
}

TEST(DataFreshness, NonPositiveTimeoutMeansNeverExpire) {
  // timeout <= 0 且收到过 → 永不过期，恒新鲜(即使数据已“很老”)。
  EXPECT_TRUE(bt_ros2::isFresh(/*received=*/true, atMs(0), atMs(1'000'000), 0));
  EXPECT_TRUE(bt_ros2::isFresh(/*received=*/true, atMs(0), atMs(1'000'000), -1));
}

TEST(DataFreshness, WithinWindowIsFresh) {
  // last_recv=100ms, now=600ms → age=500ms ≤ timeout=1000ms → 新鲜。
  EXPECT_TRUE(bt_ros2::isFresh(true, atMs(100), atMs(600), 1000));
}

TEST(DataFreshness, BoundaryAgeEqualsTimeoutIsFresh) {
  // age 恰等于 timeout(边界 age==timeout)→ 仍新鲜(判定为 age <= timeout)。
  EXPECT_TRUE(bt_ros2::isFresh(true, atMs(0), atMs(1000), 1000));
}

TEST(DataFreshness, OutsideWindowIsStale) {
  // age=1001ms > timeout=1000ms → 过期，不新鲜。
  EXPECT_FALSE(bt_ros2::isFresh(true, atMs(0), atMs(1001), 1000));
}

TEST(DataFreshness, ClockGoesBackwardStillFresh) {
  // 时钟回拨：now < last_recv → age<0 → 视为“刚收到”，仍新鲜。
  EXPECT_TRUE(bt_ros2::isFresh(true, atMs(1000), atMs(500), 100));
}

TEST(DataAgeMs, NeverReceivedReturnsMinusOne) {
  EXPECT_EQ(bt_ros2::dataAgeMs(/*received=*/false, base(), atMs(500)), -1);
}

TEST(DataAgeMs, NormalAge) {
  EXPECT_EQ(bt_ros2::dataAgeMs(true, atMs(200), atMs(950)), 750);
}

TEST(DataAgeMs, ClockGoesBackwardClampsToZero) {
  // now < last_recv → 负年龄被钳到 0。
  EXPECT_EQ(bt_ros2::dataAgeMs(true, atMs(1000), atMs(400)), 0);
}

// ============================================================================
//  B) 6 个数据节点
//
//  辅助：构造一个带指定字面量端口值的 NodeConfig。直接把字面量塞进
//  port_values，等价于 XML 里 <Node port="literal"/> 的运行路径。
// ============================================================================

namespace {

/// 用给定黑板与“端口名->字面量”映射构造 NodeConfig。
NodeConfig makeConfig(
    const Blackboard::Ptr& bb,
    std::initializer_list<std::pair<const std::string, std::string>> ports = {}) {
  NodeConfig cfg;
  cfg.blackboard = bb;
  for (const auto& kv : ports) cfg.port_values[kv.first] = kv.second;
  return cfg;
}

}  // namespace

// --------------------------- SetBlackboard ----------------------------------

TEST(SetBlackboard, WritesValueReadableFromBlackboard) {
  auto bb = Blackboard::create();
  bt_nodes::SetBlackboardNode node(
      "set", makeConfig(bb, {{"value", "42"}, {"output_key", "score"}}));

  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);
  // 值以字符串形式落到黑板的 "score" key。
  ASSERT_TRUE(bb->contains("score"));
  EXPECT_EQ(bb->get<std::string>("score").value(), "42");
}

TEST(SetBlackboard, EmptyOutputKeyFails) {
  // 没有目标 key → 无法写入 → FAILURE(避免静默无效)。
  auto bb = Blackboard::create();
  bt_nodes::SetBlackboardNode node("set", makeConfig(bb, {{"value", "x"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::FAILURE);
}

// --------------------------- CompareBlackboard ------------------------------
//  数值路径：六种运算符。黑板写入数值字符串 "10"。

namespace {
/// 便捷：建一个比较 key="n"(值=lhs) op value=rhs 的节点并 tick，返回结果。
NodeStatus compareNumeric(const std::string& lhs, const std::string& op,
                          const std::string& rhs) {
  auto bb = Blackboard::create();
  bb->set<std::string>("n", lhs);
  bt_nodes::CompareBlackboardNode node(
      "cmp", makeConfig(bb, {{"key", "n"}, {"op", op}, {"value", rhs}}));
  return node.executeTick();
}
}  // namespace

TEST(CompareBlackboard, NumericAllSixOperators) {
  // lhs=10, rhs=10 / 20 覆盖每个运算符的真与假。
  EXPECT_EQ(compareNumeric("10", "==", "10"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareNumeric("10", "==", "20"), NodeStatus::FAILURE);

  EXPECT_EQ(compareNumeric("10", "!=", "20"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareNumeric("10", "!=", "10"), NodeStatus::FAILURE);

  EXPECT_EQ(compareNumeric("10", "<", "20"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareNumeric("10", "<", "10"), NodeStatus::FAILURE);

  EXPECT_EQ(compareNumeric("10", "<=", "10"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareNumeric("10", "<=", "5"), NodeStatus::FAILURE);

  EXPECT_EQ(compareNumeric("10", ">", "5"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareNumeric("10", ">", "10"), NodeStatus::FAILURE);

  EXPECT_EQ(compareNumeric("10", ">=", "10"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareNumeric("10", ">=", "20"), NodeStatus::FAILURE);
}

namespace {
/// 字符串路径：lhs/rhs 至少一方非数值 → 字典序比较。
NodeStatus compareString(const std::string& lhs, const std::string& op,
                         const std::string& rhs) {
  auto bb = Blackboard::create();
  bb->set<std::string>("s", lhs);
  bt_nodes::CompareBlackboardNode node(
      "cmp", makeConfig(bb, {{"key", "s"}, {"op", op}, {"value", rhs}}));
  return node.executeTick();
}
}  // namespace

TEST(CompareBlackboard, StringAllSixOperators) {
  // "apple" vs "apple"/"banana"：字典序 apple < banana。
  EXPECT_EQ(compareString("apple", "==", "apple"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareString("apple", "==", "banana"), NodeStatus::FAILURE);

  EXPECT_EQ(compareString("apple", "!=", "banana"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareString("apple", "!=", "apple"), NodeStatus::FAILURE);

  EXPECT_EQ(compareString("apple", "<", "banana"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareString("banana", "<", "apple"), NodeStatus::FAILURE);

  EXPECT_EQ(compareString("apple", "<=", "apple"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareString("banana", "<=", "apple"), NodeStatus::FAILURE);

  EXPECT_EQ(compareString("banana", ">", "apple"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareString("apple", ">", "banana"), NodeStatus::FAILURE);

  EXPECT_EQ(compareString("apple", ">=", "apple"), NodeStatus::SUCCESS);
  EXPECT_EQ(compareString("apple", ">=", "banana"), NodeStatus::FAILURE);
}

TEST(CompareBlackboard, MissingKeyFails) {
  // key 不存在于黑板 → FAILURE(条件不成立)。
  auto bb = Blackboard::create();
  bt_nodes::CompareBlackboardNode node(
      "cmp", makeConfig(bb, {{"key", "absent"}, {"op", "=="}, {"value", "1"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::FAILURE);
}

TEST(CompareBlackboard, IllegalOperatorFails) {
  // op 非法 → 数值路径与字符串路径都返回 false → FAILURE。
  EXPECT_EQ(compareNumeric("10", "<>", "10"), NodeStatus::FAILURE);
  EXPECT_EQ(compareString("apple", "~=", "apple"), NodeStatus::FAILURE);
}

// --------------------------- CheckBool --------------------------------------

TEST(CheckBool, TrueBoolStorageExpectedTrue) {
  // 真正的 bool 存储 + expected=true(默认)。
  auto bb = Blackboard::create();
  bb->set<bool>("flag", true);
  bt_nodes::CheckBoolNode node("chk", makeConfig(bb, {{"key", "flag"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);
}

TEST(CheckBool, BoolStorageExpectedFalseMismatch) {
  // bool=true 但 expected=false → 不相符 → FAILURE。
  auto bb = Blackboard::create();
  bb->set<bool>("flag", true);
  bt_nodes::CheckBoolNode node(
      "chk", makeConfig(bb, {{"key", "flag"}, {"expected", "false"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::FAILURE);
}

TEST(CheckBool, StringTrueStorageExpectedTrue) {
  // 字符串 "true" 存储 → 回退解析为 true。
  auto bb = Blackboard::create();
  bb->set<std::string>("flag", "true");
  bt_nodes::CheckBoolNode node("chk", makeConfig(bb, {{"key", "flag"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);
}

TEST(CheckBool, StringOneStorageExpectedTrue) {
  // 字符串 "1" 存储 → 回退解析为 true。
  auto bb = Blackboard::create();
  bb->set<std::string>("flag", "1");
  bt_nodes::CheckBoolNode node("chk", makeConfig(bb, {{"key", "flag"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);
}

TEST(CheckBool, StringFalseStorageExpectedFalse) {
  // 字符串 "false" → 解析为 false；expected=false → 相符 → SUCCESS。
  auto bb = Blackboard::create();
  bb->set<std::string>("flag", "false");
  bt_nodes::CheckBoolNode node(
      "chk", makeConfig(bb, {{"key", "flag"}, {"expected", "false"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);
}

TEST(CheckBool, MissingKeyFails) {
  auto bb = Blackboard::create();
  bt_nodes::CheckBoolNode node("chk", makeConfig(bb, {{"key", "absent"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::FAILURE);
}

// --------------------------- Counter ----------------------------------------

TEST(Counter, NewKeyStartsFromZeroWithDefaultStep) {
  // 新 key：视当前值为 0，默认 step=1 → 写入 1。
  auto bb = Blackboard::create();
  bt_nodes::CounterNode node("cnt", makeConfig(bb, {{"key", "c"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);
  ASSERT_TRUE(bb->contains("c"));
  EXPECT_EQ(bb->get<int>("c").value(), 1);
}

TEST(Counter, AccumulatesAcrossTicks) {
  // 连续 tick 累加：1 → 2 → 3。
  auto bb = Blackboard::create();
  bt_nodes::CounterNode node("cnt", makeConfig(bb, {{"key", "c"}}));
  node.executeTick();
  node.executeTick();
  node.executeTick();
  EXPECT_EQ(bb->get<int>("c").value(), 3);
}

TEST(Counter, CustomPositiveStep) {
  // step=10 → 每拍 +10。
  auto bb = Blackboard::create();
  bt_nodes::CounterNode node("cnt",
                             makeConfig(bb, {{"key", "c"}, {"step", "10"}}));
  node.executeTick();
  node.executeTick();
  EXPECT_EQ(bb->get<int>("c").value(), 20);
}

TEST(Counter, NegativeStepDecrements) {
  // step=-3，已有值 10 → 10-3=7。
  auto bb = Blackboard::create();
  bb->set<int>("c", 10);
  bt_nodes::CounterNode node("cnt",
                             makeConfig(bb, {{"key", "c"}, {"step", "-3"}}));
  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);
  EXPECT_EQ(bb->get<int>("c").value(), 7);
}

// --------------------------- CooldownCondition ------------------------------

TEST(CooldownCondition, FirstTickPassesThenCoolsDownThenPasses) {
  auto bb = Blackboard::create();
  // cooldown 设小(50ms)，便于 sleep 跨过。
  bt_nodes::CooldownConditionNode node(
      "cd", makeConfig(bb, {{"cooldown_ms", "50"}}));

  // 首拍：无历史成功记录 → 放行。
  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);

  // 紧接着第二拍：仍在冷却期内 → FAILURE。
  EXPECT_EQ(node.executeTick(), NodeStatus::FAILURE);

  // 睡过冷却期(50ms + 余量) → 再次放行。
  std::this_thread::sleep_for(std::chrono::milliseconds(80));
  EXPECT_EQ(node.executeTick(), NodeStatus::SUCCESS);
}

// --------------------------- SetBool + CheckBool 联动 -----------------------

TEST(SetBool, WritesRealBoolReadableByCheckBool) {
  auto bb = Blackboard::create();
  // SetBool 写入真正的 bool=true。
  bt_nodes::SetBoolNode setter(
      "set", makeConfig(bb, {{"key", "is_ready"}, {"value", "true"}}));
  EXPECT_EQ(setter.executeTick(), NodeStatus::SUCCESS);

  // 黑板里确实是 bool 类型(精确读取不抛异常)。
  ASSERT_TRUE(bb->contains("is_ready"));
  EXPECT_TRUE(bb->get<bool>("is_ready").value());

  // CheckBool 走精确 bool 读取路径 → expected=true → SUCCESS。
  bt_nodes::CheckBoolNode checker("chk",
                                  makeConfig(bb, {{"key", "is_ready"}}));
  EXPECT_EQ(checker.executeTick(), NodeStatus::SUCCESS);
}

TEST(SetBool, WritesFalseReadableByCheckBool) {
  auto bb = Blackboard::create();
  bt_nodes::SetBoolNode setter(
      "set", makeConfig(bb, {{"key", "has_error"}, {"value", "false"}}));
  EXPECT_EQ(setter.executeTick(), NodeStatus::SUCCESS);
  EXPECT_FALSE(bb->get<bool>("has_error").value());

  // CheckBool expected=false → 相符 → SUCCESS。
  bt_nodes::CheckBoolNode checker(
      "chk", makeConfig(bb, {{"key", "has_error"}, {"expected", "false"}}));
  EXPECT_EQ(checker.executeTick(), NodeStatus::SUCCESS);
}
