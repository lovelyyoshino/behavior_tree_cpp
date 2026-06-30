# bt_core API 契约（已验证，fan-out agent 必读）

> 本文件是 bt_core 已编译验证通过的真实 API。下游模块(bt_nodes/bt_server/bt_ros2/examples)
> 必须严格基于这些签名实现，不要臆造。所有路径相对项目根
> `/Users/pony.ai/Documents/文档/behavior_tree_cpp`。

## 头文件一览（bt_core/include/bt_core/）
- `node_status.hpp` — `NodeStatus{IDLE,RUNNING,SUCCESS,FAILURE}`、`NodeType{CONTROL,DECORATOR,ACTION,CONDITION}`、`isStatusCompleted()`、`toStr()`
- `blackboard.hpp` — `Blackboard`（`set<T>/get<T>/contains/remove`）、`PortInfo`、`PortsList`、`InputPort<T>/OutputPort<T>/makePorts(...)`
- `tree_node.hpp` — `TreeNode` 基类、`NodeConfig{blackboard, port_remap, port_values}`、`StatusChangeCallback`
- `leaf_node.hpp` — `ActionNode`（可返回 RUNNING，有 `onHalted()`）、`ConditionNode`（只 SUCCESS/FAILURE）
- `control_node.hpp` — `ControlNode`（`addChild/children/childrenCount/haltChildren`）
- `decorator_node.hpp` — `DecoratorNode`（`setChild/child`）
- `node_factory.hpp` — `NodeFactory`、`NodeManifest{registration_name,type,ports}`
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
  static PortsList providedPorts() {            // 可选；声明端口供编辑器枚举
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

## 关键 API 签名
```cpp
// 工厂
factory.registerNodeType<T>("RegName");          // T 继承 TreeNode；重复注册抛 logic_error
factory.createNode("RegName","instName",cfg);    // 未注册抛 runtime_error；返回 TreeNode::Ptr
factory.loadPlugin("/path/libfoo.dylib");        // 推荐！工厂自持句柄，析构顺序安全
factory.manifests();                             // vector<NodeManifest>，供 /nodes 接口
factory.isRegistered("RegName"); factory.size();

// 控制/装饰节点构建
auto seq = std::dynamic_pointer_cast<ControlNode>(factory.createNode("Sequence","s",cfg));
seq->addChild(child);                            // 控制节点加子节点
deco->setChild(child);                           // 装饰节点设唯一子节点（重复抛 logic_error）

// 树
Tree tree(rootNode, blackboard);
tree.tickOnce();                                 // 执行一拍
tree.tickWhileRunning(maxIter=1e6);              // 循环到非 RUNNING
tree.halt();
tree.setStatusCallback([](uint16_t id, NodeStatus prev, NodeStatus next){...}); // 运行态推送
tree.nodes();                                    // vector<TreeNode::Ptr>，已分配 id
tree.visitNodes([](const TreeNode::Ptr&, int depth){...});  // DFS 遍历

// XML
XmlParser parser(factory);
Tree t = parser.loadFromText(xmlStr);            // 或 loadFromFile(path)
std::string xml = parser.writeToText(t, "MainTree");  // 或 writeToFile(t, path)
```

## XML 格式（兼容 BehaviorTree.CPP / Groot）
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
- 属性值 `"{k}"` → 端口重映射到黑板 key；否则字面量（写黑板 + 存 port_values 供导出还原）

## 构建集成
- 顶层 CMake 用 option 控制：`BT_BUILD_NODES/SERVER/ROS2/EXAMPLES/TESTS`
- 下游 target 用 `bt::core` link（已设别名）
- 插件库用 `add_library(foo SHARED ...)`，link `bt::core`

## 已验证事实（exit=0）
1. 基类层 tick/halt/回调正确
2. 工厂注册 + 按名建树 + 黑板数据流
3. 运行时 .dylib 插件 load→register→tick，且**正常退出无段错误**（析构顺序已修）
4. XML 解析+建树+tick+round-trip+字面量保真
5. ctest 8/8 全绿
