// ============================================================================
//  bt_nodes/function/function_registry.hpp
//  FunctionRegistry + FunctionAction/FunctionCondition —— 把常用业务函数以
//  单例注册表 + 工厂节点的形式暴露给 XML 行为树。
//
//  设计目标：
//    - 高频业务逻辑可以先写成普通 C++ 函数/lambda，再注册到单例表。
//    - 行为树 XML 只引用函数名，不直接绑定实现类，便于复用和替换。
//    - 节点仍走 NodeFactory 创建，保留插件化/manifest/端口能力。
// ============================================================================
#ifndef BT_NODES_FUNCTION_FUNCTION_REGISTRY_HPP
#define BT_NODES_FUNCTION_FUNCTION_REGISTRY_HPP

#include <functional>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "bt_core/blackboard.hpp"
#include "bt_core/leaf_node.hpp"
#include "bt_core/node_status.hpp"
#include "bt_core/tree_node.hpp"

namespace bt_nodes {

/**
 * @brief 被函数回调接收的运行期上下文。
 *
 * input/output_key 是 FunctionAction/FunctionCondition 的通用端口，业务函数
 * 可选择使用；复杂数据建议直接通过 blackboard 读写。
 */
struct FunctionContext {
  std::string node_name;
  bt_core::Blackboard::Ptr blackboard;
  bt_core::NodeConfig config;
  std::optional<std::string> input;
  std::string output_key;
};

using ActionFunction = std::function<bt_core::NodeStatus(const FunctionContext&)>;
using ConditionFunction = std::function<bool(const FunctionContext&)>;

/**
 * @brief 业务函数单例注册表。
 *
 * 线程安全边界：注册/查询内部加锁；invoke/evaluate 会先复制回调再释放锁，
 * 避免回调里再次注册或访问注册表造成死锁。
 */
class FunctionRegistry {
 public:
  static FunctionRegistry& instance() {
    static FunctionRegistry registry;
    return registry;
  }

  FunctionRegistry(const FunctionRegistry&) = delete;
  FunctionRegistry& operator=(const FunctionRegistry&) = delete;

  void registerAction(std::string name, ActionFunction fn) {
    if (name.empty()) {
      throw std::invalid_argument("FunctionRegistry: action name is empty");
    }
    if (!fn) {
      throw std::invalid_argument("FunctionRegistry: action callback is empty");
    }
    std::lock_guard<std::mutex> lock(mutex_);
    actions_[std::move(name)] = std::move(fn);
  }

  void registerCondition(std::string name, ConditionFunction fn) {
    if (name.empty()) {
      throw std::invalid_argument("FunctionRegistry: condition name is empty");
    }
    if (!fn) {
      throw std::invalid_argument(
          "FunctionRegistry: condition callback is empty");
    }
    std::lock_guard<std::mutex> lock(mutex_);
    conditions_[std::move(name)] = std::move(fn);
  }

  bool hasAction(const std::string& name) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return actions_.count(name) != 0;
  }

  bool hasCondition(const std::string& name) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return conditions_.count(name) != 0;
  }

  bt_core::NodeStatus invokeAction(const std::string& name,
                                   const FunctionContext& ctx) const {
    ActionFunction fn;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      auto it = actions_.find(name);
      if (it == actions_.end()) {
        return bt_core::NodeStatus::FAILURE;
      }
      fn = it->second;
    }
    return fn(ctx);
  }

  bool evaluateCondition(const std::string& name,
                         const FunctionContext& ctx) const {
    ConditionFunction fn;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      auto it = conditions_.find(name);
      if (it == conditions_.end()) {
        return false;
      }
      fn = it->second;
    }
    return fn(ctx);
  }

  std::vector<std::string> actionNames() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> names;
    names.reserve(actions_.size());
    for (const auto& item : actions_) names.push_back(item.first);
    return names;
  }

  std::vector<std::string> conditionNames() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> names;
    names.reserve(conditions_.size());
    for (const auto& item : conditions_) names.push_back(item.first);
    return names;
  }

  /// @brief 测试/示例重置入口。生产代码通常不需要调用。
  void clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    actions_.clear();
    conditions_.clear();
  }

 private:
  FunctionRegistry() = default;

  mutable std::mutex mutex_;
  std::unordered_map<std::string, ActionFunction> actions_;
  std::unordered_map<std::string, ConditionFunction> conditions_;
};

inline FunctionContext makeFunctionContext(
    const bt_core::TreeNode& node,
    std::optional<std::string> input,
    std::string output_key) {
  return FunctionContext{node.name(), node.blackboard(), node.config(),
                         std::move(input), std::move(output_key)};
}

/**
 * @brief 调用已注册 ActionFunction 的动作节点。
 *
 * 端口：
 *  - function   : 注册到 FunctionRegistry 的函数名。
 *  - input      : 可选字符串输入，业务函数也可直接从黑板读复杂数据。
 *  - output_key : 可选输出 key，业务函数可按需写入 ctx.blackboard。
 */
class FunctionActionNode : public bt_core::ActionNode {
 public:
  using bt_core::ActionNode::ActionNode;

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>("function", "",
                                        "FunctionRegistry 中的动作函数名"),
        bt_core::InputPort<std::string>("input", "",
                                        "传给函数的可选字符串输入"),
        bt_core::InputPort<std::string>("output_key", "",
                                        "函数可写入的可选黑板 key"));
  }

  bt_core::NodeStatus tick() override {
    const std::string fn = getInput<std::string>("function").value_or("");
    if (fn.empty()) return bt_core::NodeStatus::FAILURE;

    const auto input = getInput<std::string>("input");
    const std::string output_key =
        getInput<std::string>("output_key").value_or("");
    const FunctionContext ctx = makeFunctionContext(*this, input, output_key);
    return FunctionRegistry::instance().invokeAction(fn, ctx);
  }
};

/**
 * @brief 调用已注册 ConditionFunction 的条件节点。
 */
class FunctionConditionNode : public bt_core::ConditionNode {
 public:
  using bt_core::ConditionNode::ConditionNode;

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>("function", "",
                                        "FunctionRegistry 中的条件函数名"),
        bt_core::InputPort<std::string>("input", "",
                                        "传给函数的可选字符串输入"),
        bt_core::InputPort<std::string>("output_key", "",
                                        "函数可写入的可选黑板 key"));
  }

  bt_core::NodeStatus tick() override {
    const std::string fn = getInput<std::string>("function").value_or("");
    if (fn.empty()) return bt_core::NodeStatus::FAILURE;

    const auto input = getInput<std::string>("input");
    const std::string output_key =
        getInput<std::string>("output_key").value_or("");
    const FunctionContext ctx = makeFunctionContext(*this, input, output_key);
    return FunctionRegistry::instance().evaluateCondition(fn, ctx)
               ? bt_core::NodeStatus::SUCCESS
               : bt_core::NodeStatus::FAILURE;
  }
};

}  // namespace bt_nodes

#endif  // BT_NODES_FUNCTION_FUNCTION_REGISTRY_HPP
