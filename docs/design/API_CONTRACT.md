# bt_core API 契约（已验证，fan-out agent 必读）

> 本文件是 bt_core 已编译验证通过的真实 API。下游模块(bt_nodes/bt_server/bt_ros2/examples)
> 必须严格基于这些签名实现，不要臆造。本文中的所有路径都相对项目根。

## 头文件一览（bt_core/include/bt_core/）
- `node_status.hpp` — `NodeStatus{IDLE,RUNNING,SUCCESS,FAILURE}`、`NodeType{CONTROL,DECORATOR,ACTION,CONDITION}`、`isStatusCompleted()`、`toStr()`
- `blackboard.hpp` — `Blackboard`（`set<T>/get<T>/contains/remove`）、`PortInfo`、`PortsList`、`InputPort<T>/OutputPort<T>/makePorts(...)`、`withEditorHint(...)`
- `tree_node.hpp` — `TreeNode` 基类、`NodeConfig{blackboard, port_remap, port_values}`、`StatusChangeCallback`
- `leaf_node.hpp` — `ActionNode`（可返回 RUNNING，有 `onHalted()`）、`ConditionNode`（只 SUCCESS/FAILURE）
- `control_node.hpp` — `ControlNode`（`addChild/children/childrenCount/haltChildren`）
- `decorator_node.hpp` — `DecoratorNode`（`setChild/child`）
- `node_factory.hpp` — `NodeFactory`、`NodeManifest{registration_name,type,ports,documentation}`
- `plugin_register.hpp` — `BT_REGISTER_NODES(factory)` 宏、`BT_PLUGIN_ENTRY_SYMBOL`
- `plugin_loader.hpp` — `PluginLoader`、`loadPluginLibrary()`
- `xml_parser.hpp` — `XmlParser`
- `tree.hpp` — `Tree`

## 写一个自定义节点（Action）
```cpp
#include "bt_core/leaf_node.hpp"
#include "bt_core/plugin_register.hpp"
using namespace bt_core;

class MyAction : public ActionNode {
 public:
  using ActionNode::ActionNode;                 // 继承构造 (std::string, NodeConfig)
  static PortsList providedPorts() {            // XML 可配置端口必须在这里声明
    return makePorts(InputPort<std::string>("msg", "默认值", "说明"));
  }
  NodeStatus tick() override {
    auto v = getInput<std::string>("msg").value_or("x");  // 通过端口读黑板
    setOutput<int>("result", 1);                          // 通过端口写黑板
    return NodeStatus::SUCCESS;
  }
};

BT_REGISTER_NODES(factory) {                    // 插件入口（编译成动态库）
  factory.registerNodeType<MyAction>("MyAction");
}
```

### 节点级说明与运行时 ROS 能力

端口描述解决“这个属性是什么”，节点级 ``providedDocumentation()`` 解决“这个节点
应该怎么放、何时返回什么状态、为什么会失败”。它只影响 manifest 和编辑器帮助，不参与
运行期 tick；旧插件不实现时仍保持兼容。

```cpp
static bt_core::NodeDocumentation providedDocumentation() {
  return {
      "向 ROS2 topic 发布一次通知",
      "topic 填目标话题，message 可用 {event_text} 读取黑板",
      "publish 完成返回 SUCCESS，不等待下游确认",
      "ROS 句柄不可用或 topic 无效返回 FAILURE",
      R"(<MyAction topic="/bt/events" message="hello"/>)"};
}
```

ROS2 执行器发布 ``bt_ros2.capabilities.v1``，其中的 ``ros_nodes``、``topics``、``services``
和从标准 ``send_goal`` service 推导的 ``actions`` 来自 ``rclcpp`` 当前 graph，manifest 来自
实际 ``NodeFactory``。只读 Web 适配器通过 ``GET /api/v1/bt/capabilities`` 暴露最新快照；
编辑器可以用 ``ros_topic``、``ros_service``、``ros_action``、``ros_node`` 和
``ros_graph_entity`` hint 提供候选值，但能力不存在或 graph 变化时仍必须允许手工输入。这样示例名称不会
 被绑定进前端代码，也不会把发现过期的 ROS 图当成可执行事实。

