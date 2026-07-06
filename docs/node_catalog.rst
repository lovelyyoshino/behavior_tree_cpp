节点目录
========

bt_nodes
--------

``bt_nodes`` 是开箱插件库，构建产物在 ``build/lib/libbt_nodes.*``。运行时由 ``NodeFactory::loadPlugin`` 加载。注册入口是 ``bt_nodes/register_nodes.cpp`` 里的 ``BT_REGISTER_NODES``，当前共注册 **25 个内置节点**，按类别归纳如下。

.. list-table::
   :header-rows: 1
   :widths: 20 8 42 30

   * - 类别
     - 数量
     - 节点
     - 说明
   * - Control
     - 3
     - ``Sequence``、``Fallback``、``Parallel``
     - 组织子树流程。
   * - Decorator
     - 5
     - ``Inverter``、``Retry``、``Repeat``、``ForceSuccess``、``ForceFailure``
     - 包装一个子节点并改写执行策略。
   * - Action
     - 3
     - ``AlwaysSuccess``、``AlwaysFailure``、``PrintMessage``
     - 示例和调试动作。
   * - Data
     - 9
     - ``SetBlackboard``、``SetBool``、``Counter``、``CompareBlackboard``、``CheckBool``、``CooldownCondition``、``BlackboardExists``、``ClearBlackboard``、``ScalarThreshold``
     - 黑板读写、比较、计数、节流与存在性判断。
   * - Timer
     - 2
     - ``Delay``、``WaitUntilElapsed``
     - 基于单调时钟的延时动作与到时条件。
   * - Diagnostic
     - 1
     - ``LogEvent``
     - 分级诊断日志埋点。
   * - Function
     - 2
     - ``FunctionAction``、``FunctionCondition``
     - 调用单例注册表里的 C++ 函数。

.. note::

   25 = Control 3 + Decorator 5 + Action 3 + Data 9 + Timer 2 + Diagnostic 1 + Function 2。

新增节点端口详解
~~~~~~~~~~~~~~~~

本轮新增 6 个内置节点（Timer 2 + Diagnostic 1 + Data 3），端口与失败语义以头文件为准。

**Delay** 是异步 Action 节点：从首拍起计时，未到时持续返回 ``RUNNING``，到时返回 ``SUCCESS``。是框架里演示 ``RUNNING`` 语义的关键节点，放入 ``Sequence`` 会阻塞后续节点直到到时；被父节点 halt 时复位计时。时间源为 ``std::chrono::steady_clock``。头文件：``bt_nodes/timer/delay_node.hpp``。

.. list-table::
   :header-rows: 1
   :widths: 20 12 12 56

   * - 端口
     - 类型
     - 默认
     - 说明
   * - ``delay_ms``
     - int
     - ``1000``
     - 延时时长（毫秒），从首拍起计时；``<=0`` 表示不延时，首拍即 ``SUCCESS``。

失败语义：本节点不产生 ``FAILURE``；只在 ``RUNNING`` 与 ``SUCCESS`` 之间转换。

**WaitUntilElapsed** 是 Condition 节点：节点实例首拍记录起点（只记一次、永不刷新），此后距起点已达 ``duration_ms`` 返回 ``SUCCESS``，否则 ``FAILURE``。表达“自某时刻起已过去至少 N 毫秒”的单调时间条件，区别于 ``CooldownCondition`` 的周期节流。头文件：``bt_nodes/timer/wait_until_elapsed_condition_node.hpp``。

.. list-table::
   :header-rows: 1
   :widths: 20 12 12 56

   * - 端口
     - 类型
     - 默认
     - 说明
   * - ``duration_ms``
     - int
     - ``1000``
     - 需经过的时长（毫秒），自首拍起计时；``<=0`` 表示立即满足（恒 ``SUCCESS``）。

失败语义：未到时返回 ``FAILURE``（首拍通常为 ``FAILURE``，除非 ``duration_ms<=0``）。

**BlackboardExists** 是 Condition 节点：黑板中存在该 ``key`` 则 ``SUCCESS``，否则 ``FAILURE``。只看键是否存在（``Blackboard::contains``），不关心类型与取值。头文件：``bt_nodes/data/blackboard_exists_condition_node.hpp``。

