ROS2 回充教程
==============

目标
----

本教程演示一个完整可复用流程：

1. 从外部 ROS2 topic 接收 ``sensor_msgs/msg/BatteryState``。
2. ``ReadBattery`` 把 ``percentage`` 写入行为树黑板。
3. 普通数据节点判断电量是否低。
4. 低电量时通过 ``PublishRechargeCommand`` 发布 ``std_msgs/msg/String`` 回充命令。
5. ``IsDocked`` 监听对接状态，成功后 ``TaskDoneNotifier`` 发布完成通知。

.. image:: _static/ros2_recharge_flow.svg
   :alt: ROS2 回充数据流
   :width: 100%

涉及文件
--------

.. list-table::
   :header-rows: 1
   :widths: 35 65

   * - 文件
     - 作用
   * - ``bt_ros2/include/bt_ros2/example_data_nodes.hpp``
     - 定义 ``ReadBattery``、``PublishRechargeCommand``、``IsDocked``、``TaskDoneNotifier``。
   * - ``bt_ros2/include/bt_ros2/node_registration.hpp``
     - 暴露默认注册入口和可扩展注册 catalog。
   * - ``bt_ros2/src/node_registration.cpp``
     - 注册 bt_nodes、ROS topic 节点、数据节点和回充节点。
   * - ``bt_ros2/src/bt_executor_node.cpp``
     - 创建 ``NodeFactory``，调用 ``registerDefaultNodes(factory_)``，再加载 XML。
   * - ``bt_ros2/trees/recharge.xml``
     - 完整回充行为树示例。
   * - ``tests/test_ros_bases.cpp``
     - 非 ROS 环境下用 mock rclcpp 覆盖数据链路。

外部消息如何进入黑板
--------------------

``ReadBattery`` 继承 ``RosInputNode<sensor_msgs::msg::BatteryState>``，只需要实现 ``onData``：

.. code-block:: cpp

   void onData(const sensor_msgs::msg::BatteryState& msg) override {
     setOutput<double>("level", static_cast<double>(msg.percentage));
   }

在 XML 里把输出端口重映射到黑板 key：

.. code-block:: xml

   <ReadBattery topic="/battery"
                timeout_ms="2000"
                level="{battery_level}"/>

此后普通节点可以继续读取 ``battery_level``，不需要知道 ROS2 消息类型。

低电量如何触发回充命令
----------------------

示例树使用 ``CompareBlackboard`` 判断电量，然后发布命令：

.. literalinclude:: ../bt_ros2/trees/recharge.xml
   :language: xml
   :caption: bt_ros2/trees/recharge.xml

关键片段：

.. code-block:: xml

   <CompareBlackboard key="battery_level" op="lt" value="0.30"/>
   <PublishRechargeCommand topic="/robot/command"
                           command="start_recharge"
                           target="main_dock"/>

``PublishRechargeCommand`` 继承 ``RosOutputNode<std_msgs::msg::String>``，只实现消息构造：

.. code-block:: cpp

   bool buildMsg(std_msgs::msg::String& out) override {
     const std::string command =
         getInput<std::string>("command").value_or("start_recharge");
     const std::string target =
         getInput<std::string>("target").value_or("main_dock");
     out.data = command + ":" + target;
     return true;
   }

默认注册如何工作
----------------

``BtExecutorNode`` 不再手写一小部分节点，而是调用统一入口：

.. code-block:: cpp

   bt_ros2::registerDefaultNodes(factory_);

``NodeRegistrationCatalog`` 是单例 catalog，默认包含：

* ``registerBtNodes``
* ``registerRosTopicNodes``
* ``registerRosDataNodes``
* ``registerRechargeNodes``

如果你的项目要加一组专用节点，可以在 executor 构造前追加注册函数：

.. code-block:: cpp

   bt_ros2::NodeRegistrationCatalog::instance().add(registerMyRobotNodes);

真实 ROS2 环境运行
------------------

.. code-block:: bash

   source /opt/ros/$ROS_DISTRO/setup.bash
   colcon build --packages-select bt_ros2
   source install/setup.bash
   ros2 launch bt_ros2 bt_executor.launch.py \
     tree_file:=$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/recharge.xml \
     stop_on_terminal:=false

可以用 topic 命令模拟输入：

.. code-block:: bash

   ros2 topic pub /battery sensor_msgs/msg/BatteryState "{percentage: 0.18}"
   ros2 topic echo /robot/command
   ros2 topic pub /dock/is_docked std_msgs/msg/Bool "{data: true}"
   ros2 topic echo /bt/task_done

本机验证边界
------------

当前开发机没有 ROS2/rclcpp/colcon，因此真机 topic 收发不在本机声明完成。非 ROS 覆盖包括：

* mock rclcpp 编译 ``node_registration`` 公开头和实现。
* ``RosBasesTest.RechargeTreeConsumesBatteryMsgAndPublishesCommand`` 覆盖外部消息、黑板写入和命令发布。
* ``RosBasesTest.RechargeCommandAndDoneNotifierExposeManualPorts`` 覆盖回充节点端口 manifest。
* XML 解析检查覆盖 ``bt_ros2/trees/recharge.xml``。

