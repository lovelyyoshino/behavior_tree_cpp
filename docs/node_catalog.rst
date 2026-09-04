节点目录
========

属性面板与运行时发现
--------------------

编辑器不是凭节点名猜属性。后端 ``GET /api/nodes`` 返回每个端口的方向、类型、默认值和
说明，并可返回 ``documentation``：用途、使用位置、状态语义、失败边界和最小 XML。自定义
节点在 C++ 中实现可选的 ``providedDocumentation()`` 后，面板会自动显示这些内容。

如果节点尚未出现在运行时 manifest，属性面板仍可在“自定义端口契约”区声明端口名、方向、
类型、默认值和说明。声明会随编辑器文档草稿保存，并让输出端口出现黑板写入控件；它是
设计时提示，不会伪造 C++ 执行能力。最终接入 Yuyi/ROS2 时，插件的 ``providedPorts()``
必须声明相同端口，否则严格 XML 载入会明确报告未声明端口。

ROS2 执行器还会发布 ``bt_ros2.capabilities.v1``，由真实 ROS graph 填充 node 名称、topic
名称和消息类型，Web 适配器提供 ``GET /api/v1/bt/capabilities``。带
``editor_hint=ros_topic`` 的端口会从这份快照生成候选，但快照是可选且会过期，面板始终
允许手填；普通 ``bt_server`` 不会伪造 ROS 能力。

端口值与黑板 key
----------------

编辑器属性面板里有三种容易混淆的写法：

.. list-table::
   :header-rows: 1
   :widths: 24 24 26 26

   * - 场景
     - 填写方式
     - 示例
     - 含义
   * - ``key`` / ``output_key``
     - 直接写名字，不加花括号
     - ``mission_count``
     - 这个端口保存的就是“要操作哪个黑板键”的名字。
   * - 普通端口使用固定值
     - 直接写字面量
     - ``message="hello"``
     - 值只属于当前节点，不写入共享黑板。
   * - 普通端口连接黑板
     - ``{黑板键名}``
     - ``message="{event_text}"``
     - 把该端口重映射到共享黑板键，运行时从键中读值或向键中写值。

因此 ``Counter`` 的 ``key`` 填 ``mission_count``，不是 ``{mission_count}``。下面的树每拍
先把 ``mission_count`` 加一，再判断是否已经达到 3：

.. code-block:: xml

   <Sequence>
     <Counter key="mission_count" step="1"/>
     <CompareBlackboard key="mission_count" op="&gt;=" value="3"/>
     <PrintMessage message="mission count reached 3"/>
   </Sequence>

输出端口则使用花括号接线。例如 ``ReadScalar`` 的节点代码只认识输出端口 ``value``，
XML 用 ``value="{temperature}"`` 指定实际写入黑板键 ``temperature``，下游再用
``ScalarThreshold key="temperature"`` 读取：

.. code-block:: xml

   <Sequence>
     <ReadScalar topic="/temperature" timeout_ms="1000"
                 value="{temperature}"/>
     <ScalarThreshold key="temperature" op="&gt;=" value="80"/>
   </Sequence>

黑板值带运行时类型。``SetBool`` 写入真正的 ``bool``，``Counter`` 写入 ``int``，
``ReadScalar`` 写入 ``double``，``SetBlackboard`` 写入字符串。通用比较节点会做受控转换；
自定义节点用 ``getInput<T>`` 时必须让 ``T`` 与写入类型一致。

bt_nodes
--------

``bt_nodes`` 是开箱即用的动态插件，构建产物位于 ``build/lib/libbt_nodes.*``，
由 ``NodeFactory::loadPlugin`` 加载。``bt_nodes/register_nodes.cpp`` 当前注册 34 个
节点。下表中的端口均为 input；``无`` 表示节点没有端口。XML 片段需要放在
``<root><BehaviorTree>...</BehaviorTree></root>`` 中运行。

