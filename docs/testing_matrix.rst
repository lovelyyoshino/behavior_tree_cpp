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
     - 全绿。
   * - ``cd bt_editor && npx playwright test``
     - mocked 编辑器闭环，含 XML 预览、后端校验/格式化、Run、布局、状态上色和 HTTP 500 可访问告警。
     - Chromium 通过。
   * - ``cd bt_editor && BT_SERVER_BIN=... BT_NODES_PLUGIN=... npm run test:e2e:live``
     - 生产 preview 代理到真实 ``bt_server + libbt_nodes``，验证 25 manifest、load/validate/tick 和严格 XML 错误。
     - Chromium 通过；调用方显式提供 Release 产物。
   * - ``cd bt_editor && npm run screenshots``
     - 固定 mocked 状态生成四张文档图，并验证文件大小和 SHA-256 内容互异。
     - 四张非空、互异图片。
   * - ``./scripts/build_docs.sh``
     - Sphinx toctree、RST 语法、图片路径、literalinclude。
     - HTML 构建通过。
   * - ``./scripts/smoke_ros2.sh``
     - ROS2 Humble 真机 ``colcon build``、``ros2 launch``、``/battery_state`` 到 ``/robot/command``，以及 ``/dock/is_docked`` 到 ``/bt/task_done``。
     - 有 ROS2 环境时通过；无 ROS2 环境时不作为默认 gate。

ROS2 真机验证
-------------

当前机器已在 ROS2 Humble 环境跑通过完整 smoke：

.. code-block:: bash

   ./scripts/smoke_ros2.sh

等价覆盖：

.. code-block:: bash

   colcon build --packages-select bt_ros2
   ros2 launch bt_ros2 bt_executor.launch.py \
     tree_file:=$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml
   ros2 topic pub /battery_state sensor_msgs/msg/BatteryState "{percentage: 0.18}"
   ros2 topic echo /robot/command
   ros2 topic pub /dock/is_docked std_msgs/msg/Bool "{data: true}"
   ros2 topic echo /bt/task_done

默认 ``./scripts/test.sh`` 仍只跑非 ROS gate；设置 ``BT_RUN_ROS2_SMOKE=1`` 后会纳入真实 ROS2 smoke。无 ROS2 环境时只验证 mock 路径、语法和 XML。
