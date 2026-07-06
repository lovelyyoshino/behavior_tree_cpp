测试矩阵
========

自动验证
--------

.. list-table::
   :header-rows: 1
   :widths: 30 40 30

   * - 命令
     - 覆盖
     - 期望
   * - ``cmake --build build``
     - C++ 核心、插件、server、examples、测试二进制。
     - 通过。
   * - ``ctest --test-dir build --output-on-failure``
     - 核心、XML、数据节点、函数注册表、mock ROS2 基类。
     - 全绿。
   * - ``./scripts/smoke_server.sh``
     - 真实 ``bt_server`` HTTP API。
     - health/nodes/load/validate/format/export/tick/run/structure/trees/open/save 和错误契约全通过。
   * - ``cd bt_editor && npm run build``
     - TypeScript 和 Vite build。
     - 通过。
   * - ``cd bt_editor && npm test``
     - XML round-trip、DFS 前序 id、连线规则、导入布局、整理布局算法、端口控件推断。
     - 4 个测试文件、13 个用例通过。
   * - ``cd bt_editor && npx playwright test``
     - 编辑器浏览器基础闭环，含 XML 预览、后端校验/格式化、Run 摘要和整理布局按钮。
     - Chromium 通过。
   * - ``./scripts/build_docs.sh``
     - Sphinx toctree、RST 语法、图片路径、literalinclude。
     - HTML 构建通过。

ROS2 真机验证
-------------

当前机器没有 ROS2/rclcpp/colcon，因此以下命令不能在本机声明通过：

.. code-block:: bash

   colcon build --packages-select bt_ros2
   ros2 launch bt_ros2 bt_executor.launch.py tree_file:=...
   ros2 topic pub /battery sensor_msgs/msg/BatteryState "{percentage: 0.18}"
   ros2 topic echo /robot/command

本机只验证 ROS2 相关代码的 mock 路径、语法和 XML。
