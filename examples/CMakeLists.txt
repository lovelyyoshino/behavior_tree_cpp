# ============================================================================
#  examples —— 示例程序
# ============================================================================

# 示例 1：纯嵌入式用法(仅依赖 bt::core)
add_executable(example_embedded 01_embedded_tree.cpp)
target_link_libraries(example_embedded PRIVATE bt::core)

# 示例 2：从 XML 加载 + 运行时插件
add_executable(example_load_xml 02_load_from_xml.cpp)
target_link_libraries(example_load_xml PRIVATE bt::core)

# 示例 3：单例 + 工厂 + 生成器引用函数 三模式的完整回充演示
#   直接 include header-only 的 bt_nodes（Sequence/Fallback/CompareBlackboard/
#   FunctionRegistry），include base 指向 bt_nodes 目录以解析相对包含；不依赖
#   ROS2，用普通结构体模拟外部 sensor_msgs/BatteryState 数据源，本机可跑可验。
add_executable(example_function_recharge 03_function_registry_recharge.cpp)
target_include_directories(example_function_recharge
  PRIVATE
    ${CMAKE_SOURCE_DIR}/bt_nodes
)
target_link_libraries(example_function_recharge PRIVATE bt::core)

message(STATUS "[BT-X] examples 已配置")
