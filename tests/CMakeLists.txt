# ============================================================================
#  tests —— 单元测试(GoogleTest via FetchContent)
# ============================================================================
include(FetchContent)

# 拉取 GoogleTest。优先用本地缓存；离线时可改为 find_package。
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.15.2
)
# Windows: 强制使用共享 CRT，避免链接冲突
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# bt_core 单元测试
add_executable(test_bt_core test_bt_core.cpp)
target_link_libraries(test_bt_core
  PRIVATE
    bt::core
    GTest::gtest_main
)

# bt_core 进阶单元测试(异步 RUNNING / halt / 端口语义 / XML round-trip / 错误路径 / 类型转换)
add_executable(test_bt_advanced test_bt_advanced.cpp)
target_link_libraries(test_bt_advanced
  PRIVATE
    bt::core
    GTest::gtest_main
)

# 数据层单元测试(data_freshness 纯逻辑 + 6 个 header-only 数据节点)
# data_freshness.hpp 与 bt_nodes/data/*.hpp 均为 header-only：
#   - 只需 include bt_ros2/include(取 data_freshness) 与 bt_nodes(取 data/* 节点头);
#     节点头内部用 "data/xxx.hpp" 相对包含，故 include base 指向 bt_nodes 目录。
#   - 不需要 link bt_ros2 库(那个依赖 ROS2)，只 link bt::core 即可。
add_executable(test_data_nodes test_data_nodes.cpp)
target_include_directories(test_data_nodes
  PRIVATE
    ${CMAKE_SOURCE_DIR}/bt_ros2/include
    ${CMAKE_SOURCE_DIR}/bt_nodes
)
target_link_libraries(test_data_nodes
  PRIVATE
    bt::core
    GTest::gtest_main
)

include(GoogleTest)
gtest_discover_tests(test_bt_core)
gtest_discover_tests(test_bt_advanced)
gtest_discover_tests(test_data_nodes)
