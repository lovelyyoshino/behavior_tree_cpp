单树优先级与分级 Tick 调度
===========================

目标与结论
----------

本项目使用一棵行为树作为唯一决策器。ROS 回调只更新输入快照，行为状态只在
``Tree::tickOnce()`` 边界内推进，避免多个状态机线程直接争抢执行权。

.. list-table:: 当前能力审计
   :header-rows: 1
   :widths: 24 18 58

   * - 能力
     - 状态
     - 代码证据
   * - 单线程行为树
     - 已实现
     - ``bt_ros2/src/main.cpp`` 显式使用 ``SingleThreadedExecutor``；
       ``BtExecutorNode`` 还用执行锁串行化 tick、服务和调试入口。
   * - 回调与 tick 隔离
     - 已实现
     - ``RosSubscriberNodeBase`` 和 ``RosTopicConditionNode`` 的回调只写线程安全快照，
       tick 复制快照后再访问黑板或业务状态。
   * - 输入优先级与抢占
     - 已实现
     - ``PrioritySelector`` 每拍从最高优先级分支重新评估，并 halt 被抢占的低优先级
       ``RUNNING`` 分支。
   * - tick 分级
     - 已实现
     - ``TickRate`` 提供 ``critical``、``normal``、``background`` 三档及自定义周期。
   * - 后台可视化编辑
     - 已实现
     - 两个调度节点经 ``/api/nodes`` 暴露；编辑器可连线、编辑 tier、校验、保存、
       加载、单拍和 Run。
   * - 复杂任务编排
     - 已实现
     - ``PrioritySelector``、``Sequence``、``Retry``、``Parallel`` 和 ``TickRate`` 可在
       单一根树内嵌套；原始 XML 仍支持 ``SubTree`` 展开。

调度模型
--------

.. code-block:: text

   ROS callbacks / service callbacks
               |
               v
       thread-safe input snapshots
               |
               |  one deterministic boundary
               v
   SingleThreadedExecutor -> Tree::tickOnce()
               |
               v
      PrioritySelector (high -> low)
          |          |           |
       critical    normal     background
       every tick  /2 ticks     /5 ticks

这里的 ``Parallel`` 是同一线程内依次 tick 多个子节点的逻辑并行，不会创建工作线程。
长耗时动作必须首拍发起异步操作并返回 ``RUNNING``，后续拍检查结果；不能在 tick 内
阻塞等待。

.. _single-executor-constraint:

**单执行器硬约束**：``rclcpp::Node`` 一次只能挂到一个 executor。节点内不得自建
``SingleThreadedExecutor`` 或调用 ``spin()``/``spin_some()``——那等于为同一节点挂第二个
执行器，回调会改在另一线程派发，与主 tick 争抢树状态。动作客户端（如
``FollowPath``）的 response/result 回调由 ``main.cpp`` 的主执行器派发，节点只读取回调
写入的快照。历史上 ``FollowPathNode`` 曾自带 ``spin_some()``，v1.1.0 已移除。

输入分级与抢占
--------------

``PrioritySelector`` 的子节点顺序就是输入优先级，XML 越靠前优先级越高。编辑器导出
时按画布 x 坐标从左到右写子节点，所以同一父节点下应把高优先级分支放在左侧。

每个分支建议使用 ``Sequence(条件, 动作...)``。条件读取最新输入快照；当高优先级条件
由失败变为成功时，该分支会在下一拍获得执行权，之前处于 ``RUNNING`` 的低优先级分支
会收到 ``halt()``。可抢占动作必须在 ``onHalted()`` 中取消外部 goal、释放资源并清理本轮
状态。

.. code-block:: xml

   <PrioritySelector name="task_scheduler">
     <Sequence name="emergency_branch">
       <RosTopicCondition topic="/emergency" default="false"/>
       <FunctionAction function="robot.emergency_stop"/>
     </Sequence>
     <Sequence name="mission_branch">
       <IsFlagTrue topic="/mission/ready" timeout_ms="500"/>
       <FunctionAction function="robot.run_mission"/>
     </Sequence>
     <TickRate name="maintenance_branch" tier="background">
       <FunctionAction function="robot.maintenance"/>
     </TickRate>
   </PrioritySelector>

``Fallback`` 仍适合“当前方案运行期间不要重新检查更高分支”的记忆型降级流程；需要
输入抢占时必须使用 ``PrioritySelector``。

Tick 分级
---------

``TickRate`` 是装饰节点，必须恰好包一个子节点或子树。

