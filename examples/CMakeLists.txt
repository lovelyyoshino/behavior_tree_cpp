# ============================================================================
#  examples —— 示例程序
# ============================================================================

# 示例 1：纯嵌入式用法(仅依赖 bt::core)
add_executable(example_embedded 01_embedded_tree.cpp)
target_link_libraries(example_embedded PRIVATE bt::core)

# 示例 2：从 XML 加载 + 运行时插件
add_executable(example_load_xml 02_load_from_xml.cpp)
target_link_libraries(example_load_xml PRIVATE bt::core)

message(STATUS "[BT-X] examples 已配置")
