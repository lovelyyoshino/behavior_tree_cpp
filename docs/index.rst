BehaviorTree.CPP-X 文档
========================

BehaviorTree.CPP-X 是一个插件化、ROS 解耦的 C++17 行为树框架。它把核心执行、节点插件、HTTP 后端、React 编辑器和 ROS2 wrapper 分开，让行为树既能独立运行，也能接入机器人系统。

这套 Sphinx 文档面向日常开发：先说明怎么启动和验证，再说明怎么写节点、怎么用函数注册表复用业务逻辑、怎么把 ROS2 topic 数据接入黑板并触发回充动作。

.. image:: _static/architecture.svg
   :alt: BehaviorTree.CPP-X 架构图
   :width: 100%

推荐路径
--------

1. 先读 :doc:`behavior_tree_basics`，理解四种基本控制节点、tick 机制和黑板。
2. 再跑 :doc:`quickstart`，用统一验证入口确认 C++、server API、前端和 Playwright。
3. 再读 :doc:`function_manual`，理解工厂、端口、黑板、函数注册表和常用节点。
4. 用 :doc:`singleton_factory_function` 打通“单例 + 工厂 + 生成器引用函数”三模式与回充闭环。
5. 用 :doc:`scheduling` 把输入优先级、抢占和 tick 分级收敛到一棵树。
6. 接着按 :doc:`ros2_recharge_tutorial` 改出自己的 ROS2 数据流节点。
7. 用 :doc:`tree_script_style` 规范 XML 命名、黑板 key、SubTree 和 formatter。
8. 最后用 :doc:`developer_workflow` 固化开发、测试和文档构建流程。

.. toctree::
   :maxdepth: 2
   :caption: 使用手册

   behavior_tree_basics
   quickstart
   function_manual
   singleton_factory_function
   scheduling
   tree_script_style
   ros2_recharge_tutorial
   ros2_editor_capabilities
   ros2_plugin_build
   editor_playwright
   yuyi_ros2_optimization
   developer_workflow
   pages_deployment

.. toctree::
   :maxdepth: 2
   :caption: 设计与参考

   architecture
   node_catalog
   api_reference
   testing_matrix
   commercial_release
