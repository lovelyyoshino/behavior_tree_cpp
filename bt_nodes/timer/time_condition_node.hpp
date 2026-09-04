// ============================================================================
//  bt_nodes/timer/time_condition_node.hpp
//  TimeConditionNode —— 通用时间门控：本地时刻处于某区间或按固定间隔放行。
//
//  语义（作为通用核心节点，不再绑定任何机器人）：
//  - mode="range"：每天在 start_time ~ end_time 区间内返回 SUCCESS，否则 FAILURE。
//  - mode="interval"：自首拍起每 interval_sec 秒放行一次，其余时间 FAILURE；
//      由父级 KeepRunningUntilFailure / ReactiveSequence 包装即可实现"周期触发"。
//  - 时间源 std::chrono::system_clock（本地时区，可直接用 "HH:MM:SS" 配置）。
//
//  与 Yuyi 专属 TimeCondition 的差异：本节点去掉了机器人调度耦合，只保留纯时间语义，
//    Yuyi 的 start_time/end_time/mode/interval_sec 端口名保持兼容，可直接复用。
//
//  端口：
//  - start_time (string, 输入) 每日起始时刻，格式 "HH:MM:SS"，默认 "00:00:00"。
//  - end_time   (string, 输入) 每日结束时刻，格式 "HH:MM:SS"，默认 "23:59:59"。
//  - mode       (string, 输入) "range" 或 "interval"，默认 "range"。
//  - interval_sec (double, 输入) interval 模式下放行间隔(秒)，默认 1800。
//
//  @code{.xml}
//   <TimeCondition start_time="06:30:00" end_time="03:00:00" mode="interval" interval_sec="1800.0"/>
//  @endcode
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增通用时间门控节点
// ============================================================================
#ifndef BT_NODES_TIMER_TIME_CONDITION_NODE_HPP
#define BT_NODES_TIMER_TIME_CONDITION_NODE_HPP

#include <chrono>
#include <ctime>
#include <string>

#include "bt_core/leaf_node.hpp"

namespace bt_nodes {

class TimeConditionNode : public bt_core::ConditionNode {
 public:
  using bt_core::ConditionNode::ConditionNode;

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>("start_time", "00:00:00",
                                        "每日起始时刻，格式 HH:MM:SS"),
        bt_core::InputPort<std::string>("end_time", "23:59:59",
                                        "每日结束时刻，格式 HH:MM:SS"),
        bt_core::InputPort<std::string>(
            "mode", "range", "range=每日区间；interval=按固定间隔放行",
            {"range", "interval"}),
        bt_core::InputPort<double>("interval_sec", "1800.0",
                                   "interval 模式下放行间隔(秒)"));
  }

  bt_core::NodeStatus tick() override {
    const auto mode = getInput<std::string>("mode").value_or("range");
    if (mode == "interval") {
      return tickInterval();
    }
    return tickRange();
  }

 private:
  // 解析 "HH:MM:SS" 为当日秒数；非法输入按 0 处理并回退到范围外。
  long parseHmsToSec(const std::string& hms) const {
    int h = 0, m = 0, s = 0;
    const int n = std::sscanf(hms.c_str(), "%d:%d:%d", &h, &m, &s);
    if (n < 2) return 0;
    return h * 3600L + m * 60L + s;
  }

  long currentSecOfDay() const {
    const auto now = std::chrono::system_clock::now();
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
    localtime_r(&t, &tm);
    return tm.tm_hour * 3600L + tm.tm_min * 60L + tm.tm_sec;
  }

  // 每日区间：支持跨午夜（end < start 表示延续到次日）。
  bt_core::NodeStatus tickRange() {
    const long start = parseHmsToSec(getInput<std::string>("start_time").value_or("00:00:00"));
    const long end = parseHmsToSec(getInput<std::string>("end_time").value_or("23:59:59"));
    const long now = currentSecOfDay();

    bool in_range;
    if (end < start) {                       // 跨午夜区间
      in_range = (now >= start) || (now < end);
    } else {
      in_range = (now >= start) && (now < end);
    }

    // 记录本实例是否处于"放行态"，供日志/调试参考；条件本身瞬时判断。
    return in_range ? bt_core::NodeStatus::SUCCESS
                    : bt_core::NodeStatus::FAILURE;
  }

  // 固定间隔放行：自首拍起计时，每 interval_sec 秒放行一次。
  bt_core::NodeStatus tickInterval() {
    const double interval = getInput<double>("interval_sec").value_or(1800.0);
    const auto now = std::chrono::steady_clock::now();

    if (!started_) {
      started_ = true;
      last_fire_ = now;
      // 首拍立即放行一次（可用于"开树即调度"）。
      return interval <= 0.0 ? bt_core::NodeStatus::FAILURE
                             : bt_core::NodeStatus::SUCCESS;
    }

    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - last_fire_).count();
    if (elapsed >= static_cast<long long>(interval * 1000.0)) {
      last_fire_ = now;
      return bt_core::NodeStatus::SUCCESS;
    }
    return bt_core::NodeStatus::FAILURE;
  }

  bool started_{false};                                    ///< interval 首拍标记
  std::chrono::steady_clock::time_point last_fire_{};      ///< 上次放行时刻
};

}  // namespace bt_nodes

#endif  // BT_NODES_TIMER_TIME_CONDITION_NODE_HPP
