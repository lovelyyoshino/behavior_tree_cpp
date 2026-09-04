// ============================================================================
//  tests/test_scheduling.cpp
//  单树优先级抢占与分级 tick 调度回归测试。
//
//  @author pony
//  @date 2026-08-18
//  @version v1.1.0
//  @last_modified 2026-08-18
//  @changelog
//    - v1.1.0 (2026-08-18): 覆盖 Parallel 外部阈值别名
//    - v1.0.0 (2026-08-18): 覆盖 PrioritySelector 抢占和 TickRate 分级周期
// ============================================================================
#include <functional>
#include <initializer_list>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include <gtest/gtest.h>

#include "bt_core/blackboard.hpp"
#include "bt_core/leaf_node.hpp"
#include "bt_nodes/control/parallel_node.hpp"
#include "bt_nodes/control/priority_selector_node.hpp"
#include "bt_nodes/decorator/tick_rate_node.hpp"

namespace {

using bt_core::NodeConfig;
using bt_core::NodeStatus;

NodeConfig config(
    std::initializer_list<std::pair<const std::string, std::string>> ports = {}) {
  NodeConfig cfg;
  cfg.blackboard = bt_core::Blackboard::create();
  cfg.port_values = ports;
  return cfg;
}

class ProbeAction final : public bt_core::ActionNode {
 public:
  ProbeAction(std::string name, NodeConfig cfg,
              std::function<NodeStatus()> behavior)
      : ActionNode(std::move(name), std::move(cfg)),
        behavior_(std::move(behavior)) {}

  NodeStatus tick() override {
    ++tick_count;
    return behavior_();
  }

  void onHalted() override { ++halt_count; }

  int tick_count{0};
  int halt_count{0};