.. list-table::
   :header-rows: 1
   :widths: 20 12 12 56

   * - 端口
     - 类型
     - 默认
     - 说明
   * - ``key``
     - string
     - ``""``
     - 要探测存在性的黑板键名。

失败语义：``key`` 为空、键不存在均返回 ``FAILURE``。

**ClearBlackboard** 是 Action 节点：从黑板删除指定 ``key``（``Blackboard::remove``），删除后保证该键不存在。对不存在的键是无害 no-op，因此幂等返回 ``SUCCESS``。头文件：``bt_nodes/data/clear_blackboard_node.hpp``。

.. list-table::
   :header-rows: 1
   :widths: 20 12 12 56

   * - 端口
     - 类型
     - 默认
     - 说明
   * - ``key``
     - string
     - ``""``
     - 要从黑板删除的键名。

失败语义：``key`` 为空返回 ``FAILURE``（避免静默无效操作）；其余情况恒 ``SUCCESS``。

**LogEvent** 是 Action 节点：把一条带级别前缀 ``[LEVEL] message`` 的诊断消息打印出来，恒返回 ``SUCCESS``。``info``/``warn`` 走 ``std::cout``，``error`` 走 ``std::cerr``；非法或空级别回退为 ``info``。日志是副作用，不改变树的成败走向。头文件：``bt_nodes/diagnostic/log_event_node.hpp``。

.. list-table::
   :header-rows: 1
   :widths: 20 12 16 52

   * - 端口
     - 类型
     - 默认
     - 说明
   * - ``message``
     - string
     - ``""``
     - 要打印的诊断文本，允许为空。
   * - ``level``
     - string（枚举）
     - ``info``
     - 日志级别，取值 ``info`` / ``warn`` / ``error``；编辑器渲染为下拉框。

失败语义：无。恒 ``SUCCESS``（需“打印并失败”可与 ``ForceFailure`` 组合）。

**ScalarThreshold** 是 Condition 节点：读黑板 ``key`` 的数值，与 ``value`` 按 ``op`` 比较，成立 ``SUCCESS`` 否则 ``FAILURE``。把“传感器/状态读数”变成“行为树判断”的通用阈值节点；``value`` 是强类型 ``double`` 端口，意图比 ``CompareBlackboard`` 更聚焦数值门控。头文件：``bt_nodes/data/scalar_threshold_condition_node.hpp``。

.. list-table::
   :header-rows: 1
   :widths: 20 14 12 54

   * - 端口
     - 类型
     - 默认
     - 说明
   * - ``key``
     - string
     - ``""``
     - 要读取的黑板键名（其值应可解析为数值）。
   * - ``op``
     - string（枚举）
     - ``>=``
     - 运算符，取值 ``>`` / ``>=`` / ``<`` / ``<=`` / ``==`` / ``!=``；编辑器渲染为下拉框。
   * - ``value``
     - double
     - ``0``
     - 参与比较的阈值（右操作数）。

失败语义：``key`` 为空、键不存在、黑板值无法解析为数值、``op`` 非法均返回 ``FAILURE`` （绝不抛异常打断树）。

bt_ros2
-------

.. list-table::
   :header-rows: 1
   :widths: 30 30 40

   * - 节点
     - 消息类型
     - 作用
   * - ``ReadBattery``
     - ``sensor_msgs/msg/BatteryState``
     - 把 ``percentage`` 写入黑板。
   * - ``ReadScalar``
     - ``std_msgs/msg/Float64``
     - 把 ``data`` 写入黑板。
   * - ``IsFlagTrue``
     - ``std_msgs/msg/Bool``
     - ``data=true`` 时成功。
   * - ``IsObstacleClose``
     - ``sensor_msgs/msg/Range``
     - ``range<threshold`` 时成功。
   * - ``IsDocked``
     - ``std_msgs/msg/Bool``
     - 判断是否完成对接。
   * - ``PublishRechargeCommand``
     - ``std_msgs/msg/String``
     - 发布 ``start_recharge:main_dock`` 命令。
   * - ``TaskDoneNotifier``
     - ``std_msgs/msg/String``
     - 发布任务完成消息。

