// ============================================================================
//  bt_server/src/main.cpp
//  bt_server —— 基于 cpp-httplib 的行为树 HTTP 服务,供 Web 编辑器对接。
//
//  设计说明:
//    本进程持有一个全局 NodeFactory(注册了若干内置示例节点)和“当前树”状态。
//    通过 HTTP 暴露与前端约定的协议接口:
//      GET  /api/health        健康检查
//      GET  /api/nodes         枚举工厂里所有节点 manifest
//      POST /api/tree/load     用 XmlParser 解析 XML 构建当前树
//      GET  /api/tree/export   把当前树导出为 XML
//      POST /api/tree/tick     tick 一次当前树并返回各节点状态
//
//    并发说明:cpp-httplib 默认多线程处理请求,而“当前树”是共享可变状态,
//    因此所有访问当前树的处理函数都用一把全局互斥锁 g_tree_mutex 串行化,
//    避免数据竞争(load 重建树 / tick 改状态 / export 读结构之间互斥)。
//
//    JSON:不引入第三方 JSON 库,序列化用 json_util.hpp 的轻量拼装器(手动转义),
//    入参解析也用其中的极简提取器(请求体只有 {"xml":"..."} 一种结构)。
// ============================================================================

#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "bt_core/control_node.hpp"
#include "bt_core/decorator_node.hpp"
#include "bt_core/node_factory.hpp"
#include "bt_core/node_status.hpp"
#include "bt_core/tree.hpp"
#include "bt_core/tree_node.hpp"
#include "bt_core/xml_parser.hpp"

#include "demo_nodes.hpp"
#include "json_util.hpp"

// cpp-httplib(header-only),放在 third_party/。
#include "httplib.h"

