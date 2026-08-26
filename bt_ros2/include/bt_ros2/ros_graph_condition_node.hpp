/**
 * ros_graph_condition_node.hpp - Generic ROS graph availability condition.
 *
 * @author pony
 * @date 2026-08-19
 * @version v1.0.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.0.0 (2026-08-19): add runtime node/topic/service/action existence checks
 */
#ifndef BT_ROS2_ROS_GRAPH_CONDITION_NODE_HPP
#define BT_ROS2_ROS_GRAPH_CONDITION_NODE_HPP

#include <string>

#include "bt_core/leaf_node.hpp"

namespace bt_ros2 {

class RosGraphConditionNode : public bt_core::ConditionNode {
public:
  using bt_core::ConditionNode::ConditionNode;

  static bt_core::NodeDocumentation providedDocumentation() {
    return {
        "检查一个 ROS2 node、topic、service 或 action 当前是否存在于 ROS graph。",
        "先选 entity_type，再从实时能力候选中选择 entity_name；需要判断资源不存在时用 Inverter 包装。graph 存在只表示接口已发现，不代表业务健康。",
        "指定资源当前存在返回 SUCCESS，不存在或类型/名称为空返回 FAILURE；每拍重新查询，不缓存旧 graph。",
        "DDS 发现有传播延迟；节点进程存在也可能已失去业务响应。关键健康判断应使用带新鲜度窗口的心跳 topic。",
        R"(<RosGraphCondition name="planner_online" entity_type="node" entity_name="/planner"/>)"};
  }

  static bt_core::PortsList providedPorts() {
    return bt_core::makePorts(
        bt_core::InputPort<std::string>(
            "entity_type", "node", "要检查的 ROS graph 资源类型",
            {"node", "topic", "service", "action"}),
        bt_core::withEditorHint(
            bt_core::InputPort<std::string>(
                "entity_name", "", "资源的完整 ROS 名称；支持实时候选和手填"),
            "ros_graph_entity"));
  }

  bt_core::NodeStatus tick() override;
};

}  // namespace bt_ros2

#endif  // BT_ROS2_ROS_GRAPH_CONDITION_NODE_HPP
