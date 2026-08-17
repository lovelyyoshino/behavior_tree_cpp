// ============================================================================
//  bt_ros2/src/bt_executor_node.cpp
//  BtExecutorNode 的实现。
//
//  @author lovelyyoshino
//  @date 2026-06-30
//  @version v1.1.0
//  @last_modified 2026-07-13
//  @changelog
//    - v1.1.0 (2026-07-13): 实现幂等服务控制与终态树显式复位
// ============================================================================
#include "bt_ros2/bt_executor_node.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <unordered_map>

#include "bt_ros2/node_registration.hpp"
#include "bt_ros2/ros_blackboard_keys.hpp"

#include "bt_core/blackboard.hpp"
#include "bt_core/xml_parser.hpp"

using namespace std::chrono_literals;

namespace bt_ros2 {
namespace {

std::int64_t steadyTimeMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

void appendJsonString(std::ostringstream& output, std::string_view value) {
  output << '"';
  for (const unsigned char ch : value) {
    switch (ch) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (ch < 0x20U) {
          output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                 << static_cast<unsigned>(ch) << std::dec << std::setfill(' ');
        } else {
          output << static_cast<char>(ch);
        }
    }
  }
  output << '"';
}

std::string treeRevision(const std::string& tree_file) {
  constexpr std::uint64_t kFnvOffset = 14695981039346656037ULL;
  constexpr std::uint64_t kFnvPrime = 1099511628211ULL;
  std::ifstream input(tree_file, std::ios::binary);
  if (!input) throw std::runtime_error("无法读取行为树 revision: " + tree_file);

  std::uint64_t value = kFnvOffset;
  const auto update = [&value](unsigned char byte) {
    value ^= byte;
    value *= kFnvPrime;
  };
  const std::string filename = std::filesystem::path(tree_file).filename().string();
  for (const unsigned char byte : filename) update(byte);
  update(0);
  char byte = 0;
  while (input.get(byte)) update(static_cast<unsigned char>(byte));
  update(0);

  std::ostringstream output;
  output << "fnv1a64:" << std::hex << std::setw(16) << std::setfill('0') << value;
  return output.str();
}

std::string trim(std::string value) {
  const auto first = value.find_first_not_of(" \t\r\n");
  if (first == std::string::npos) return {};
  const auto last = value.find_last_not_of(" \t\r\n");
  return value.substr(first, last - first + 1);
}

bt_core::NodeStatus debugStatus(const std::string& value) {
  if (value == "SUCCESS") return bt_core::NodeStatus::SUCCESS;
  if (value == "FAILURE") return bt_core::NodeStatus::FAILURE;
  throw std::invalid_argument("debug override must be SUCCESS or FAILURE");
}

std::uint16_t debugNodeId(const std::string& key) {
  constexpr std::string_view prefix = "node/";
  if (key.substr(0, prefix.size()) != prefix || key.size() == prefix.size()) {
    throw std::invalid_argument("debug override key must look like node/<id>");
  }
  const auto raw = key.substr(prefix.size());
  std::size_t consumed = 0;
  const auto parsed = std::stoul(raw, &consumed);
  if (consumed != raw.size() || parsed == 0 || parsed > 65535) {
    throw std::invalid_argument("debug override node id is invalid: " + key);
  }
  return static_cast<std::uint16_t>(parsed);
}

}  // namespace