namespace {

// ---- 全局服务状态 ---------------------------------------------------------

/// @brief 全局节点工厂(注册了内置示例节点)。生命周期 = 进程。
bt_core::NodeFactory g_factory;

/// @brief 当前加载的行为树(可能为空,表示尚未 load)。
std::unique_ptr<bt_core::Tree> g_tree;

/// @brief 保护 g_tree 的互斥锁(httplib 多线程并发处理请求)。
std::mutex g_tree_mutex;

/// @brief 服务版本号。
constexpr const char* kServerVersion = "0.1.0";

// ---- JSON 组装:节点 manifest ---------------------------------------------

/**
 * @brief 把单个 PortInfo 序列化为 JSON 对象字符串。
 * 形如:{"name":"message","direction":"input","type_name":"...",
 *        "default_value":"hello","description":"..."}
 */
std::string portToJson(const bt_core::PortInfo& p) {
  using namespace bt_server;
  std::string out = "{";
  out += jsonKV("name", p.name) + ",";
  out += jsonKV("direction", bt_core::toStr(p.direction)) + ",";
  out += jsonKV("type_name", p.type_name) + ",";
  out += jsonKV("default_value", p.default_value) + ",";
  out += jsonKV("description", p.description) + ",";
  // enum_values: 字符串数组,空表示该端口为自由文本;非空时编辑器渲染下拉框。
  out += jsonString("enum_values") + ":[";
  for (size_t i = 0; i < p.enum_values.size(); ++i) {
    if (i) out += ",";
    out += jsonString(p.enum_values[i]);
  }
  out += "]";
  out += "}";
  return out;
}

/**
 * @brief 把单个 NodeManifest 序列化为 JSON 对象字符串。
 * 形如:{"registration_name":"SaySomething","type":"Action",
 *        "ports":[{...},{...}]}
 */
std::string manifestToJson(const bt_core::NodeManifest& m) {
  using namespace bt_server;
  std::string out = "{";
  out += jsonKV("registration_name", m.registration_name) + ",";
  out += jsonKV("type", bt_core::toStr(m.type)) + ",";
  out += jsonString("ports") + ":[";
  bool first = true;
  for (const auto& [name, info] : m.ports) {
    if (!first) out += ",";
    out += portToJson(info);
    first = false;
  }
  out += "]}";
  return out;
}

// ---- 各接口处理函数 -------------------------------------------------------

/// @brief GET /api/health → {"ok":true,"version":"..."}
void handleHealth(const httplib::Request&, httplib::Response& res) {
  using namespace bt_server;
  std::string body = "{";
  body += jsonKVBool("ok", true) + ",";
  body += jsonKV("version", kServerVersion);
  body += "}";
  res.set_content(body, "application/json");
}

/// @brief GET /api/nodes → 节点 manifest 数组。
void handleNodes(const httplib::Request&, httplib::Response& res) {
  const auto manifests = g_factory.manifests();
  std::string body = "[";
  bool first = true;
  for (const auto& m : manifests) {
    if (!first) body += ",";
    body += manifestToJson(m);
    first = false;
  }
  body += "]";
  res.set_content(body, "application/json");
}

/// @brief POST /api/tree/load,body={"xml":"..."}
///        成功 → {"ok":true,"node_count":N};失败 → {"ok":false,"error":"..."}
void handleTreeLoad(const httplib::Request& req, httplib::Response& res) {
  using namespace bt_server;

  // 1. 从请求体提取 xml 字段
  auto xml = jsonExtractString(req.body, "xml");
  if (!xml) {
    std::string body = "{";
    body += jsonKVBool("ok", false) + ",";
    body += jsonKV("error", "请求体缺少 \"xml\" 字段或 JSON 格式错误");
    body += "}";
    res.status = 400;  // Bad Request
    res.set_content(body, "application/json");
    return;
  }

  // 2. 用 XmlParser 解析建树(可能抛 std::runtime_error)
  std::lock_guard<std::mutex> lock(g_tree_mutex);
  try {
    bt_core::XmlParser parser(g_factory);
    bt_core::Tree tree = parser.loadFromText(*xml);
    const size_t node_count = tree.nodes().size();
    // 用移动构造把新树设为当前树
    g_tree = std::make_unique<bt_core::Tree>(std::move(tree));

    std::string body = "{";
    body += jsonKVBool("ok", true) + ",";
    body += jsonKVNum("node_count", static_cast<long long>(node_count));
    body += "}";
    res.set_content(body, "application/json");
  } catch (const std::exception& e) {
    std::string body = "{";
    body += jsonKVBool("ok", false) + ",";
    body += jsonKV("error", e.what());
    body += "}";
    res.status = 400;  // 解析失败属于客户端输入错误
    res.set_content(body, "application/json");
  }
}

/// @brief GET /api/tree/export → {"xml":"..."}(未加载树时返回空 xml + 提示)。
void handleTreeExport(const httplib::Request&, httplib::Response& res) {
  using namespace bt_server;
  std::lock_guard<std::mutex> lock(g_tree_mutex);

  if (!g_tree || !g_tree->root()) {
    std::string body = "{";
    body += jsonKV("xml", "") + ",";
    body += jsonKV("error", "当前没有已加载的树");
    body += "}";
    res.status = 404;
    res.set_content(body, "application/json");
    return;
  }

  try {
    bt_core::XmlParser parser(g_factory);
    const std::string xml = parser.writeToText(*g_tree, "MainTree");
    std::string body = "{";
    body += jsonKV("xml", xml);
    body += "}";
    res.set_content(body, "application/json");
  } catch (const std::exception& e) {
    std::string body = "{";
    body += jsonKV("xml", "") + ",";
    body += jsonKV("error", e.what());
    body += "}";
    res.status = 500;
    res.set_content(body, "application/json");
  }
}

/// @brief POST /api/tree/tick → tick 一次,返回 {"status":"...","nodes":[{id,status}]}
void handleTreeTick(const httplib::Request&, httplib::Response& res) {
  using namespace bt_server;
  std::lock_guard<std::mutex> lock(g_tree_mutex);

  if (!g_tree || !g_tree->root()) {
    std::string body = "{";
    body += jsonKV("status", "IDLE") + ",";
    body += jsonString("nodes") + ":[]" + ",";
    body += jsonKV("error", "当前没有已加载的树");
    body += "}";
    res.status = 404;
    res.set_content(body, "application/json");
    return;
  }

  // tick 一拍,再遍历全部节点收集状态。
  const bt_core::NodeStatus root_status = g_tree->tickOnce();

  std::string body = "{";
  body += jsonKV("status", bt_core::toStr(root_status)) + ",";
  body += jsonString("nodes") + ":[";
  bool first = true;
  for (const auto& node : g_tree->nodes()) {
    if (!first) body += ",";
    std::string item = "{";
    // 原有字段:id + status(顺序与格式保持不变,向后兼容)
    item += jsonKVNum("id", static_cast<long long>(node->id())) + ",";
    item += jsonKV("status", bt_core::toStr(node->status())) + ",";
    // 新增字段:注册名(节点类型名,如 "Sequence")与实例名(XML 里的 name 属性),
    // 方便前端在高亮时直接展示节点类型与可读名称,无需再查 /api/tree/structure。
    item += jsonKV("registration_name", node->registrationName()) + ",";
    item += jsonKV("name", node->name());
    item += "}";
    body += item;
    first = false;
  }
  body += "]}";
  res.set_content(body, "application/json");
}

/**
 * @brief POST /api/tree/run —— 用 tickWhileRunning 跑完整棵树,
 *        并通过 Tree::setStatusCallback 收集**每一次节点状态变化的完整序列**。
 *
 * 返回:{"final_status":"...","transitions":[{node_id,from,to,seq},...]}
 *   - final_status: tickWhileRunning 的终结状态(SUCCESS/FAILURE,或异常时 RUNNING)
 *   - transitions : 按发生先后排列的状态变化序列,seq 从 0 递增。
 *
 * 这样前端可以“回放”整棵树本次执行过程中所有节点的状态翻转,
 * 而不只是拿到最终快照(/api/tree/tick 给的是单拍后的状态)。
 *
 * 实现要点:
 *   1. 运行前先 halt() 复位整棵树,保证每次 /run 都是从干净的 IDLE 起点开始,
 *      transitions 序列可复现(否则上一轮残留状态会影响 from)。
 *   2. setStatusCallback 注册的回调捕获了下面的局部 vector;tickWhileRunning
 *      返回后**必须立刻把回调清空**(setStatusCallback(nullptr)),否则后续
 *      /api/tree/tick 触发状态变化时会调用已经悬空的局部变量 → 未定义行为。
 *   3. 全程持锁,与 load/tick/export 互斥。
 */
void handleTreeRun(const httplib::Request&, httplib::Response& res) {
  using namespace bt_server;
  std::lock_guard<std::mutex> lock(g_tree_mutex);

  if (!g_tree || !g_tree->root()) {
    std::string body = "{";
    body += jsonKV("final_status", "IDLE") + ",";
    body += jsonString("transitions") + ":[]" + ",";
    body += jsonKV("error", "当前没有已加载的树");
    body += "}";
    res.status = 404;
    res.set_content(body, "application/json");
    return;
  }

  // 单条状态变化记录。
  struct Transition {
    uint16_t node_id;
    bt_core::NodeStatus from;
    bt_core::NodeStatus to;
  };
  std::vector<Transition> transitions;
  transitions.reserve(64);

  // 1. 复位,保证从干净起点开始(halt 自身也可能产生 IDLE 变化,
  //    但此时回调尚未注册,不会被记录,正合预期)。
  g_tree->halt();

  // 2. 注册回调收集每一次状态变化。
  g_tree->setStatusCallback(
      [&transitions](uint16_t id, bt_core::NodeStatus prev,
                     bt_core::NodeStatus next) {
        transitions.push_back(Transition{id, prev, next});
      });

  // 3. 跑完整棵树。用 try/catch 兜底:即便节点逻辑抛异常,
  //    也要先解绑回调再向上传播,避免悬空回调。
  bt_core::NodeStatus final_status = bt_core::NodeStatus::IDLE;
  try {
    final_status = g_tree->tickWhileRunning();
  } catch (...) {
    g_tree->setStatusCallback(nullptr);  // 关键:解绑捕获局部变量的回调
    throw;
  }

  // 4. 解绑回调(局部 transitions 即将离开作用域)。
  g_tree->setStatusCallback(nullptr);

  // 5. 序列化。
  std::string body = "{";
  body += jsonKV("final_status", bt_core::toStr(final_status)) + ",";
  body += jsonString("transitions") + ":[";
  long long seq = 0;
  bool first = true;
  for (const auto& t : transitions) {
    if (!first) body += ",";
    std::string item = "{";
    item += jsonKVNum("node_id", static_cast<long long>(t.node_id)) + ",";
    item += jsonKV("from", bt_core::toStr(t.from)) + ",";
    item += jsonKV("to", bt_core::toStr(t.to)) + ",";
    item += jsonKVNum("seq", seq++);
    item += "}";
    body += item;
    first = false;
  }
  body += "]}";
  res.set_content(body, "application/json");
}

/**
 * @brief GET /api/tree/structure —— 返回当前树的结构 JSON,供前端校验/展示。
 *
 * 返回:{"nodes":[{id,registration_name,name,type,children:[id,...]},...]}
 *   - 节点列表按 Tree::nodes() 的遍历顺序(即 id 递增)输出。
 *   - children 是“直接子节点”的 id 数组:
 *       控制节点 → 其全部 children();装饰节点 → 唯一 child();叶子 → 空数组。
 *   - type 取 toStr(node->type()) → "Control"/"Decorator"/"Action"/"Condition"。
 *
 * 仅读结构,不改状态;但仍持锁,避免与 load(重建树)并发。
 */
void handleTreeStructure(const httplib::Request&, httplib::Response& res) {
  using namespace bt_server;
  std::lock_guard<std::mutex> lock(g_tree_mutex);

  if (!g_tree || !g_tree->root()) {
    std::string body = "{";
    body += jsonString("nodes") + ":[]" + ",";
    body += jsonKV("error", "当前没有已加载的树");
    body += "}";
    res.status = 404;
    res.set_content(body, "application/json");
    return;
  }

  std::string body = "{";
  body += jsonString("nodes") + ":[";
  bool first = true;
  for (const auto& node : g_tree->nodes()) {
    if (!first) body += ",";
    std::string item = "{";
    item += jsonKVNum("id", static_cast<long long>(node->id())) + ",";
    item += jsonKV("registration_name", node->registrationName()) + ",";
    item += jsonKV("name", node->name()) + ",";
    item += jsonKV("type", bt_core::toStr(node->type())) + ",";

    // 收集直接子节点 id:区分控制节点(N 个)与装饰节点(1 个)。
    item += jsonString("children") + ":[";
    bool child_first = true;
    if (auto* ctrl = dynamic_cast<bt_core::ControlNode*>(node.get())) {
      for (const auto& child : ctrl->children()) {
        if (!child_first) item += ",";
        item += std::to_string(static_cast<long long>(child->id()));
        child_first = false;
      }
    } else if (auto* deco = dynamic_cast<bt_core::DecoratorNode*>(node.get())) {
      if (deco->child()) {
        item += std::to_string(static_cast<long long>(deco->child()->id()));
      }
    }
    item += "]";

    item += "}";
    body += item;
    first = false;
  }
  body += "]}";
  res.set_content(body, "application/json");
}

}  // namespace

