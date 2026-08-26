/**
 * call_service_nodes.hpp - Common std_srvs Trigger and SetBool BT actions.
 *
 * @author pony
 * @date 2026-08-19
 * @version v1.0.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.0.0 (2026-08-19): add Yuyi-compatible typed service actions
 */
#ifndef BT_ROS2_CALL_SERVICE_NODES_HPP
#define BT_ROS2_CALL_SERVICE_NODES_HPP

#include <string>

#include "bt_ros2/ros_service_action_node.hpp"
#include "std_srvs/srv/set_bool.hpp"
#include "std_srvs/srv/trigger.hpp"

namespace bt_ros2 {

class CallTriggerServiceNode
    : public RosServiceActionNode<std_srvs::srv::Trigger> {
public:
  using RosServiceActionNode::RosServiceActionNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "异步调用 std_srvs/srv/Trigger，适合升降、复位和启动等无请求字段命令。",
        "service_name 可从实时 ROS2 service 候选选择；message 建议绑定到 {response_key} 供日志或分支读取。等待期间不会阻塞行为树 tick。",
        "等待服务或响应时返回 RUNNING；response.success=true 返回 SUCCESS，否则返回 FAILURE；message 始终写入输出端口。",
        "service 不可用、请求异常或 timeout_sec 超时返回 FAILURE；timeout_sec<=0 表示不设超时，halt 会清理未完成请求。",
        R"(<CallTriggerService service_name="/sweeper/up/lower" timeout_sec="2.0" message="{lower_response}"/>)"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::withEditorHint(
            bt_core::InputPort<std::string>(
                "service_name", "", "std_srvs/srv/Trigger service 完整名称"),
            "ros_service"),
        bt_core::InputPort<double>(
            "timeout_sec", "2.0", "等待 service 可用和响应的总超时；<=0 不超时"),
        bt_core::OutputPort<std::string>(
            "message", "response.message 或本地传输失败原因"));
  }

protected:
  SharedRequest makeRequest() override;
  bt_core::NodeStatus handleResponse(const SharedResponse& response) override;
  void onTransportFailure(const std::string& message) override;
};

class CallSetBoolServiceNode
    : public RosServiceActionNode<std_srvs::srv::SetBool> {
public:
  using RosServiceActionNode::RosServiceActionNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "异步调用 std_srvs/srv/SetBool，适合启停电机、开关传感器或切换运行模式。",
        "service_name 从实时 service 候选选择或手填，data 是目标布尔值；message 建议绑定黑板供失败记录。",
        "等待服务或响应时返回 RUNNING；response.success=true 返回 SUCCESS，否则返回 FAILURE；不会阻塞其它并行分支。",
        "service 不可用、请求异常或 timeout_sec 超时返回 FAILURE；父节点抢占时会清理未完成请求。",
        R"(<CallSetBoolService service_name="/sweeper/up/enable" data="true" timeout_sec="2.0" message="{enable_response}"/>)"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::withEditorHint(
            bt_core::InputPort<std::string>(
                "service_name", "", "std_srvs/srv/SetBool service 完整名称"),
            "ros_service"),
        bt_core::InputPort<bool>("data", "false", "发送给 service 的布尔请求值"),
        bt_core::InputPort<double>(
            "timeout_sec", "2.0", "等待 service 可用和响应的总超时；<=0 不超时"),
        bt_core::OutputPort<std::string>(
            "message", "response.message 或本地传输失败原因"));
  }

protected:
  SharedRequest makeRequest() override;
  bt_core::NodeStatus handleResponse(const SharedResponse& response) override;
  void onTransportFailure(const std::string& message) override;
};

}  // namespace bt_ros2

#endif  // BT_ROS2_CALL_SERVICE_NODES_HPP