BtExecutorNode::BtExecutorNode(const rclcpp::NodeOptions& options)
    : rclcpp::Node("bt_executor", options),
      blackboard_(bt_core::Blackboard::create()) {
  declareAndLoadParameters();
  registerNodeTypes();

  // 根状态发布器：把每拍的根节点状态(IDLE/RUNNING/SUCCESS/FAILURE)发出去，
  // 便于外部节点/工具监控行为树整体进展。
  status_pub_ = create_publisher<std_msgs::msg::String>(status_topic_, 10);
  snapshot_pub_ = create_publisher<std_msgs::msg::String>(
      snapshot_topic_, rclcpp::QoS(1).reliable().transient_local());
  service_event_pub_ = create_publisher<std_msgs::msg::String>(
      service_event_topic_, rclcpp::QoS(64).reliable().transient_local());
  if (debug_mode_) {
    debug_state_pub_ = create_publisher<std_msgs::msg::String>(
        debug_state_topic_, rclcpp::QoS(1).reliable().transient_local());
    debug_override_sub_ = create_subscription<std_msgs::msg::String>(
        debug_override_topic_, rclcpp::QoS(10).reliable(),
        [this](const std_msgs::msg::String& message) { handleDebugOverrides(message); });
  }

  loadTree();
  publishTreeSnapshot(bt_core::NodeStatus::IDLE);
  publishDebugState();

  start_service_ = create_service<Trigger>(
      "~/start",
      std::bind(&BtExecutorNode::handleStart, this,
                std::placeholders::_1, std::placeholders::_2));
  stop_service_ = create_service<Trigger>(
      "~/stop",
      std::bind(&BtExecutorNode::handleStop, this,
                std::placeholders::_1, std::placeholders::_2));

  if (debug_mode_) {
    pause_service_ = create_service<Trigger>(
        "~/pause", std::bind(&BtExecutorNode::handlePause, this,
                              std::placeholders::_1, std::placeholders::_2));
    resume_service_ = create_service<Trigger>(
        "~/resume", std::bind(&BtExecutorNode::handleResume, this,
                               std::placeholders::_1, std::placeholders::_2));
    step_service_ = create_service<Trigger>(
        "~/step", std::bind(&BtExecutorNode::handleStep, this,
                            std::placeholders::_1, std::placeholders::_2));
    reload_service_ = create_service<Trigger>(
        "~/reload", std::bind(&BtExecutorNode::handleReload, this,
                              std::placeholders::_1, std::placeholders::_2));
    RCLCPP_WARN(get_logger(), "debug_mode=true：已启用 pause/resume/step/reload 控制面。");
  }

  if (autostart_) {
    start();
  } else {
    RCLCPP_INFO(get_logger(), "autostart=false，等待外部调用 start() 后开始 tick。");
  }
}

void BtExecutorNode::declareAndLoadParameters() {
  // declare_parameter 给出默认值；运行时可被 launch / yaml / 命令行覆盖。
  tree_file_     = declare_parameter<std::string>("tree_file", "");
  tick_rate_hz_  = declare_parameter<double>("tick_rate_hz", 10.0);
  status_topic_  = declare_parameter<std::string>("status_topic", "~/bt_status");
  snapshot_topic_ = declare_parameter<std::string>("snapshot_topic", "~/tree_snapshot");
  service_event_topic_ =
      declare_parameter<std::string>("service_event_topic", "~/service_event");
  autostart_     = declare_parameter<bool>("autostart", true);
  stop_on_terminal_ = declare_parameter<bool>("stop_on_terminal", false);
  debug_mode_ = declare_parameter<bool>("debug_mode", false);
  debug_state_topic_ = declare_parameter<std::string>("debug_state_topic", "~/debug_state");
  debug_override_topic_ =
      declare_parameter<std::string>("debug_override_topic", "~/debug_overrides");

  if (tree_file_.empty()) {
    throw std::runtime_error(
        "参数 'tree_file' 未设置：请通过 launch 或 --ros-args -p tree_file:=<路径> 指定行为树 XML。");
  }
  if (tick_rate_hz_ <= 0.0) {
    throw std::runtime_error("参数 'tick_rate_hz' 必须为正数。");
  }

  RCLCPP_INFO(get_logger(),
              "参数: tree_file=%s tick_rate_hz=%.2f status_topic=%s snapshot_topic=%s service_event_topic=%s autostart=%s stop_on_terminal=%s",
              tree_file_.c_str(), tick_rate_hz_, status_topic_.c_str(),
              snapshot_topic_.c_str(), service_event_topic_.c_str(),
              autostart_ ? "true" : "false",
              stop_on_terminal_ ? "true" : "false");
}

void BtExecutorNode::registerNodeTypes() {
  // 单例注册目录 + 注册函数引用列表，集中注册 bt_nodes / ROS topic / 数据录入 / 回充节点。
  registerDefaultNodes(factory_);

  RCLCPP_INFO(get_logger(), "已注册 %zu 种节点类型。", factory_.size());
}

void BtExecutorNode::loadTree() {
  // 关键步骤：先把本 ROS 节点的裸指针注入黑板，适配器节点 tick 时才能桥接 ROS。
  // 顺序很重要——必须在 XmlParser 建树/节点 tick 之前完成。
  setRosNodeHandle(blackboard_, this);

  bt_core::XmlParser parser(factory_);
  // loadFromFile 复用我们注入了 ROS 句柄的同一个黑板（务必传入，否则适配器取不到句柄）。
  bt_core::Tree tree = parser.loadFromFile(tree_file_, blackboard_);
  tree_ = std::make_unique<bt_core::Tree>(std::move(tree));
  tree_revision_ = treeRevision(tree_file_);
  tree_id_ = tree_->treeId().empty() ? std::filesystem::path(tree_file_).stem().string()
                                     : tree_->treeId();
  session_id_ = "bt-executor-" + std::to_string(steadyTimeMs()) + "-" +
                std::to_string(++session_sequence_);
  debug_overrides_.clear();
  debug_scenario_id_ = "all_auto";

  RCLCPP_INFO(get_logger(), "已从 %s 加载行为树，共 %zu 个节点。",
              tree_file_.c_str(), tree_->nodes().size());
}