.. list-table:: 34 个内置节点完整契约
   :header-rows: 1
   :widths: 12 9 18 25 20 16

   * - 注册名
     - 类型
     - 端口（类型=默认）
     - 状态转换
     - 失败与边界
     - 最小 XML / 源码
   * - ``Sequence``
     - Control
     - 无
     - 空节点成功；子节点成功后推进，运行时保留游标；全部成功后复位并成功。
     - 任一子节点失败或 tick 后为 ``IDLE`` 时 halt 子树、复位并失败。
     - ``<Sequence><AlwaysSuccess/></Sequence>``

       ``bt_nodes/control/sequence_node.hpp``
   * - ``Fallback``
     - Control
     - 无
     - 从当前游标尝试；失败/``IDLE`` 后推进，运行时保留游标；首个成功时 halt、复位并成功。
     - 空节点或全部候选失败/``IDLE`` 时失败。
     - ``<Fallback><AlwaysFailure/><AlwaysSuccess/></Fallback>``

       ``bt_nodes/control/fallback_node.hpp``
   * - ``Parallel``
     - Control
     - ``success_count:int=-1``；``failure_count:int=1``
     - 每拍 tick 未终结子节点；先判断成功阈值，再判断失败阈值或剩余节点已无法满足成功阈值，否则运行。
     - 空节点成功；``IDLE`` 子节点保持未决。成功与失败阈值同时满足时成功优先。
     - ``<Parallel success_count="1" failure_count="1"><AlwaysSuccess/><AlwaysFailure/></Parallel>``

       ``bt_nodes/control/parallel_node.hpp``
   * - ``PrioritySelector``
     - Control
     - 无
     - 每拍从第一个子节点重评；首个 ``RUNNING``/``SUCCESS`` 分支获得调度权。
     - 子节点顺序即高到低优先级；切换时 halt 低优先级运行分支；空节点失败。
     - ``<PrioritySelector><AlwaysFailure/><AlwaysSuccess/></PrioritySelector>``

       ``bt_nodes/control/priority_selector_node.hpp``
   * - ``ReactiveSequence``
     - Control
     - 无
     - 每拍从第一个子节点重评；子节点成功后推进，``RUNNING`` 时 halt 该子节点并复位游标，下一拍重头评估。
     - 任一子节点失败或 ``IDLE`` 时 halt 子树并失败；空节点成功。与 ``Sequence`` 的差异是不保留游标续跑。
     - ``<ReactiveSequence><AlwaysSuccess/><Delay delay_ms="50"/></ReactiveSequence>``

       ``bt_nodes/control/reactive_sequence_node.hpp``
   * - ``ReactiveFallback``
     - Control
     - 无
     - 每拍从第一个候选重评；失败后推进，``RUNNING`` 时 halt 该子节点并复位游标，下一拍重头评估。
     - 首个成功即成功；全部候选失败或 ``IDLE`` 时失败；空节点失败。与 ``Fallback`` 的差异是不保留游标续跑。
     - ``<ReactiveFallback><AlwaysFailure/><AlwaysSuccess/></ReactiveFallback>``

       ``bt_nodes/control/reactive_fallback_node.hpp``
   * - ``Inverter``
     - Decorator
     - 无
     - 子节点 ``SUCCESS→FAILURE``、``FAILURE→SUCCESS``、``RUNNING→RUNNING``。
     - 子节点为 ``IDLE`` 时失败；严格 XML 要求恰好一个子节点。
     - ``<Inverter><AlwaysFailure/></Inverter>``

       ``bt_nodes/decorator/inverter_node.hpp``
   * - ``Retry``
     - Decorator
     - ``num_attempts:int=1``
     - 成功时复位并成功；运行时透传；失败后未耗尽则 halt 子节点并运行，耗尽后复位并失败。
     - 无子节点、``IDLE`` 或尝试耗尽时失败；负数表示无限重试，``0`` 仍执行一次。
     - ``<Retry num_attempts="3"><AlwaysFailure/></Retry>``

       ``bt_nodes/decorator/retry_node.hpp``
   * - ``Repeat``
     - Decorator
     - ``num_cycles:int=1``
     - 子节点成功后计数；未达次数则 halt 并运行，达到次数后复位并成功；运行时透传。
     - 无子节点、失败或 ``IDLE`` 时失败；负数表示无限重复，``0`` 仍执行一次。
     - ``<Repeat num_cycles="2"><AlwaysSuccess/></Repeat>``

       ``bt_nodes/decorator/repeat_node.hpp``
   * - ``ForceSuccess``
     - Decorator
     - 无
     - 子节点运行时透传；其他状态转为成功。
     - 自身不产生失败；严格 XML 仍要求恰好一个子节点。
     - ``<ForceSuccess><AlwaysFailure/></ForceSuccess>``

       ``bt_nodes/decorator/force_success_node.hpp``
   * - ``ForceFailure``
     - Decorator
     - 无
     - 子节点运行时透传；其他状态转为失败。
     - 子节点终结或 ``IDLE`` 时失败；严格 XML 要求恰好一个子节点。
     - ``<ForceFailure><AlwaysSuccess/></ForceFailure>``

       ``bt_nodes/decorator/force_failure_node.hpp``
   * - ``TickRate``
     - Decorator
     - ``tier:string=normal``；``every_n_ticks:int=0``
     - 首拍执行；critical 每拍、normal 每 2 拍、background 每 5 拍；正数自定义周期覆盖 tier。
     - 跳过拍保留子节点上次状态；负周期或未知 tier 抛错；严格 XML 要求一个子节点。
     - ``<TickRate tier="background"><AlwaysSuccess/></TickRate>``

       ``bt_nodes/decorator/tick_rate_node.hpp``
   * - ``KeepRunningUntilFailure``
     - Decorator
     - 无
     - 子节点 ``SUCCESS`` 或 ``RUNNING`` 都返回 ``RUNNING`` 继续拖着跑；子节点 ``FAILURE`` 时立即失败。
     - 无子节点时失败。与 ``Repeat`` 的差异：对成功不计数，只在失败时停止，适合长驻监视/调度分支。
     - ``<KeepRunningUntilFailure><AlwaysSuccess/></KeepRunningUntilFailure>``

       ``bt_nodes/decorator/keep_running_until_failure_node.hpp``
   * - ``KeepRunningUntilSuccess``
     - Decorator
     - 无
     - 子节点 ``FAILURE`` 或 ``RUNNING`` 都返回 ``RUNNING`` 继续拖着跑；子节点 ``SUCCESS`` 时立即成功。
     - 无子节点时失败。与 ``KeepRunningUntilFailure`` 对称，适合“等待某条件满足”。
     - ``<KeepRunningUntilSuccess><AlwaysFailure/></KeepRunningUntilSuccess>``

       ``bt_nodes/decorator/keep_running_until_success_node.hpp``
   * - ``AlwaysSuccess``
     - Condition
     - 无
     - 每拍直接成功，永不运行。
     - 无失败路径。
     - ``<AlwaysSuccess/>``

       ``bt_nodes/action/always_success_node.hpp``
   * - ``AlwaysFailure``
     - Condition
     - 无
     - 每拍直接失败，永不运行。
     - 恒失败。
     - ``<AlwaysFailure/>``

       ``bt_nodes/action/always_failure_node.hpp``
   * - ``PrintMessage``
     - Action
     - ``message:string="hello bt"``
     - 输出 ``[PrintMessage] <message>`` 后成功。
     - 无失败路径。
     - ``<PrintMessage message="hello"/>``

       ``bt_nodes/action/print_message_node.hpp``
   * - ``SetBlackboard``
     - Action
     - ``value:string=""``；``output_key:string=""``
     - 把字符串 ``value`` 写入 ``output_key`` 指定的黑板键后成功。
     - ``output_key`` 为空时失败。
     - ``<SetBlackboard value="42" output_key="score"/>``

       ``bt_nodes/data/set_blackboard_node.hpp``
   * - ``CompareBlackboard``
     - Condition
     - ``key:string=""``；``op:string="=="``；``value:string=""``
     - 双方都可转 ``double`` 时数值比较，否则字符串比较；成立成功。
     - 空 key、键缺失、类型或运算符不支持、比较不成立时失败。运算符：``== != < <= > >=``。
     - ``<CompareBlackboard key="score" op="&gt;=" value="60"/>``

       ``bt_nodes/data/compare_blackboard_node.hpp``
   * - ``CheckBool``
     - Condition
     - ``key:string=""``；``expected:bool=true``
     - 读取 bool；字符串仅 ``true``/``1`` 为真，实际值等于期望时成功。
     - 空 key、键缺失或不等于期望时失败；其他受支持值按假处理。
     - ``<CheckBool key="is_ready" expected="true"/>``

       ``bt_nodes/data/check_bool_node.hpp``
   * - ``Counter``
     - Action
     - ``key:string=""``；``step:int=1``
     - 当前值转为数值并截断为 int，加 ``step`` 后写回；缺失或不可解析时从 0 开始。
     - ``key`` 为空时失败。
     - ``<Counter key="tick_count" step="1"/>``

       ``bt_nodes/data/counter_node.hpp``
   * - ``CooldownCondition``
     - Condition
     - ``cooldown_ms:int=1000``
     - 首拍成功并记时；冷却期内失败；到期成功并刷新。``<=0`` 时恒成功。
     - 唯一正常失败是未到期；普通 halt 不清除内部时间戳。
     - ``<CooldownCondition cooldown_ms="500"/>``

       ``bt_nodes/data/cooldown_condition_node.hpp``
   * - ``SetBool``
     - Action
     - ``key:string=""``；``value:bool=true``
     - 把真正的 bool 写入指定黑板键后成功。
     - ``key`` 为空时失败。
     - ``<SetBool key="is_ready" value="true"/>``

       ``bt_nodes/data/set_bool_node.hpp``
   * - ``BlackboardExists``
     - Condition
     - ``key:string=""``
     - 只检查键存在性，不检查类型或值；存在时成功。
     - 空 key、黑板为空或键不存在时失败。
     - ``<BlackboardExists key="target_pose"/>``

       ``bt_nodes/data/blackboard_exists_condition_node.hpp``
   * - ``BlackboardGate``
     - Condition
     - ``key:string=""``；``expected:string=""``
     - 键存在且（``expected`` 为空或字符串值等于 ``expected``）时成功。
     - 空 key、键不存在或值不匹配时失败。用黑板值当“单刀开关”，让同一棵树按配置走不同分支。
     - ``<BlackboardGate key="mode" expected="patrol"/>``

       ``bt_nodes/data/blackboard_gate_node.hpp``
   * - ``ClearBlackboard``
     - Action
     - ``key:string=""``
     - 删除指定键；键不存在也幂等成功。
     - 空 key 或黑板为空时失败。
     - ``<ClearBlackboard key="target_pose"/>``

       ``bt_nodes/data/clear_blackboard_node.hpp``
   * - ``ScalarThreshold``
     - Condition
     - ``key:string=""``；``op:string=">="``；``value:double=0``
     - 把黑板值解析为 double 并比较；成立时成功。
     - 空/缺失 key、值不可解析、类型或运算符不支持、比较不成立时失败。运算符：``> >= < <= == !=``。
     - ``<ScalarThreshold key="battery_level" op="&lt;" value="0.2"/>``

       ``bt_nodes/data/scalar_threshold_condition_node.hpp``
   * - ``Delay``
     - Action
     - ``delay_ms:int=1000``
     - 正数时首拍记时并运行，到期成功后复位；``<=0`` 首拍成功。halt 复位计时。
     - 无失败路径。
     - ``<Delay delay_ms="500"/>``

       ``bt_nodes/timer/delay_node.hpp``
   * - ``NonBlockingDelay``
     - Action
     - ``msec:int=1000``
     - 自首拍起计时，未满 ``msec`` 毫秒持续返回 ``RUNNING``；满则成功并复位以允许再次调度。
     - 无失败路径；``<=0`` 表示不延时。halt 复位计时，父节点重启后重新计时。
     - ``<NonBlockingDelay msec="500"/>``

       ``bt_nodes/timer/non_blocking_delay_node.hpp``
   * - ``WaitUntilElapsed``
     - Condition
     - ``duration_ms:int=1000``
     - 首拍记录永久起点；到时前失败，到时后持续成功；``<=0`` 立即且持续成功。
     - 未到期时失败；普通 halt 不重置内部起点。
     - ``<WaitUntilElapsed duration_ms="2000"/>``

       ``bt_nodes/timer/wait_until_elapsed_condition_node.hpp``
   * - ``TimeCondition``
     - Condition
     - ``start_time:string="00:00:00"``；``end_time:string="23:59:59"``；``mode:string="range"``；``interval_sec:double=1800``
     - ``range`` 模式每天在 ``start_time``~``end_time`` 区间内成功；``interval`` 模式自首拍起每 ``interval_sec`` 秒放行一次。
     - 区间外或未到间隔时失败。时间源为 ``system_clock``（本地时区）。周期触发需由 ``KeepRunningUntilFailure`` 或 ``ReactiveSequence`` 包装。
     - ``<TimeCondition mode="interval" interval_sec="60"/>``

       ``bt_nodes/timer/time_condition_node.hpp``
   * - ``LogEvent``
     - Action
     - ``message:string=""``；``level:string="info"``
     - 输出 ``[INFO|WARN|ERROR] message``；error 走 stderr，其余走 stdout，随后成功。
     - 无失败路径；非法或空 level 回退为 info。枚举：``info warn error``。
     - ``<LogEvent message="battery low" level="warn"/>``

       ``bt_nodes/diagnostic/log_event_node.hpp``
   * - ``FunctionAction``
     - Action
     - ``function:string=""``；``input:string=""``；``output_key:string=""``
     - 调用单例注册表中的 Action 回调并原样返回其状态，包括 ``RUNNING``。
     - 空/未知函数或回调失败时失败；回调异常向外传播。
     - ``<FunctionAction function="robot.start" input="dock"/>``

       ``bt_nodes/function/function_registry.*``
   * - ``FunctionCondition``
     - Condition
     - ``function:string=""``；``input:string=""``；``output_key:string=""``
     - 调用 Condition 回调；true 映射为成功，false 映射为失败。
     - 空/未知函数、回调为 false 时失败；回调异常向外传播。
     - ``<FunctionCondition function="robot.ready"/>``

       ``bt_nodes/function/function_registry.*``

