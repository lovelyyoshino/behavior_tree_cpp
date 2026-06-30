// ============================================================================
//  bt_core/plugin_loader.hpp
//  PluginLoader —— 跨平台动态库插件加载器。
//
//  设计说明：
//    负责在运行时加载节点插件(.so/.dll/.dylib)，查找约定入口符号
//    BT_RegisterNodes 并调用它，把插件里的节点注册进给定的 NodeFactory。
//    封装了 POSIX(dlopen) 与 Windows(LoadLibrary) 的差异。
//
//    句柄生命周期：PluginLoader 持有所有已加载库的句柄，析构时统一卸载。
//    注意：卸载库后，该库注册的节点的构造器将失效，因此 PluginLoader 通常
//    应与 NodeFactory 生命周期一致或更长。
// ============================================================================
#ifndef BT_CORE_PLUGIN_LOADER_HPP
#define BT_CORE_PLUGIN_LOADER_HPP

#include <memory>
#include <string>
#include <vector>

#include "bt_core/node_factory.hpp"

namespace bt_core {

/**
 * @brief 加载一个插件库并把其中的节点注册进 factory。
 * @param library_path 动态库文件路径(.so/.dll/.dylib)。
 * @param factory 目标工厂。
 * @return 一个持有原生库句柄的 shared_ptr<void>，其自定义删除器会在引用计数
 *         归零时卸载库。**调用方必须保证该句柄的存活时间不短于 factory**，
 *         否则 factory 内引用插件代码的构造器在析构时会访问已卸载内存。
 *         推荐用法是 NodeFactory::loadPlugin()，它自动维护正确的析构顺序。
 * @throws std::runtime_error 加载失败 / 找不到入口符号。
 */
std::shared_ptr<void> loadPluginLibrary(const std::string& library_path,
                                        NodeFactory& factory);

/**
 * @brief 动态库插件加载器(显式持有句柄的便捷封装)。
 *
 * @warning 生命周期约束：PluginLoader 必须比使用其所注册节点的 NodeFactory
 *          以及任何相关 Tree **更晚析构**。若不确定析构顺序，请改用
 *          NodeFactory::loadPlugin()，它把句柄存进工厂内部并保证安全顺序。
 */
class PluginLoader {
public:
  PluginLoader() = default;

  // 句柄用 shared_ptr 管理，可安全拷贝/移动。
  /**
   * @brief 加载一个插件库并把其中的节点注册进 factory。
   * @throws std::runtime_error 加载失败 / 找不到入口符号。
   */
  void load(const std::string& library_path, NodeFactory& factory) {
    handles_.push_back(loadPluginLibrary(library_path, factory));
  }

  /// @brief 已成功加载的库数量。
  size_t loadedCount() const { return handles_.size(); }

  /**
   * @brief 给定基础名，拼出当前平台的动态库文件名。
   * @details 例如 "my_nodes" -> Linux:"libmy_nodes.so" / macOS:"libmy_nodes.dylib"
   *          / Windows:"my_nodes.dll"。便于跨平台书写加载代码。
   */
  static std::string platformLibraryName(const std::string& base_name);

private:
  std::vector<std::shared_ptr<void>> handles_;  ///< 原生库句柄(带卸载删除器)
};

}  // namespace bt_core

#endif  // BT_CORE_PLUGIN_LOADER_HPP