void BtExecutorNode::start() {
  if (timer_) {
    return;  // 已在运行。
  }
  // 周期 = 1 / 频率，转成纳秒交给 wall timer。
  const auto period = std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::duration<double>(1.0 / tick_rate_hz_));
  timer_ = create_wall_timer(period, std::bind(&BtExecutorNode::onTick, this));
  publishDebugState();
  RCLCPP_INFO(get_logger(), "开始 tick，频率 %.2f Hz。", tick_rate_hz_);
}

void BtExecutorNode::stop() {
  if (timer_) {
    timer_->cancel();
    timer_.reset();
  }
  if (tree_) {
    tree_->halt();  // 复位正在 RUNNING 的子树，释放异步资源。
  }
  if (debug_mode_) {
    publishDebugState();
  }
  RCLCPP_INFO(get_logger(), "已停止 tick 并 halt 行为树。");
}

void BtExecutorNode::onTick() {
  if (!tree_) {
    return;
  }
  // 执行一拍；BtExecutorNode 由 ROS executor 单线程驱动，tick 之间不阻塞。
  const bt_core::NodeStatus status = tree_->tickOnce();
  publishTreeSnapshot(status);
  publishDebugState();

  // 发布根状态，供外部监控。
  std_msgs::msg::String msg;
  msg.data = bt_core::toStr(status);
  status_pub_->publish(msg);

  // ROS2 topic 驱动的树通常要持续 tick：首拍无消息可能是 FAILURE，但不能因此停掉。
  // 若用户要“一轮跑完即停”的 demo 行为，可通过 stop_on_terminal=true 开启。
  if (stop_on_terminal_ && bt_core::isStatusCompleted(status)) {
    RCLCPP_INFO(get_logger(), "行为树到达终结状态: %s，停止 tick。",
                msg.data.c_str());
    if (timer_) {
      timer_->cancel();
      timer_.reset();
    }
    publishDebugState();
  }
}

void BtExecutorNode::publishTreeSnapshot(bt_core::NodeStatus root_status) {
  if (!tree_ || !snapshot_pub_) return;
  ++snapshot_sequence_;

  std::ostringstream output;
  output << "{\"schema\":\"bt_ros2.bt_snapshot.v1\",\"session_id\":";
  appendJsonString(output, session_id_);
  output << ",\"tree_revision\":";
  appendJsonString(output, tree_revision_);
  output << ",\"seq\":" << snapshot_sequence_
         << ",\"steady_time_ms\":" << steadyTimeMs() << ",\"tree_id\":";
  appendJsonString(output, tree_id_);
  output << ",\"root_status\":";
  appendJsonString(output, bt_core::toStr(root_status));
  output << ",\"nodes\":[";
  bool first = true;
  for (const auto& node : tree_->nodes()) {
    if (!first) output << ',';
    first = false;
    output << "{\"key\":\"node/" << node->id() << "\",\"id\":" << node->id()
           << ",\"instance_name\":";
    appendJsonString(output, node->name());
    output << ",\"registration_name\":";
    appendJsonString(output, node->registrationName());
    output << ",\"kind\":";
    appendJsonString(output, bt_core::toStr(node->type()));
    output << ",\"status\":";
    appendJsonString(output, bt_core::toStr(node->status()));
    output << ",\"override\":";
    appendJsonString(
        output,
        node->forcedStatus() ? bt_core::toStr(*node->forcedStatus()) : "AUTO");
    output << '}';
  }
  output << "]}";

  std_msgs::msg::String message;
  message.data = output.str();
  snapshot_pub_->publish(message);
}

void BtExecutorNode::publishServiceEvent(const std::string& interface_name,
                                         const std::string& call_id,
                                         const std::string& phase,
                                         bool success,
                                         const std::string& message,
                                         std::int64_t duration_ms) {
  if (!service_event_pub_) return;
  std::ostringstream output;
  output << "{\"schema\":\"bt_ros2.service_event.v1\",\"event_seq\":"
         << ++service_event_sequence_ << ",\"call_id\":";
  appendJsonString(output, call_id);
  output << ",\"tick_seq\":" << snapshot_sequence_
         << ",\"steady_time_ms\":" << steadyTimeMs() << ",\"session_id\":";
  appendJsonString(output, session_id_);
  output << ",\"tree_revision\":";
  appendJsonString(output, tree_revision_);
  output << ",\"kind\":\"service\",\"interface\":";
  appendJsonString(output, interface_name);
  output << ",\"phase\":";
  appendJsonString(output, phase);
  output << ",\"request\":{},\"result\":{\"success\":"
         << (success ? "true" : "false") << ",\"message\":";
  appendJsonString(output, message);
  output << "},\"message\":";
  appendJsonString(output, message);
  output << ",\"duration_ms\":" << duration_ms << '}';

  std_msgs::msg::String event;
  event.data = output.str();
  service_event_pub_->publish(event);
}

