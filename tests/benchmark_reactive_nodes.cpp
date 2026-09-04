/**
 * benchmark_reactive_nodes.cpp — 反应式节点性能剖析
 *
 * 量化 ReactiveSequence/ReactiveFallback 相比普通 Sequence/Fallback 的 tick 开销。
 * 反应式节点每拍重评估全部子节点（即使某子节点 RUNNING），普通控制节点只评估到
 * RUNNING 即停。这个基准测试用 Google Benchmark 跑大量 tick 测量开销差异。
 *
 * 编译：需 Google Benchmark（apt install libbenchmark-dev 或从源码构建）
 * 运行：./build/bin/benchmark_reactive_nodes --benchmark_filter=Reactive
 */

#include <benchmark/benchmark.h>
#include "bt_core/tree.hpp"
#include "bt_core/xml_parser.hpp"
#include "bt_nodes/control/sequence_node.hpp"
#include "bt_nodes/control/fallback_node.hpp"
#include "bt_nodes/control/reactive_sequence_node.hpp"
#include "bt_nodes/control/reactive_fallback_node.hpp"
#include "bt_nodes/action/always_success_node.hpp"
#include "bt_nodes/action/always_failure_node.hpp"

using namespace bt_core;

namespace {

/// 可配置的桩动作：前 N 次 tick 返回 RUNNING，之后返回指定状态。
class AlwaysRunningStub : public ActionNode {
 public:
  using ActionNode::ActionNode;
  static PortsList providedPorts() { return makePorts(); }
  NodeStatus tick() override { return NodeStatus::RUNNING; }
};

NodeFactory buildFactory() {
  NodeFactory factory;
  factory.registerNodeType<bt_nodes::SequenceNode>("Sequence");
  factory.registerNodeType<bt_nodes::FallbackNode>("Fallback");
  factory.registerNodeType<bt_nodes::ReactiveSequenceNode>("ReactiveSequence");
  factory.registerNodeType<bt_nodes::ReactiveFallbackNode>("ReactiveFallback");
  factory.registerNodeType<bt_nodes::AlwaysSuccessNode>("AlwaysSuccess");
  factory.registerNodeType<bt_nodes::AlwaysFailureNode>("AlwaysFailure");
  factory.registerNodeType<AlwaysRunningStub>("AlwaysRunning");
  return factory;
}

Tree load(NodeFactory& factory, const std::string& xml) {
  XmlParser parser(factory);
  return parser.loadFromText(xml);
}

}  // namespace

/// Sequence：第三个子节点 RUNNING → 前两个不重评估。
static void BM_NormalSequenceWithRunning(benchmark::State& state) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <Sequence>
          <AlwaysSuccess/>
          <AlwaysSuccess/>
          <AlwaysRunning/>
        </Sequence>
      </BehaviorTree>
    </root>
  )");

  for (auto _ : state) {
    tree.tickOnce();
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_NormalSequenceWithRunning);

/// ReactiveSequence：第三个子节点 RUNNING → 每拍仍重评估前两个。
static void BM_ReactiveSequenceWithRunning(benchmark::State& state) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <ReactiveSequence>
          <AlwaysSuccess/>
          <AlwaysSuccess/>
          <AlwaysRunning/>
        </ReactiveSequence>
      </BehaviorTree>
    </root>
  )");

  for (auto _ : state) {
    tree.tickOnce();
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_ReactiveSequenceWithRunning);

/// Fallback：第一个子节点 RUNNING → 后续不评估。
static void BM_NormalFallbackWithRunning(benchmark::State& state) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <Fallback>
          <AlwaysRunning/>
          <AlwaysSuccess/>
          <AlwaysSuccess/>
        </Fallback>
      </BehaviorTree>
    </root>
  )");

  for (auto _ : state) {
    tree.tickOnce();
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_NormalFallbackWithRunning);

/// ReactiveFallback：第一个子节点 RUNNING → 每拍仍重评估（对本用例无影响，因为第一个就 RUNNING）。
static void BM_ReactiveFallbackWithRunning(benchmark::State& state) {
  auto factory = buildFactory();
  auto tree = load(factory, R"(
    <root main_tree_to_execute="MainTree">
      <BehaviorTree ID="MainTree">
        <ReactiveFallback>
          <AlwaysRunning/>
          <AlwaysSuccess/>
          <AlwaysSuccess/>
        </ReactiveFallback>
      </BehaviorTree>
    </root>
  )");

  for (auto _ : state) {
    tree.tickOnce();
  }
  state.SetItemsProcessed(state.iterations());
}
BENCHMARK(BM_ReactiveFallbackWithRunning);

BENCHMARK_MAIN();
