测试矩阵
========

自动验证
--------

``./scripts/test.sh`` 是统一的 mandatory non-ROS 发布入口。它使用当前 Release 构建
产物，不允许 ``BT_SKIP_E2E=1``，并按下表顺序执行。当前脚本面向 Linux/macOS Bash；
Windows 使用 WSL。原生 PowerShell/CMD 未验证。

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
   * - ASan/UBSan ``PluginRuntime`` focused CTest
     - 插件注册回滚、throwing plugin 回滚、树晚于工厂析构、宿主函数跨 DSO 可见。
     - 无 sanitizer 诊断，focused suite 全绿。
   * - ``./scripts/smoke_install.sh``
     - 安装 ``bt::core`` / ``bt::nodes``，外部 same-toolchain consumer 加载安装插件并调用宿主函数。
     - ``[install-smoke] result: SUCCESS``。
   * - ``./scripts/smoke_server.sh``
     - 真实 ``bt_server`` HTTP API。
     - health/nodes/load/validate/format/export/tick/run/structure/trees/open/save 和错误契约全通过。
   * - ``cd bt_editor && npm run build``
     - TypeScript 和 Vite build。
     - 通过。
   * - ``cd bt_editor && npm test``
     - XML round-trip、DFS 前序 id、连线规则、导入布局、整理布局算法、端口控件推断。
     - 全绿。
   * - ``cd bt_editor && npx playwright test --project=chromium`` （连续三轮）
     - mocked 编辑器闭环，含 XML、Run、状态上色、离线/manifest 恢复、删除/重置/清空，以及 1280/768/390 响应式和触控添加。
     - 每轮 14/14，三轮均通过；CI retry-pass 仍按 flaky 失败。
   * - ``cd bt_editor && BT_SERVER_BIN=... BT_NODES_PLUGIN=... npm run test:e2e:live``
     - 生产 preview 代理到真实 ``bt_server + libbt_nodes``，验证 25 manifest、load/validate/tick、清空后导回、Run 和严格 XML 错误。
     - 1/1；调用方显式提供刚构建的 Release 产物。
   * - 临时目录 ``docs-screenshots.spec.ts`` + ``screenshots:check``
     - 固定 mocked 状态生成四张临时图片，验证 PNG/IHDR/尺寸和 SHA-256；Linux canonical gate 还会逐字节对比已提交文档图。
     - capture 1/1；四张非空、互异图片，Linux reference 一致。
   * - GitHub Actions ``playwright-*`` artifact
     - mocked 三轮、live、截图用例的独立 HTML 报告、trace、失败截图和生成图。
     - 成功或失败均上传并保留 14 天；无诊断文件时给出 warning。
   * - ``./scripts/build_docs.sh``
     - Sphinx toctree、RST 语法、图片路径、literalinclude。
     - HTML 与 linkcheck 均通过，warning 视为 error。
   * - ``./scripts/smoke_ros2.sh``
     - ROS2 Humble 真机 ``colcon build``、``ros2 launch``、``/battery_state`` 到 ``/robot/command``，以及 ``/dock/is_docked`` 到 ``/bt/task_done``。
     - 有 ROS2 环境时通过；无 ROS2 环境时不作为默认 gate。

ROS2 真机验证
-------------

当前机器已在 ROS2 Humble 环境跑通过完整 smoke：

.. code-block:: bash

   ./scripts/smoke_ros2.sh

它覆盖 35 个默认注册和八节点安装树，并按 observer-first 顺序启动 command、notifier、
status 观察者，调用 ``/bt_executor/start``，再各发布一条 battery 和 dock 消息。可复制
命令见 :doc:`ros2_recharge_tutorial`，不要用连续 ``ros2 topic pub`` 代替 one-shot 流程。

默认 ``./scripts/test.sh`` 仍只跑非 ROS gate；设置 ``BT_RUN_ROS2_SMOKE=1`` 后会纳入真实 ROS2 smoke。无 ROS2 环境时只验证 mock 路径、语法和 XML。

Jazzy 环境状态：**unverified: ROS 2 Jazzy is not installed on this machine.**

商用边界
--------

工程 gate 全绿只证明当前源码的技术验证。根许可证、真实 maintainer/copyright 身份和
第三方 notice 的最终审批仍由产品 owner/法务完成；见 ``docs/COMMERCIAL_RELEASE_CHECKLIST.md``。
