# ============================================================================
#  bt_nodes —— 内置标准节点插件（动态库）
#  说明：
#    把所有内置节点（控制/装饰/动作）编译成一个 SHARED 动态库 bt_nodes，
#    通过 BT_REGISTER_NODES 入口自注册。运行时由 NodeFactory::loadPlugin()
#    动态加载。节点本身以头文件提供，唯一编译单元是 register_nodes.cpp。
# ============================================================================

add_library(bt_nodes SHARED
  register_nodes.cpp
)

# link 核心库（命名空间别名）；bt_core 已 PUBLIC 暴露 include/ 目录。
target_link_libraries(bt_nodes PRIVATE bt::core)

# 头文件搜索路径：
#  - 当前目录：让 register_nodes.cpp 用 "control/xxx.hpp" 这样的相对路径 include。
#  - third_party：契约要求 include third_party（与核心库保持一致的依赖可见性）。
target_include_directories(bt_nodes PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_SOURCE_DIR}/third_party
)

target_compile_features(bt_nodes PRIVATE cxx_std_17)

# 干净编译：开启常用告警。
target_compile_options(bt_nodes PRIVATE
  $<$<OR:$<CXX_COMPILER_ID:Clang>,$<CXX_COMPILER_ID:AppleClang>,$<CXX_COMPILER_ID:GNU>>:-Wall -Wextra>
)

# 插件入口符号 BT_RegisterNodes 用 visibility("default") 显式导出；
# 其余符号默认隐藏，避免与主程序/其它插件符号冲突。
set_target_properties(bt_nodes PROPERTIES
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN ON
)

message(STATUS "[BT-X] bt_nodes 内置节点插件已配置")