响应外层用 ``available`` 区分“网关在线但尚未收到执行器快照”与真实快照；没有快照时
``capabilities`` 为 ``null``，而不是伪造空的 ``topics``：

```json
{"available":true,"capabilities":{"schema":"bt_ros2.capabilities.v1","seq":12,
  "executor_node":"/bt_executor","ros_nodes":["/planner"],
  "topics":[{"name":"/planner/healthy","types":["std_msgs/msg/Bool"]}],
  "services":[{"name":"/planner/reset","types":["std_srvs/srv/Trigger"]}],
  "actions":[{"name":"/navigate_to_pose","types":["nav2_msgs/action/NavigateToPose"]}],
  "manifests":[]}}
```

普通 ``bt_server`` 不持有 ROS graph，但也在同一路径返回 HTTP 200：

```json
{"available":false,"capabilities":null}
```

这只是能力协商的降级响应；不能据此推断 ROS2 executor 在线，也不能生成 topic 候选。

## 关键 API 签名
```cpp
// 工厂
factory.registerNodeType<T>("RegName");          // T 继承 TreeNode；重复注册抛 logic_error
factory.createNode("RegName","instName",cfg);    // 未注册抛 runtime_error；返回 TreeNode::Ptr
factory.loadPlugin("/path/to/bt_plugin");        // 推荐！实际文件后缀随平台；工厂自持句柄
factory.manifests();                             // vector<NodeManifest>，供 /nodes 接口
factory.isRegistered("RegName"); factory.size();

// 控制/装饰节点构建
auto seq = std::dynamic_pointer_cast<ControlNode>(factory.createNode("Sequence","s",cfg));
seq->addChild(child);                            // 控制节点加子节点
deco->setChild(child);                           // 装饰节点设唯一子节点（重复抛 logic_error）

// 树
Tree tree(rootNode, blackboard);
tree.tickOnce();                                 // 执行一拍
tree.tickWhileRunning(1000000);                  // 循环到非 RUNNING；参数为最大迭代数
tree.halt();
tree.setStatusCallback([](uint16_t id, NodeStatus prev, NodeStatus next){...}); // 运行态推送
tree.nodes();                                    // vector<TreeNode::Ptr>，已分配 id
tree.visitNodes([](const TreeNode::Ptr&, int depth){...});  // DFS 遍历

// XML
XmlParser parser(factory);
Tree t = parser.loadFromText(xmlStr);            // 或 loadFromFile(path)
std::string xml = parser.writeToText(t, "MainTree");  // 或 writeToFile(t, path)
```

## XML 格式（BehaviorTree.CPP / Groot 基础结构兼容的严格子集）
```xml
<root main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <Sequence name="root">
      <MyAction msg="hello"/>          <!-- 字面量端口值 -->
      <MoveTo target="{goal}"/>        <!-- {k} = 重映射到黑板 key goal -->
    </Sequence>
  </BehaviorTree>
</root>
```
- 标签名 = 节点注册名（factory 据此实例化）
- `name` 属性 = 实例名（保留属性，非端口）
- 属性值 `"{k}"` → 端口重映射到黑板 key；否则字面量只存入当前节点的 `port_values`，不写共享黑板。
- 严格 XML 校验会拒绝 manifest 中未声明的属性；除保留的 `name` 外，XML 可配置属性必须由节点的 `providedPorts()` 声明。没有 XML 属性的节点仍可省略该函数。
- `PortInfo.editor_hint` 只告诉编辑器去哪里找动态候选（例如 `ros_topic`），不会改变端口解析；能力快照不可用时必须允许手工输入。
- `<SubTree ID="..."/>` 是无映射子树引用；两个结构节点都允许可选的 `name` 实例名。
  `<SubTreePlus ID="..." foo="{bar}"/>` 会把子树内部 `{foo}` 映射到父黑板 `bar`，映射值
  必须是完整的 `{blackboard_key}`；普通 `SubTree` 仍拒绝除此之外的属性，避免配置拼写错误
  被静默忽略。