void BtExecutorNode::handleStart(
    const std::shared_ptr<Trigger::Request>,
    std::shared_ptr<Trigger::Response> response) {
  const auto started_at = std::chrono::steady_clock::now();
  const std::string interface_name = std::string(get_fully_qualified_name()) + "/start";
  const std::string call_id = "start-" + std::to_string(++service_call_sequence_);
  publishServiceEvent(interface_name, call_id, "started", true, "", 0);
  const bool was_running = static_cast<bool>(timer_);
  start();
  response->success = true;
  response->message = was_running ? "already running" : "started";
  const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - started_at).count();
  publishServiceEvent(interface_name, call_id, "completed", response->success,
                      response->message, duration);
}

void BtExecutorNode::handleStop(
    const std::shared_ptr<Trigger::Request>,
    std::shared_ptr<Trigger::Response> response) {
  const auto started_at = std::chrono::steady_clock::now();
  const std::string interface_name = std::string(get_fully_qualified_name()) + "/stop";
  const std::string call_id = "stop-" + std::to_string(++service_call_sequence_);
  publishServiceEvent(interface_name, call_id, "started", true, "", 0);
  const bool was_running = static_cast<bool>(timer_);
  stop();
  publishTreeSnapshot(bt_core::NodeStatus::IDLE);
  response->success = true;
  response->message = was_running ? "stopped" : "already stopped";
  const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - started_at).count();
  publishServiceEvent(interface_name, call_id, "completed", response->success,
                      response->message, duration);
}

void BtExecutorNode::publishDebugState() {
  if (!debug_mode_ || !debug_state_pub_ || !tree_) return;

  std::ostringstream output;
  output << "{\"schema\":\"bt_ros2.debug_state.v1\",\"session_id\":";
  appendJsonString(output, session_id_);
  output << ",\"tree_revision\":";
  appendJsonString(output, tree_revision_);
  output << ",\"scenario_id\":";
  appendJsonString(output, debug_scenario_id_);
  output << ",\"mode\":";
  appendJsonString(output, timer_ ? "running" : "paused");
  output << ",\"paused\":" << (timer_ ? "false" : "true")
         << ",\"tick_seq\":" << snapshot_sequence_
         << ",\"condition_node_keys\":[";

  bool first = true;
  for (const auto& node : tree_->nodes()) {
    if (node->type() != bt_core::NodeType::CONDITION) continue;
    if (!first) output << ',';
    first = false;
    appendJsonString(output, "node/" + std::to_string(node->id()));
  }
  output << "],\"overrides\":{";
  first = true;
  for (const auto& node : tree_->nodes()) {
    const auto forced = node->forcedStatus();
    if (!forced) continue;
    if (!first) output << ',';
    first = false;
    appendJsonString(output, "node/" + std::to_string(node->id()));
    output << ':';
    appendJsonString(output, bt_core::toStr(*forced));
  }
  output << "}}";

  std_msgs::msg::String state;
  state.data = output.str();
  debug_state_pub_->publish(state);
}

void BtExecutorNode::publishDebugServiceEvent(const std::string& action,
                                              const std::string& call_id,
                                              const std::string& phase,
                                              bool success,
                                              const std::string& message,
                                              std::int64_t duration_ms) {
  publishServiceEvent(std::string(get_fully_qualified_name()) + "/" + action,
                      call_id, phase, success, message, duration_ms);
}

void BtExecutorNode::handlePause(
    const std::shared_ptr<Trigger::Request>,
    std::shared_ptr<Trigger::Response> response) {
  const auto started_at = std::chrono::steady_clock::now();
  const std::string call_id = "pause-" + std::to_string(++service_call_sequence_);
  publishDebugServiceEvent("pause", call_id, "started", true, "", 0);
  const bool was_running = static_cast<bool>(timer_);
  if (timer_) {
    timer_->cancel();
    timer_.reset();
  }
  response->success = true;
  response->message = was_running ? "paused" : "already paused";
  publishDebugState();
  const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - started_at).count();
  publishDebugServiceEvent("pause", call_id, "completed", true,
                           response->message, duration);
}