// ============================================================================
//  入口
// ============================================================================
int main(int argc, char** argv) {
  // 监听地址/端口:默认 127.0.0.1:8080,可用命令行参数覆盖(host port)。
  std::string host = "127.0.0.1";
  int port = 8080;
  if (argc >= 2) host = argv[1];
  if (argc >= 3) port = std::atoi(argv[2]);

  // 1. 节点来源二选一：
  //    - 若命令行提供了插件路径(argc>3)，加载这些外部插件(如 bt_nodes)；
  //    - 否则注册自带的内置示例节点作为后备，保证 server 开箱可用。
  //    这样可避免「内置节点 + 外部插件」因同名(如 Sequence)而重复注册冲突。
  const bool has_plugins = (argc > 3);
  if (has_plugins) {
    for (int i = 3; i < argc; ++i) {
      try {
        g_factory.loadPlugin(argv[i]);
        std::cout << "[bt_server] 已加载插件: " << argv[i] << std::endl;
      } catch (const std::exception& e) {
        std::cerr << "[bt_server] 插件加载失败 " << argv[i] << ": " << e.what()
                  << std::endl;
      }
    }
  } else {
    bt_server::registerDemoNodes(g_factory);
    std::cout << "[bt_server] 未指定插件，已注册内置示例节点" << std::endl;
  }

  std::cout << "[bt_server] 已注册节点数: " << g_factory.size() << std::endl;

  // 2. 配置路由。
  httplib::Server svr;

  // 简单的 CORS 头(Web 编辑器跨域访问需要),以及统一 JSON 字符集。
  svr.set_post_routing_handler(
      [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
      });

  // 预检请求(浏览器跨域 POST 前会发 OPTIONS)。
  svr.Options(R"(/.*)", [](const httplib::Request&, httplib::Response& res) {
    res.status = 204;  // No Content
  });

  svr.Get("/api/health", handleHealth);
  svr.Get("/api/nodes", handleNodes);
  svr.Post("/api/tree/load", handleTreeLoad);
  svr.Get("/api/tree/export", handleTreeExport);
  svr.Post("/api/tree/tick", handleTreeTick);
  // 新增接口:整树运行态序列回放 + 结构查询。
  svr.Post("/api/tree/run", handleTreeRun);
  svr.Get("/api/tree/structure", handleTreeStructure);

  // 异常兜底:任何处理函数抛出未捕获异常时返回 500。
  svr.set_exception_handler(
      [](const httplib::Request&, httplib::Response& res, std::exception_ptr ep) {
        std::string msg = "内部错误";
        try {
          if (ep) std::rethrow_exception(ep);
        } catch (const std::exception& e) {
          msg = e.what();
        } catch (...) {
        }
        std::string body = "{";
        body += bt_server::jsonKVBool("ok", false) + ",";
        body += bt_server::jsonKV("error", msg);
        body += "}";
        res.status = 500;
        res.set_content(body, "application/json");
      });

  std::cout << "[bt_server] 监听 http://" << host << ":" << port << std::endl;
  std::cout << "[bt_server] 接口: /api/health /api/nodes /api/tree/load "
               "/api/tree/export /api/tree/tick /api/tree/run "
               "/api/tree/structure"
            << std::endl;

  // 3. 启动(阻塞)。失败返回非 0。
  if (!svr.listen(host.c_str(), port)) {
    std::cerr << "[bt_server] 启动失败,无法监听 " << host << ":" << port
              << std::endl;
    return 1;
  }
  return 0;
}