- 编辑器允许先创建未在 manifest 中出现的自定义 XML 节点并添加任意属性；这只生成设计稿，
  严格载入前仍必须由运行时插件提供同名注册和 `providedPorts()`。
- 多个 `BehaviorTree` 定义必须提供唯一、非空 ID，并显式设置 `main_tree_to_execute`；每个定义都会校验，即使当前未被引用。
- 编辑器把每个 `BehaviorTree` 作为独立画布标签管理，导出时按文档顺序写回全部定义。服务端
  `format`/`export` 保留原始 `SubTree`/`SubTreePlus` 调用和目标定义；运行期仍使用展开后的节点执行。

## 构建集成
- 顶层 CMake 用 option 控制：`BT_BUILD_NODES/SERVER/ROS2/EXAMPLES/TESTS`
- 下游 target 用 `bt::core` link（已设别名）
- 插件库用 `add_library(foo SHARED ...)`，link `bt::core`

## 已验证事实（exit=0）
1. 基类层 tick/halt/回调正确
2. 工厂注册 + 按名建树 + 黑板数据流
3. 运行时动态库插件 load→register→tick，且**正常退出无段错误**（析构顺序已修）
4. XML 解析+建树+tick+round-trip+字面量保真
5. 当前测试数量以发布验证的 fresh ``ctest`` 输出为准，不在契约文档固化历史计数

## bt_server HTTP API（当前实现）

`bt_server/src/tree_api_service.*` 承载树状态、XML 处理和 workspace 文件访问；`main.cpp` 只负责路由绑定和进程启动。

| Endpoint | 语义 |
|---|---|
| `GET /api/health` | 健康检查 |
| `GET /api/nodes` | 节点 manifest |
| `POST /api/tree/load` | 解析 XML 并替换当前树 |
| `POST /api/tree/blackboard` | 给已加载树的内存黑板写入一个 typed 初值，并登记为可导出的启动参数 |
| `POST /api/tree/validate` | 只解析校验 XML，不替换当前树 |
| `POST /api/tree/format` | 只解析并格式化 XML，不替换当前树 |
| `GET /api/tree/export` | 导出当前树 XML |
| `POST /api/tree/tick` | tick 一拍 |
| `POST /api/tree/run` | 跑到终态并返回状态变化序列 |
| `GET /api/tree/structure` | 返回父子结构 |
| `GET /api/trees` | 列出 workspace 内 `.xml` 树文件 |
| `GET /api/tree/open?name=x.xml` | 打开 workspace 内树文件 |
| `POST /api/tree/save` | 保存 `{name, xml}` 到 workspace，保存前先解析校验 |

### 黑板初始化请求

```json
{"key":"temperature","type":"double","value":"25.5","description":"启动测试值"}
```

`type` 当前接受 `string`、`bool`、`int`、`double`。接口必须在 `load` 之后调用；空 key、
非法 bool/数字和未知类型返回 HTTP 400，未加载树返回 HTTP 404。写入的是当前
`Tree::blackboard()`，同时登记为 XML 可迁移的启动参数。`XmlParser` 使用兼容的
`<TreeNodesModel><Blackboard><Entry .../></Blackboard></TreeNodesModel>` 元数据区保存
`key/type/value/description`；`load`、`validate`、`format` 和 `export` 都会读取或保留该区。
普通 `set<T>()` 产生的运行时临时值不会自动变成启动配置。编辑器面板负责在 load/Run 前
按顺序发送请求并在浏览器 `localStorage` 保存尚未导出的草稿。

XML 载入到一个已存在的 ``Blackboard`` 时，``TreeNodesModel/Blackboard`` 是替换快照：
旧的 XML 初值会被移除，新的键和值会原子校验后写入；XML 没有该区时也会清除旧初值。
这不会清除由 ROS2 适配器注入的 node 句柄或其它非初值运行时对象。数值和布尔初值的
首尾空白会在边界处规范化，编辑器导出的 XML 与黑板 API 使用同一份规范化值。