 private:
  std::function<NodeStatus()> behavior_;
};

TEST(PrioritySelector, RechecksHigherPriorityAndPreemptsRunningBranch) {
  bool urgent = false;
  auto high = std::make_shared<ProbeAction>(
      "high", config(), [&urgent] {
        return urgent ? NodeStatus::SUCCESS : NodeStatus::FAILURE;
      });
  auto low = std::make_shared<ProbeAction>(
      "low", config(), [] { return NodeStatus::RUNNING; });
  bt_nodes::PrioritySelectorNode selector("root", config());
  selector.addChild(high);
  selector.addChild(low);

  EXPECT_EQ(selector.executeTick(), NodeStatus::RUNNING);
  EXPECT_EQ(high->tick_count, 1);
  EXPECT_EQ(low->tick_count, 1);

  urgent = true;
  EXPECT_EQ(selector.executeTick(), NodeStatus::SUCCESS);
  EXPECT_EQ(high->tick_count, 2);
  EXPECT_EQ(low->tick_count, 1);
  EXPECT_EQ(low->halt_count, 1);
  EXPECT_EQ(low->status(), NodeStatus::IDLE);
}

TEST(PrioritySelector, RunningHigherPriorityBlocksLowerBranches) {
  auto high = std::make_shared<ProbeAction>(
      "high", config(), [] { return NodeStatus::RUNNING; });
  auto low = std::make_shared<ProbeAction>(
      "low", config(), [] { return NodeStatus::SUCCESS; });
  bt_nodes::PrioritySelectorNode selector("root", config());
  selector.addChild(high);
  selector.addChild(low);

  EXPECT_EQ(selector.executeTick(), NodeStatus::RUNNING);
  EXPECT_EQ(selector.executeTick(), NodeStatus::RUNNING);
  EXPECT_EQ(high->tick_count, 2);
  EXPECT_EQ(low->tick_count, 0);
}

TEST(PrioritySelector, HaltResetsActiveBranch) {
  auto running = std::make_shared<ProbeAction>(
      "running", config(), [] { return NodeStatus::RUNNING; });
  bt_nodes::PrioritySelectorNode selector("root", config());
  selector.addChild(running);

  ASSERT_EQ(selector.executeTick(), NodeStatus::RUNNING);
  selector.halt();
  EXPECT_EQ(running->halt_count, 1);
  EXPECT_EQ(running->status(), NodeStatus::IDLE);
}

TEST(Parallel, AcceptsExternalThresholdAliases) {
  auto root_config = config({{"success_threshold", "1"},
                             {"failure_threshold", "1"}});
  bt_nodes::ParallelNode parallel("root", root_config);
  parallel.addChild(std::make_shared<ProbeAction>(
      "ok", config(), [] { return NodeStatus::SUCCESS; }));
  parallel.addChild(std::make_shared<ProbeAction>(
      "other", config(), [] { return NodeStatus::RUNNING; }));

  EXPECT_EQ(parallel.executeTick(), NodeStatus::SUCCESS);
}

TEST(TickRate, TierDefaultsControlCadenceAndPreserveRunning) {
  struct Case {
    const char* tier;
    int parent_ticks;
    int expected_child_ticks;
  };
  for (const Case sample : {Case{"critical", 5, 5},
                            Case{"normal", 5, 3},
                            Case{"background", 6, 2}}) {
    SCOPED_TRACE(sample.tier);
    auto child = std::make_shared<ProbeAction>(
        "child", config(), [] { return NodeStatus::RUNNING; });
    bt_nodes::TickRateNode rate("rate", config({{"tier", sample.tier}}));
    rate.setChild(child);

    for (int tick = 0; tick < sample.parent_ticks; ++tick) {
      EXPECT_EQ(rate.executeTick(), NodeStatus::RUNNING);
    }
    EXPECT_EQ(child->tick_count, sample.expected_child_ticks);
  }
}

TEST(TickRate, ExplicitIntervalOverridesTierAndHaltRestartsCadence) {
  auto child = std::make_shared<ProbeAction>(
      "child", config(), [] { return NodeStatus::RUNNING; });
  bt_nodes::TickRateNode rate(
      "rate", config({{"tier", "critical"}, {"every_n_ticks", "3"}}));
  rate.setChild(child);

  for (int tick = 0; tick < 7; ++tick) {
    EXPECT_EQ(rate.executeTick(), NodeStatus::RUNNING);
  }
  EXPECT_EQ(child->tick_count, 3);

  rate.halt();
  EXPECT_EQ(child->halt_count, 1);
  EXPECT_EQ(rate.executeTick(), NodeStatus::RUNNING);
  EXPECT_EQ(child->tick_count, 4);
}

TEST(TickRate, RejectsInvalidSchedulingConfiguration) {
  auto child = std::make_shared<ProbeAction>(
      "child", config(), [] { return NodeStatus::SUCCESS; });

  bt_nodes::TickRateNode invalid_tier("rate", config({{"tier", "fast"}}));
  invalid_tier.setChild(child);
  EXPECT_THROW(invalid_tier.executeTick(), std::invalid_argument);

  bt_nodes::TickRateNode invalid_interval(
      "rate", config({{"every_n_ticks", "-1"}}));
  invalid_interval.setChild(std::make_shared<ProbeAction>(
      "child", config(), [] { return NodeStatus::SUCCESS; }));
  EXPECT_THROW(invalid_interval.executeTick(), std::invalid_argument);
}

TEST(TickRate, ExposesEditorFriendlyTierManifest) {
  const auto ports = bt_nodes::TickRateNode::providedPorts();
  ASSERT_TRUE(ports.count("tier"));
  EXPECT_EQ(ports.at("tier").default_value, "normal");
  EXPECT_EQ(ports.at("tier").enum_values,
            (std::vector<std::string>{"critical", "normal", "background"}));
  ASSERT_TRUE(ports.count("every_n_ticks"));
  EXPECT_EQ(ports.at("every_n_ticks").default_value, "0");
}

}  // namespace
