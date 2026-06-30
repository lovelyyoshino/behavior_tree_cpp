// ============================================================================
//  bt_core/src/plugin_loader.cpp
//  插件加载的平台相关实现。
//    - POSIX(Linux/macOS): dlopen / dlsym / dlclose
//    - Windows           : LoadLibrary / GetProcAddress / FreeLibrary
//
//  生命周期要点：
//    加载返回的句柄用 shared_ptr<void> + 自定义删除器管理。删除器在引用计数
//    归零时才卸载库。NodeFactory::loadPlugin() 会把句柄存进工厂(且作为首个
//    成员，最后析构)，确保 builders_/manifests_ 析构时库仍处于已映射状态，
//    根除“卸载后访问插件代码”导致的段错误。
// ============================================================================
#include "bt_core/plugin_loader.hpp"

#include <stdexcept>

#include "bt_core/plugin_register.hpp"

#if defined(_WIN32)
  #include <windows.h>
#else
  #include <dlfcn.h>
#endif

namespace bt_core {

// ----------------------------- 平台封装 ------------------------------------
namespace {

void* openLibrary(const std::string& path, std::string& err) {
#if defined(_WIN32)
  void* h = reinterpret_cast<void*>(LoadLibraryA(path.c_str()));
  if (!h) err = "LoadLibrary 失败, code=" + std::to_string(GetLastError());
  return h;
#else
  void* h = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!h) {
    const char* e = dlerror();
    err = e ? e : "dlopen 未知错误";
  }
  return h;
#endif
}

void* findSymbol(void* handle, const char* symbol) {
#if defined(_WIN32)
  return reinterpret_cast<void*>(
      GetProcAddress(reinterpret_cast<HMODULE>(handle), symbol));
#else
  return dlsym(handle, symbol);
#endif
}

void closeLibrary(void* handle) {
  if (!handle) return;
#if defined(_WIN32)
  FreeLibrary(reinterpret_cast<HMODULE>(handle));
#else
  dlclose(handle);
#endif
}

}  // namespace

// ------------------------------- 加载 --------------------------------------

std::shared_ptr<void> loadPluginLibrary(const std::string& library_path,
                                        NodeFactory& factory) {
  std::string err;
  void* handle = openLibrary(library_path, err);
  if (!handle) {
    throw std::runtime_error("加载插件失败 '" + library_path + "': " + err);
  }

  // 查找约定入口符号 BT_RegisterNodes
  void* sym = findSymbol(handle, BT_PLUGIN_ENTRY_SYMBOL);
  if (!sym) {
    closeLibrary(handle);
    throw std::runtime_error("插件 '" + library_path + "' 缺少入口符号 " +
                             BT_PLUGIN_ENTRY_SYMBOL);
  }

  // 调用入口，完成注册
  auto register_fn = reinterpret_cast<PluginRegisterFn>(sym);
  register_fn(factory);

  // 用自定义删除器封装句柄：引用计数归零时卸载库。
  return std::shared_ptr<void>(handle, [](void* h) { closeLibrary(h); });
}

// ----------------- NodeFactory::loadPlugin（安全析构顺序入口） ----------------

void NodeFactory::loadPlugin(const std::string& library_path) {
  // 注册节点 + 取得库句柄，再交给工厂自身持有(plugin_handles_ 最后析构)。
  auto handle = loadPluginLibrary(library_path, *this);
  retainPluginHandle(std::move(handle));
}

// --------------------------- 跨平台文件名 ----------------------------------

std::string PluginLoader::platformLibraryName(const std::string& base_name) {
#if defined(_WIN32)
  return base_name + ".dll";
#elif defined(__APPLE__)
  return "lib" + base_name + ".dylib";
#else
  return "lib" + base_name + ".so";
#endif
}

}  // namespace bt_core
