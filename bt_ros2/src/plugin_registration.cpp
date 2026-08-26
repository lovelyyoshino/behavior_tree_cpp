// ============================================================================
//  bt_ros2/src/plugin_registration.cpp
//  bt_ros2 适配器节点的插件入口 —— 把 bt_ros2 库暴露给 bt_server 的 PluginLoader。
//
//  背景：
//    bt_ros2 把适配器节点编成 bt_ros2_lib（静态库），本身不导出 BT_RegisterNodes，
//    因此 bt_server 的 `--plugin` 无法直接加载它。本文件提供一个共享库入口，
//    让 NodeFactory.loadPlugin() 能 dlsym 到 BT_RegisterNodes 并完成自注册。
//
//  设计要点（与 bt_core/plugin_register.hpp 对齐）：
//    - 导出 C 链接符号 BT_RegisterNodes(bt_core::NodeFactory&)。
//    - 复用 NodeRegistrationCatalog 的默认注册组（registerBtNodes + ROS topic/
//      data + recharge）；registerIfMissing 会跳过 bt_nodes 已注册的同名节点，
//      因此与 libbt_nodes.so 同时加载不会重复注册。
//
//  依赖：
//    编译时链接 libbt_ros2_lib.a（含 registerRosTopicNodes 等定义）和 bt::core。
//
//  @author pony
//  @date 2026-08-24
//  @version v1.0.0
//  @last_modified 2026-08-24
//  @changelog
//    - v1.0.0 (2026-08-24): 新增 bt_ros2 插件入口，供 bt_server --plugin 加载
// ============================================================================
#include "bt_core/plugin_register.hpp"

#include "bt_ros2/node_registration.hpp"

// libbt_nodes.so 尚未加载时由本入口补齐 ROS2 侧的默认注册；已加载时由
// registerIfMissing 去重。无需在此单独处理 bt_nodes 的 27 个内置节点。
BT_REGISTER_NODES(factory) {
  bt_ros2::registerDefaultNodes(factory);
}
