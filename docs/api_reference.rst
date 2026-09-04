API 参考
========

本页是查询入口，详细契约仍以源码和 ``docs/design/API_CONTRACT.md`` 为准。

NodeFactory
-----------

.. code-block:: cpp

   factory.registerNodeType<T>("RegName");
   factory.createNode("RegName", "instName", config);
   factory.loadPlugin("./build/lib/libbt_nodes.dylib");
   factory.manifests();
   factory.isRegistered("RegName");

节点如果提供可选的 ``providedDocumentation()``，``manifests()`` 会把节点用途、状态语义、
失败边界和最小 XML 一起返回。未提供说明的旧插件仍可注册：

.. code-block:: cpp

   static bt_core::NodeDocumentation providedDocumentation() {
     return {"用途", "放置和配置方式", "状态转换", "失败边界",
             R"(<MyAction message="hello"/>)"};
   }

HTTP ``GET /api/nodes`` 对应字段为 ``documentation.summary``、
``documentation.usage``、``documentation.status_semantics``、
``documentation.failure_conditions`` 和 ``documentation.example_xml``。
ROS-aware backend 的 ``GET /api/v1/bt/capabilities`` 返回真实 ROS node、topic、消息类型和
同一份 manifest；普通 ``bt_server`` 在同一路径返回 ``available=false`` 和
``capabilities=null``，让编辑器无 404 地降级为手填，但不会伪造 ROS 图数据。

Tree
----

.. code-block:: cpp

   bt_core::Tree tree(root, blackboard);
   tree.tickOnce();
   tree.tickWhileRunning();
   tree.halt();
   tree.setStatusCallback(callback);
   tree.nodes();

XML
---

.. code-block:: cpp

   bt_core::XmlParser parser(factory);
   auto tree = parser.loadFromText(xml);
   auto xml_out = parser.writeToText(tree, "MainTree");

HTTP
----

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Endpoint
     - 用途
   * - ``GET /api/health``
     - 健康检查。
   * - ``GET /api/nodes``
     - 获取节点 manifest。
   * - ``GET /api/v1/bt/capabilities``
     - 获取 ROS2 动态能力快照；普通后端返回明确的不可用状态，ROS-aware 后端返回真实 graph。
   * - ``POST /api/tree/load``
     - 用 XML 加载当前树。
   * - ``POST /api/tree/blackboard``
     - 给已加载树的内存黑板写入一个 ``string``、``bool``、``int`` 或 ``double`` 初值。
       请求为 ``{"key":"temperature","type":"double","value":"25.5"}``；未加载树返回 404。
   * - ``POST /api/tree/validate``
     - 只校验 XML，不替换当前树；成功返回 ``ok`` 和 ``node_count``。
   * - ``POST /api/tree/format``
     - 只解析并格式化 XML，不替换当前树；成功返回 ``ok``、``node_count`` 和 ``xml``。
   * - ``GET /api/tree/export``
     - 导出当前树 XML。
   * - ``POST /api/tree/tick``
     - 执行一拍。
   * - ``POST /api/tree/run``
     - 跑到终态并返回状态变化序列。
   * - ``GET /api/tree/structure``
     - 返回父子结构。
   * - ``GET /api/trees``
     - 列出 workspace 内的 ``.xml`` 树文件。
   * - ``GET /api/tree/open?name=patrol.xml``
     - 读取 workspace 内指定树文件。
   * - ``POST /api/tree/save``
     - 保存 ``{\"name\":\"x.xml\",\"xml\":\"...\"}`` 到 workspace，保存前先解析校验。

文件 API 只接受 workspace 内普通 ``.xml`` 文件名，拒绝绝对路径、子目录和 ``../``。

黑板初始化
----------

黑板参数分为“可迁移启动初值”和“运行时值”。编辑器的“黑板参数”面板会把启动初值写入
XML 的 ``TreeNodesModel/Blackboard`` 元数据区；``load`` 或 ``run`` 只发送这份完整 XML，
解析器一次性恢复 typed 初值。``POST /api/tree/blackboard`` 只保留给树载入后的调试工具，
不是编辑器标准流程的第二数据源。节点仍通过端口重映射访问共享 ``Blackboard``：

.. code-block:: xml

   <Sequence name="temperature_alarm">
     <ReadScalar topic="/temperature" value="{temperature}"/>
     <ScalarThreshold key="temperature" op=">=" value="80"/>
   </Sequence>

``key="temperature"`` 是键名本身，``value="{temperature}"`` 是输出端口重映射。XML 中的
启动初值示例：

.. code-block:: xml

   <TreeNodesModel>
     <Blackboard>
       <Entry key="temperature" type="double" value="25.5"
              description="启动测试值"/>
     </Blackboard>
   </TreeNodesModel>

``XmlParser`` 载入时会初始化这些 typed 值，``GET /api/tree/export`` 和 ``format`` 也会保留
元数据。ROS 输入节点收到新消息后可以覆盖运行时键，但不会改写 XML 中的启动值；浏览器面板
另存于 ``localStorage`` 仅用于刷新恢复草稿。编辑器底部“下载 XML”导出完整 XML，“导出树 +
黑板”另生成版本化 ``behavior_tree.bt.json`` 配置包。

编辑器还会把多树文档的节点、连线、位置、主树 ID 和当前定义标签保存到同一浏览器的
``localStorage``，因此刷新不会丢失尚未导出的工作现场；跨浏览器或跨机器仍应使用 XML/配置包。

多树文档会同时保留所有 ``<BehaviorTree ID="...">`` 定义。解析器运行主树时按
``SubTree``/``SubTreePlus`` 展开并检查循环，服务器的 ``format``/``export`` 则保留原始
子树调用和定义，避免把可维护的 Yuyi 结构导出成不可编辑的展开副本。编辑器顶部“树定义”栏
可以分别编辑这些定义；业务节点（例如 ``LoadYuyiPath``）仍必须由插件注册并声明端口。

脚本入口
--------

.. code-block:: bash

   ./scripts/bootstrap.sh
   ./scripts/dev.sh
   ./scripts/build_docs.sh
   ./scripts/build_pages.sh
   ./scripts/test.sh