.. list-table:: 默认档位
   :header-rows: 1
   :widths: 28 24 48

   * - ``tier``
     - 子树执行周期
     - 典型用途
   * - ``critical``
     - 每个父 tick
     - 急停、安全条件、控制闭环输入。
   * - ``normal``
     - 每 2 个父 tick
     - 普通任务状态、规划进度。
   * - ``background``
     - 每 5 个父 tick
     - 诊断、维护、低频统计。

``every_n_ticks`` 大于 0 时覆盖档位默认值。例如：

.. code-block:: xml

   <TickRate tier="background" every_n_ticks="20">
     <LogEvent level="info" message="periodic health report"/>
   </TickRate>

首拍总会执行。跳过拍只保留子节点上次状态，不创建线程，也不推进子节点内部状态。
周期按“该 TickRate 收到的父 tick 数”计算，不是墙上时间。ROS 基准频率由
``tick_rate_hz`` 决定；若父分支本身没有被选择，内部 TickRate 也不会累计。

复杂任务的单树组织
------------------

推荐固定一棵根调度树：顶层只负责优先级，分支内部负责业务阶段。

.. code-block:: text

   PrioritySelector
   +-- emergency Sequence
   +-- teleop Sequence
   +-- autonomous Sequence
   |   +-- perception TickRate(critical)
   |   +-- planning TickRate(normal)
   |   +-- execution Retry(...)
   +-- maintenance TickRate(background)

状态机不再各自启动调度线程。每个有状态 Action 只维护自身 phase，并通过
``RUNNING/SUCCESS/FAILURE`` 把控制权交还父节点；顶层选择器负责唯一的切换与抢占。
这使状态变化顺序、状态回调和编辑器节点高亮都与同一个 DFS 节点序列一致。

后台与编辑器使用
----------------

启动真实插件后端和编辑器：

.. code-block:: bash

   ./scripts/dev.sh

编辑流程：

1. 桌面端把 Control 组的 ``PrioritySelector`` 和 Decorator 组的 ``TickRate`` 从节点面板
   拖到画布；触控端可点击面板条目添加。
2. 在画布中直接拖动节点调整位置。连接时从父节点底部连接桩拖到子节点顶部连接桩；
   叶子节点、装饰节点单子约束、重复父节点和环路会被界面拒绝。
3. 将高优先级分支放在父节点左侧。XML 导出按兄弟节点的 x 坐标从左到右排序，位置
   因此会直接决定 ``PrioritySelector`` 的抢占顺序。
4. 单击 ``TickRate``，在属性面板选择 ``tier``；需要精确周期时填写
   ``every_n_ticks``，下方 XML 预览会立即同步。
5. 用“后端校验”确认装饰节点数量和端口合法，再“载入到服务器”。
6. Tick 会继续执行后端当前树，不自动重载，这样 ``RUNNING``、``Retry``、``Counter`` 等
   跨拍状态不会丢失；编辑画布后要先重新“载入到服务器”。
7. Run 会先把当前画布自动载入后端，再从头运行到终态，因此不会再因后端尚无树而返回
   ``404``；它只用于能快速到终态的离线树。
8. 用 workspace 保存接口持久化 XML；真实 ROS 长任务使用周期执行器，不用 HTTP
   ``/api/tree/run`` 模拟墙上时间。

可直接载入 ``examples/trees/priority_tick_scheduler.xml`` 查看完整结构。

Yuyi 专用树接入前检查
----------------------

用户项目中常见的 ``SubTreePlus``、``RunOnZoneTransition``、``TimeCondition``、
``FollowPath`` 和 ROS2 service/action 节点不属于本仓库当前默认注册目录。编辑器的“自定义
XML 节点”可以先搭建它们的结构并填写任意属性，但不会凭名称伪造执行能力：严格 XML 解析
仍会检查普通节点的注册名和 ``providedPorts()``，普通 ``bt_server`` 只加载 34 个
``bt_nodes`` 节点，ROS2 节点则必须由 ``BtExecutorNode`` 注册并提供真实的 ``rclcpp::Node``
句柄。

这份 Yuyi XML 还需要注意以下兼容性差异：

* 解析器支持 ``<SubTree ID="..."/>`` 和 ``<SubTreePlus ID="..." .../>``；后者会把
  ``foo="{bar}"`` 解释为子树内部 ``{foo}`` 到父黑板 ``bar`` 的映射。普通 ``SubTree``
  仍只允许 ``ID``，避免把未声明的属性静默吞掉。
* ``Parallel`` 同时接受 ``success_count/failure_count`` 和
  ``success_threshold/failure_threshold``；同一棵树不要同时填写两组，适配层会优先使用
  canonical 端口的非默认值。
