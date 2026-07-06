快速开始
========

一键准备
--------

在仓库根目录运行：

.. code-block:: bash

   ./scripts/bootstrap.sh

脚本会做三件事：

* 配置 C++ 构建目录 ``build``。
* 安装 ``bt_editor`` 的 npm 依赖。
* 安装 Playwright Chromium 浏览器。

一键验证
--------

.. code-block:: bash

   ./scripts/test.sh

验证覆盖：

* C++ 配置与构建。
* ``ctest`` 全量非 ROS 单测。
* ``bt_server`` 真实进程 smoke，覆盖 ``health/nodes/load/export/tick/run/structure``。
* ROS2 launch Python 语法和 XML 文件解析。
* Vitest 前端单元测试。
* React/TypeScript 前端 build。
* Playwright Chromium E2E。
* Sphinx HTML 文档构建。

Vitest 覆盖 XML round-trip、DFS 前序 id、连线规则、导入布局、整理布局和端口控件推断。Playwright 当前是 mocked UI smoke；真实后端协议由同一个脚本里的 server smoke 覆盖。

当前机器没有 ROS2 时，``colcon build``、``ros2 launch`` 和真实 topic 收发会明确跳过；这不是通过声明，而是环境限制说明。

一键启动编辑器
--------------

.. code-block:: bash

   ./scripts/dev.sh

默认地址：

* 后端：``http://127.0.0.1:8080``
* 前端：``http://127.0.0.1:5173``

``bt_editor/vite.config.ts`` 默认把 ``/api`` 代理到 ``http://localhost:8080``，所以除非同步改 Vite 配置，否则开发时不要随意改 ``BT_SERVER_PORT``。
本地树文件 API 默认限制在 ``examples/trees``；需要换目录时设置 ``BT_TREE_WORKSPACE=/path/to/trees``。

手动启动
--------

.. code-block:: bash

   cmake -S . -B build -DBT_BUILD_NODES=ON -DBT_BUILD_SERVER=ON -DBT_BUILD_TESTS=ON
   cmake --build build
   ./build/bin/bt_server 127.0.0.1 8080 ./build/lib/libbt_nodes.dylib

Linux 下插件路径通常是 ``./build/lib/libbt_nodes.so``。

另一个终端：

.. code-block:: bash

   cd bt_editor
   npm run dev

构建文档
--------

.. code-block:: bash

   ./scripts/build_docs.sh

输出目录是 ``docs/_build/html``。
