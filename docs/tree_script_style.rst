行为脚本风格
============

BehaviorTree.CPP-X 继续使用兼容 BehaviorTree.CPP/Groot 的 XML 作为执行格式。风格规范的目标是让脚本既能被编辑器稳定生成，也能被人工快速 review。

.. note::

   完整 Markdown 规范见 ``docs/design/TREE_SCRIPT_STYLE.md``。本页提供 Sphinx 文档站里的查询入口。

基本外壳
--------

.. code-block:: xml

   <root main_tree_to_execute="MainTree">
     <BehaviorTree ID="MainTree">
       <Sequence name="root_flow">
         <AlwaysSuccess name="precheck_ok"/>
       </Sequence>
     </BehaviorTree>
   </root>

约束：

* ``main_tree_to_execute`` 指向真实存在的 ``BehaviorTree ID``。
* 一个 ``BehaviorTree`` 内只放一个根节点。
* 复杂逻辑拆成多个 ``BehaviorTree ID``，主树用 ``<SubTree ID="..."/>`` 引用。
* 默认主树使用 ``MainTree``；业务示例可以使用 ``RechargeTree`` 这类明确名字。

命名
----

.. list-table::
   :header-rows: 1
   :widths: 25 35 40

   * - 对象
     - 推荐格式
     - 示例
   * - 节点 ``name``
     - 小写蛇形
     - ``battery_guard``、``send_recharge_command``
   * - 黑板 key
     - 小写蛇形
     - ``battery_level``、``needs_recharge``
   * - 子树 ``ID``
     - PascalCase
     - ``StartupChecks``、``RecoveryFlow``
   * - ROS topic
     - 保留系统原名
     - ``/battery_state``、``/robot/command``

节点注册名和自定义 XML 属性名必须是可移植的 XML 名称：以字母或下划线开头，后续只使用
字母、数字、``_``、``-`` 或 ``.``。编辑器会在导出前拦截非法名称；这条约束也适用于
``LoadYuyiPath`` 这类项目自定义节点，避免 XML 在不同解析器之间出现差异。

端口值
------

.. code-block:: xml

   <PrintMessage message="hello"/>
   <PrintMessage message="{operator_message}"/>

第一行是字面量端口值，只属于当前节点。第二行是黑板重映射，运行时从 ``operator_message`` 读取。

建议：

* 需要跨节点共享的数据先写黑板，再用 ``{key}`` 读取。
* 一次性配置值直接写字面量，例如阈值 ``value="0.20"``。
* 布尔值写 ``true``/``false``，数值阈值写十进制字符串。
* XML 特殊字符必须转义：``<`` 写 ``&lt;``，``>`` 写 ``&gt;``，``&`` 写 ``&amp;``。
* ``SubTreePlus`` 的映射属性只能写完整的 ``{parent_key}``；需要填写固定值时，应把它
  声明为目标子树节点自己的端口，而不是把字面量塞进调用点。

启动初值与运行时键
------------------

``<TreeNodesModel><Blackboard>`` 保存的是启动快照，不是所有运行时黑板内容。需要在首拍
读取的输入可以声明 ``<Entry key="threshold" type="double" value="0.2"/>``，并在端口上
使用 ``value="{threshold}"``；输出端口或 ROS2 订阅节点可以只写 ``{threshold}``，由节点
在运行期间首次创建/更新该键。重复载入 XML 时，新快照替换旧初值；没有 Blackboard 区则
清除旧初值，从而避免把上一棵树的参数带入下一棵树。

内置示例树
----------

.. list-table::
   :header-rows: 1
   :widths: 35 65

   * - 文件
     - 覆盖场景
   * - ``examples/trees/minimal_sequence_fallback.xml``
     - 最小 ``Sequence`` / ``Fallback`` 控制流。
   * - ``examples/trees/blackboard_data_flow.xml``
     - 黑板写入、数值比较、布尔判断。
   * - ``examples/trees/subtree_reuse.xml``
     - 多个 ``BehaviorTree ID`` 和 ``<SubTree/>`` 复用。

运行：

.. code-block:: bash

   ./build/bin/example_load_xml ./build/lib/libbt_nodes.dylib examples/trees/blackboard_data_flow.xml

Linux 下插件路径通常是 ``./build/lib/libbt_nodes.so``。

格式化稳定性
------------

``bt_server`` 的 ``/api/tree/format`` 和 ``/api/tree/export`` 都走 ``bt_core::XmlParser::writeToText``。验收标准是同一棵树多次 format 输出完全一致，且 ``load -> export -> load -> export`` 不改变 DFS 顺序、实例名、字面量端口和 ``{blackboard_key}`` 重映射。

编辑器把黑板面板作为当前文档的绑定真源：收到旧格式化服务的响应后，会先比较
``TreeNodesModel/Blackboard`` 快照；如果响应缺少或改写了 ``Entry``，预览回退到当前画布
序列化结果，确保格式化不会把面板参数从 XML 中抹掉。

``./scripts/test.sh`` 会运行新增示例，并在真实 server API 集成阶段检查 formatter 幂等。