* 以下节点必须在实现中声明全部 XML 属性，否则会在加载阶段失败：
  ``TimeCondition``、``NonBlockingDelay``、``KeepRunningUntilFailure``、
  ``FollowPath``、``LoadYuyiPath``、``ObstacleSpeedLimiter``、
  ``CallTriggerService``、``CallSetBoolService``、``SetObstacleDetection``、
  ``DetectCurrentMapZone``、``IsRemainingPathWithin`` 和
  ``IsPathProgressAtLeast``。

多层嵌套本身没有问题，建议按“调度、路线、策略、资源”四层拆分，每一层只承担一种
职责：

.. code-block:: text

   ProductionScheduler
   +-- TimeWindow + RouteLock
       +-- ScheduledRoute
           +-- FollowRoute
           +-- ObstaclePolicyMonitor
           +-- ZoneToolPolicy

每个自定义节点在合入前至少要写清楚下面的状态契约：

* 长耗时 ROS2 action/service：首拍只发起请求并返回 ``RUNNING``，后续拍检查 future
  或结果；``halt()`` 必须取消请求、释放句柄并且不能重复发送 goal。
* ``KeepRunningUntilFailure``、``NonBlockingDelay`` 等装饰/计时节点：明确
  ``SUCCESS``、``FAILURE``、``RUNNING`` 的转换，以及 ``halt()`` 是否重置计时和子树。
* ``RunOnZoneTransition``：明确首次采样是否算进入、进入/离开各执行一次还是允许
  重复执行、action 处于 ``RUNNING`` 时是否锁住下一次 transition，以及服务失败是否
  影响主路线。XML 中的 ``expected`` 与 ``expected_zones`` 也应统一成一个端口名。
* 清理节点：若节点的职责是“只在 halt 时清理”，首拍必须保持 ``RUNNING``；如果首拍
  返回 ``SUCCESS``，在 ``Parallel success_count="1"`` 下可能立即结束整条路线。更稳妥
  的方式是用 ``Finally/AlwaysCleanup`` 装饰器，并同时覆盖正常成功、失败和 halt 三条
  路径。

区域监控和路线执行不要同时直接写同一个 ``obstacle_speed_limiter`` 参数集，工具电机
 service 也不要由多个并行分支争抢。推荐让一个 ``ObstaclePolicy``/``ToolPolicy`` 节点
 按固定优先级（未开始、近目标、禁用区域、正常行驶）计算最终策略，再由唯一所有者
 写参数和发布 ``cmd_vel``。辅助监控若使用 ``ForceSuccess``，至少应把服务失败写入
 黑板并发布诊断事件，避免把“主路线继续运行”误认为“工具控制成功”。

当前工程的 ``SubTree`` 展开深度上限为 32 层，并带循环引用检查；普通控制节点的嵌套
没有这个固定层数限制，但深度越深越难审计。通常把每个业务阶段拆成一个子树即可，
不要为了减少 XML 行数把多个独立资源控制器再包进一层通用装饰器。

边界与约束
----------

* ``Blackboard`` 仍由行为树线程拥有；ROS 回调不得直接写黑板或调用节点 ``tick()``。
* ``TickRate`` 不是实时调度器，不承诺操作系统线程优先级或硬实时 deadline。
* 调试 override、start/stop/reload 与周期 tick 已串行化，但自定义节点内部启动的线程
  仍必须自行处理取消、生命周期和数据同步。
* ``bt_server`` 用互斥锁串行化当前树的 load/tick/run/export；它适合编辑和离线验证，
  生产 ROS 调度由 ``BtExecutorNode`` 负责。

HTTP 404 排查
--------------------

``POST /api/tree/tick`` 在后端尚无树时会返回 ``404`` 和
``当前没有已加载的树``。这不是路由缺失：先点击“载入到服务器”，再连续 Tick。
当前版本的 Run 会自动同步画布；若 Run 仍显示没有该路由，通常是旧的 Vite 产物或旧
``bt_server`` 进程仍在运行，停止后重新执行 ``./scripts/dev.sh`` 并刷新浏览器。

可用以下命令区分“代理/进程错误”和“只是没有载入树”：

.. code-block:: bash

   curl -i http://127.0.0.1:8080/api/health
   curl -i -X POST http://127.0.0.1:8080/api/tree/tick

第一条应返回 ``200`` 和版本；第二条在未载入时应返回带具体 ``error`` 的 ``404``。
编辑器现在会把这个 JSON 错误原因一并显示，不再只给出状态码。