这和端口语义是两件事：`key="mission_count"` 是节点要操作的键名，普通输入的
`value="{temperature}"` 才是黑板重映射；ROS2 输入节点在运行期间可继续覆盖同名值。
ROS-aware executor 如果需要远程初始化，应实现兼容的接口，而不是把 ROS topic 或键值写死
在通用编辑器中。

## ROS2 运行观察契约

`bt_ros2` 的执行器还提供一条与编辑器 HTTP API 解耦的只读观察链：

| Topic | Schema | 语义 |
|---|---|---|
| `~/tree_snapshot` | `bt_ros2.bt_snapshot.v1` | 每拍完整节点状态，包含 session、XML revision、序号和根状态 |
| `~/service_event` | `bt_ros2.service_event.v1` | `start/stop` service 的 `started`/`completed` 生命周期事件 |

`bt_web` 订阅两个 topic 并提供 `GET /api/v1/bt/structure`、
`GET /api/v1/bt/snapshots*` 和 `GET /api/v1/bt/service-events*`。结构与快照通过
`tree_revision` 绑定同一 XML；revision 不一致时拒绝显示，避免把状态染到错误的树上。
网页树支持节点级和全部折叠，折叠只影响呈现，不会改变行为树执行。

## 单树调度契约

- `PrioritySelector` 的子节点从前到后表示高到低优先级；它每拍从头重评，切换时必须
  `halt()` 被抢占的低优先级 `RUNNING` 分支。
- `TickRate(tier, every_n_ticks)` 只按父 tick 计数降低子树调用频率，不创建线程；
  `every_n_ticks>0` 覆盖 `critical=1`、`normal=2`、`background=5` 的默认周期。
- ROS 回调不得直接调用 `Tree::tickOnce()`。`BtExecutorNode` 串行化 tick、服务、reload
  和调试覆盖；订阅节点回调只写输入快照，黑板仍由行为树线程拥有。
- `bt_server::TreeApiService` 通过同一互斥锁串行化当前树的 load/tick/run/export。

完整设计与使用说明见 `docs/scheduling.rst`。

## ROS2 Debug Sandbox 契约

`bt_debug.launch.py` 使用独立的 `ROS_DOMAIN_ID` 同时启动 `bt_debug_executor` 和
`bt_debug_web`。普通 `bt_executor` 的 `debug_mode` 默认是 `false`，不会创建以下调试接口。

| ROS 接口 | 类型 / Schema | 语义 |
|---|---|---|
| `~/debug_state` | `std_msgs/msg/String` / `bt_ros2.debug_state.v1` | 当前 pause/run、tick 序号、Condition 清单和覆盖值 |
| `~/debug_overrides` | `std_msgs/msg/String` | Web 适配器提交的原子 Condition 覆盖命令 |
| `~/pause`、`~/resume` | `std_srvs/srv/Trigger` | 暂停时保留树状态；继续恢复周期 tick |
| `~/step` | `std_srvs/srv/Trigger` | 仅在暂停时执行一拍 |
| `~/reload` | `std_srvs/srv/Trigger` | 重新读取 XML、创建新 session，并停在 IDLE |

Condition 覆盖只接受 `AUTO`、`SUCCESS`、`FAILURE`。强制值在节点自身 `tick()` 之前生效，
Action、Control 和 Decorator 不能被覆盖；替换前会先校验全部 node key，因此不会留下部分更新。

Debug Web 增加 `GET /api/v1/debug/state`、`POST /api/v1/debug/overrides` 和
`POST /api/v1/debug/control`。这些写接口只在 `debug_mode=true` 的 Web 进程中注册；普通
`bt_web.launch.py` 仍是严格只读接口。

文件 API 限制在 `BT_TREE_WORKSPACE` 或默认 `examples/trees`，只接受普通 `.xml` 文件名，拒绝绝对路径、子目录和 `../`。