.. note::

   严格 XML 只接受节点 ``providedPorts()`` 中声明的属性；``name`` 是保留实例名。
   枚举 metadata 用于编辑器控件，运行时仍由节点实现处理非法值。字面量保存在节点
   自己的 ``port_values``，只有 ``{key}`` 重映射访问共享黑板。

bt_ros2
-------

ROS2 executor 默认注册 46 种节点：上述 bt_nodes 中的 27 种，加 19 种 ROS 专属节点
（graph/topic/service 条件与动作、ROS data 录入、导航与回充）。完整清单以
``bt_ros2/README.md`` 和 ``bt_ros2/src/node_registration.cpp`` 为准。

.. warning::

   ROS2 executor 复用的是 ``bt_nodes`` 中的 27 种，而 **不是** 全部 34 种。
   ``ReactiveSequence``、``ReactiveFallback``、``KeepRunningUntilFailure``、
   ``KeepRunningUntilSuccess``、``BlackboardGate``、``NonBlockingDelay`` 和
   ``TimeCondition`` 尚未加入 ``bt_ros2/src/node_registration.cpp``，因此目前
   只能在普通 ``bt_server`` 中执行。在 ROS2 树里使用它们会在严格 XML 载入阶段
   报未注册节点。

.. list-table:: ROS2 数据与回充节点
   :header-rows: 1
   :widths: 24 30 46

   * - 节点
     - 消息类型
     - 作用
   * - ``ReadBattery``
     - ``sensor_msgs/msg/BatteryState``
     - 把 ``percentage`` 写入黑板；订阅支持 ``qos_profile``。
   * - ``RosGraphCondition``
     - ROS graph
     - 按 ``entity_type`` 检查 node/topic/service/action 是否存在；每拍读取当前 graph。
   * - ``CallTriggerService``
     - ``std_srvs/srv/Trigger``
     - 异步调用无请求字段 service；等待时 ``RUNNING``，响应消息写黑板，支持超时和 halt 清理。
   * - ``CallSetBoolService``
     - ``std_srvs/srv/SetBool``
     - 异步发送 ``data``；以响应 ``success`` 决定终态，响应消息写黑板。
   * - ``ReadScalar``
     - ``std_msgs/msg/Float64``
     - 把 ``data`` 写入黑板。
   * - ``IsFlagTrue``
     - ``std_msgs/msg/Bool``
     - ``data=true`` 时成功。
   * - ``IsObstacleClose``
     - ``sensor_msgs/msg/Range``
     - ``range<threshold`` 时成功。
   * - ``RechargeTask``
     - ``std_msgs/msg/String`` + ``std_msgs/msg/Bool``
     - 每次尝试发布一条回充命令，跨 tick 等待 dock，支持超时、终态锁存和 halt/retry。
   * - ``TaskDoneNotifier``
     - ``std_msgs/msg/String``
     - 发布任务完成消息；可用 ``subscriber_wait_timeout_ms`` 等待观察者。
   * - ``IsDocked``
     - ``std_msgs/msg/Bool``
     - 旧 XML 兼容用对接条件。
   * - ``PublishRechargeCommand``
     - ``std_msgs/msg/String``
     - 旧 XML 兼容用一次性发布节点。