void BtExecutorNode::handleResume(
    const std::shared_ptr<Trigger::Request>,
    std::shared_ptr<Trigger::Response> response) {
  const auto started_at = std::chrono::steady_clock::now();
  const std::string call_id = "resume-" + std::to_string(++service_call_sequence_);
  publishDebugServiceEvent("resume", call_id, "started", true, "", 0);
  const bool was_running = static_cast<bool>(timer_);
  start();
  response->success = true;
  response->message = was_running ? "already running" : "resumed";
  const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - started_at).count();
  publishDebugServiceEvent("resume", call_id, "completed", true,
                           response->message, duration);
}

void BtExecutorNode::handleStep(
    const std::shared_ptr<Trigger::Request>,
    std::shared_ptr<Trigger::Response> response) {
  const auto started_at = std::chrono::steady_clock::now();
  const std::string call_id = "step-" + std::to_string(++service_call_sequence_);
  publishDebugServiceEvent("step", call_id, "started", true, "", 0);
  if (timer_) {
    response->success = false;
    response->message = "pause the sandbox before stepping";
  } else {
    onTick();
    publishDebugState();
    response->success = true;
    response->message = "stepped once";
  }
  const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - started_at).count();
  publishDebugServiceEvent("step", call_id, "completed", response->success,
                           response->message, duration);
}

void BtExecutorNode::handleReload(
    const std::shared_ptr<Trigger::Request>,
    std::shared_ptr<Trigger::Response> response) {
  const auto started_at = std::chrono::steady_clock::now();
  const std::string call_id = "reload-" + std::to_string(++service_call_sequence_);
  publishDebugServiceEvent("reload", call_id, "started", true, "", 0);
  if (timer_) {
    timer_->cancel();
    timer_.reset();
  }
  if (tree_) tree_->halt();

  const auto previous_blackboard = blackboard_;
  try {
    blackboard_ = bt_core::Blackboard::create();
    loadTree();
    snapshot_sequence_ = 0;
    publishTreeSnapshot(bt_core::NodeStatus::IDLE);
    publishDebugState();
    response->success = true;
    response->message = "reloaded and paused";
  } catch (const std::exception& error) {
    blackboard_ = previous_blackboard;
    response->success = false;
    response->message = error.what();
    publishDebugState();
  }
  const auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - started_at).count();
  publishDebugServiceEvent("reload", call_id, "completed", response->success,
                           response->message, duration);
}

void BtExecutorNode::handleDebugOverrides(const std_msgs::msg::String& message) {
  if (!debug_mode_ || !tree_) return;
  try {
    const auto separator = message.data.find('|');
    if (separator == std::string::npos) {
      throw std::invalid_argument("debug override command is missing scenario separator");
    }
    const std::string scenario_id = trim(message.data.substr(0, separator));
    if (scenario_id.empty()) {
      throw std::invalid_argument("debug scenario_id must not be empty");
    }

    std::unordered_map<std::uint16_t, bt_core::NodeStatus> overrides;
    std::string assignments = trim(message.data.substr(separator + 1));
    std::size_t offset = 0;
    while (offset < assignments.size()) {
      const auto comma = assignments.find(',', offset);
      const std::string item = trim(assignments.substr(
          offset, comma == std::string::npos ? std::string::npos : comma - offset));
      const auto equals = item.find('=');
      if (equals == std::string::npos) {
        throw std::invalid_argument("debug override assignment must contain '='");
      }
      const auto node_id = debugNodeId(trim(item.substr(0, equals)));
      if (!overrides.emplace(node_id, debugStatus(trim(item.substr(equals + 1)))).second) {
        throw std::invalid_argument("duplicate debug override node");
      }
      if (comma == std::string::npos) break;
      offset = comma + 1;
    }

    tree_->setConditionOverrides(overrides);
    debug_overrides_ = std::move(overrides);
    debug_scenario_id_ = scenario_id;
    const auto root_status = tree_->root() ? tree_->root()->status()
                                           : bt_core::NodeStatus::IDLE;
    publishTreeSnapshot(root_status);
    publishDebugState();
    RCLCPP_INFO(get_logger(), "已应用 debug 场景 '%s'，覆盖 %zu 个条件节点。",
                debug_scenario_id_.c_str(), debug_overrides_.size());
  } catch (const std::exception& error) {
    RCLCPP_ERROR(get_logger(), "拒绝 debug override: %s", error.what());
    publishDebugState();
  }
}

}  // namespace bt_ros2