ROS2 订阅节点的公共端口是 ``topic``、``timeout_ms``、``qos_depth`` 和
``qos_profile``。监控节点健康时，推荐让目标节点周期发布 ``std_msgs/msg/Bool`` 心跳，
再用 ``IsFlagTrue timeout_ms="1500"`` 判断；超过时效窗口没有新消息就返回
``FAILURE``。这比只检查 ROS graph 中是否存在节点名更能反映回调是否仍在工作。

``RosTopicAction`` 可直接发布 ``std_msgs/msg/String``，端口为 ``topic`` 和 ``message``；
``message`` 既可填字面量，也可写 ``{key}`` 读取一个字符串黑板值。其他消息类型应继承
``RosOutputNode<MsgT>``，在 ``buildMsg`` 中构造消息。``TaskDoneNotifier`` 和
``PublishRechargeCommand`` 是这种模式的现成例子。

``RosGraphCondition`` 的 ``entity_name``、两个 service 节点的 ``service_name`` 都带
manifest ``editor_hint``。5173 编辑器连接能力网关后会按 node/topic/service/action 类型
展示实时候选，候选为空时仍允许手填。名称发现不改变 XML，也不替代 executor 的运行时校验。

.. code-block:: xml

   <Sequence name="start_tool">
     <RosGraphCondition entity_type="service" entity_name="/tool/enable"/>
     <CallSetBoolService service_name="/tool/enable" data="true"
                         timeout_sec="2.0" message="{tool_response}"/>
   </Sequence>

.. code-block:: xml

   <PrioritySelector name="planner_watchdog">
     <IsFlagTrue topic="/planner/healthy" timeout_ms="1500"/>
     <TickRate tier="background">
       <RosTopicAction topic="/bt/events" message="planner heartbeat missing"/>
     </TickRate>
   </PrioritySelector>

当前 ``./scripts/dev.sh`` 启动的普通 ``bt_server`` 只加载 34 个非 ROS 插件节点；它不能
执行需要 ``rclcpp::Node`` 句柄的 ROS2 节点。上述 ROS2 XML 由 ``BtExecutorNode`` 加载和
执行。ROS2 执行、心跳测试、消息发布和只读 Web 监视命令见 ``bt_ros2/README.md``。

打包的 ``bt_ros2/trees/recharge.xml`` 使用完整 ``RechargeTask``，不再用
``CooldownCondition + PublishRechargeCommand + IsDocked`` 编排。详见
:doc:`ros2_recharge_tutorial`。
