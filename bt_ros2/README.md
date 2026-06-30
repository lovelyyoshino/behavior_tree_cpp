# bt_ros2 —— bt_core 行为树框架的可选 ROS2 wrapper

`bt_ros2` 是自研 C++17 行为树框架 **bt_core** 的一个**独立可选 ROS2(ament_cmake) 包**。
它把一棵 bt_core 行为树接到 ROS2 的「参数 / 话题 / 定时器」上，让行为树能在 ROS2
节点里周期运行，并把状态发布出去。

> 核心理念（见 `docs/design/architecture.md` 第 5 节）：
> **bt_core 始终零 ROS 依赖**；ROS2 能力以本可选包提供。不装 ROS2 时，bt_core /
> bt_nodes / bt_server 照常构建运行；本包仅在 `BT_BUILD_ROS2=ON` 或独立 colcon 工作区
> 中编译。

---

## 1. 设计：核心库零 ROS 依赖，本包是可选 wrapper

```
   ┌──────────────────────────────────────────┐
   │  bt_ros2 (本包, 仅 ROS2 环境编译)          │
   │   BtExecutorNode      ← rclcpp::Node       │
   │   RosTopicConditionNode / RosTopicActionNode│
   └───────────────▲────────────────────────────┘
                   │ 仅依赖 bt_core 的 C++ API（零 ROS）
   ┌───────────────┴────────────────────────────┐
   │  bt_core (C++17, 零 ROS 依赖)               │
   │   NodeFactory / Tree / XmlParser / Blackboard│
   └─────────────────────────────────────────────┘
```

**关键解耦点 —— ROS 句柄如何进入行为树节点：**

bt_core 的工厂只用 `make_shared<T>(name, NodeConfig)` 构造节点（见
`bt_core/include/bt_core/node_factory.hpp`），适配器节点在被创建时**拿不到**
`rclcpp::Node`。本包的桥接约定是：

1. `BtExecutorNode` 在建树前，把自身（`rclcpp::Node*`，**非拥有裸指针**）写入共享
   黑板的一个保留 key（`__bt_ros2_node_handle__`，见
   `include/bt_ros2/ros_blackboard_keys.hpp`）。
2. 适配器节点在**首次 tick** 时从黑板取出该指针，惰性创建 subscription / publisher。

> 为什么用裸指针：`Node → Tree → Blackboard`，若再把 `Node` 的 `shared_ptr` 存进黑板会
> 形成循环引用导致节点永不析构。节点生命周期天然长于它持有的树，裸指针安全且正确。

这样 bt_core 完全不知道 ROS 的存在，ROS 细节全部封装在 `bt_ros2` 内。

---

## 2. 包内容

| 文件 | 职责 |
|------|------|
| `include/bt_ros2/ros_blackboard_keys.hpp` | ROS 句柄经黑板传递的约定（set/get 辅助函数） |
| `include/bt_ros2/bt_executor_node.hpp` / `src/bt_executor_node.cpp` | **BtExecutorNode**：`rclcpp::Node` 子类，读参数→注册节点→加载 XML 树→定时器周期 tick→发布根状态 |
| `include/bt_ros2/ros_topic_condition_node.hpp` / `src/ros_topic_condition_node.cpp` | **RosTopicConditionNode**：订阅 `std_msgs/Bool`，把最新值映射成条件 SUCCESS/FAILURE |
| `include/bt_ros2/ros_topic_action_node.hpp` / `src/ros_topic_action_node.cpp` | **RosTopicActionNode**：tick 时向 `std_msgs/String` topic 发布消息（同步动作） |
| `src/main.cpp` | 可执行入口：`rclcpp::init` → `spin(BtExecutorNode)` |
| `launch/bt_executor.launch.py` | 示例 launch，演示参数传递 |
| `trees/example.xml` | 示例行为树（Sequence + 条件 + 动作） |
| `CMakeLists.txt` / `package.xml` | ament_cmake 构建与依赖声明 |

### BtExecutorNode 的 ROS2 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `tree_file` | string | `""`（**必填**） | 行为树 XML 文件路径，缺失则启动失败 |
| `tick_rate_hz` | double | `10.0` | 周期 tick 频率（Hz） |
| `status_topic` | string | `~/bt_status` | 发布根节点状态（IDLE/RUNNING/SUCCESS/FAILURE）的 topic |
| `autostart` | bool | `true` | 构造后是否自动开始 tick |

### 已注册的节点类型（XML 标签名）

- 来自 **bt_nodes**（header-only）：`Sequence`、`Fallback`、`Parallel`、`Inverter`、`Retry`
- 来自 **bt_ros2**：`RosTopicCondition`、`RosTopicAction`

---

## 3. 在 ROS2 环境构建

> 已在 ROS2 **Humble / Jazzy** 的依赖约定下编写（`rclcpp` / `rclcpp_action` / `std_msgs`、
> ament_cmake、`launch_ros`）。

### 方式 A：独立 colcon 工作区（推荐）

```bash
# 1) 准备工作区，把整个仓库放进 src/
mkdir -p ~/bt_ws/src
cp -r /path/to/behavior_tree_cpp ~/bt_ws/src/

# 2) source ROS2 环境
source /opt/ros/$ROS_DISTRO/setup.bash   # humble 或 jazzy

# 3) 构建
cd ~/bt_ws
colcon build --packages-select bt_ros2
#   ↑ 若提示找不到 bt::core，见下方“关于 bt_core 集成”
source install/setup.bash
```

**关于 bt_core 集成（两种方式，`CMakeLists.txt` 自适应）：**

- **find_package 方式**：要求 `bt_core` 安装后提供 `bt_coreConfig.cmake`。bt_core 当前
  仅 `add_library` + `bt::core` 别名，尚未导出 config，所以独立构建时默认走下面的源码方式。
  若要支持 `find_package(bt_core)`，需在 `bt_core/CMakeLists.txt` 补 `install(TARGETS bt_core
  EXPORT ...)` + `install(EXPORT ...)` 并生成 config 文件。
- **源码子目录方式（默认回退）**：本包 `CMakeLists.txt` 在找不到 `bt::core` target 时，
  会自动把同级的 `../bt_core` 作为 `add_subdirectory` 纳入。可用
  `-DBT_CORE_DIR=<bt_core 源码目录>` 覆盖路径：

  ```bash
  colcon build --packages-select bt_ros2 \
    --cmake-args -DBT_CORE_DIR=$HOME/bt_ws/src/behavior_tree_cpp/bt_core
  ```

### 方式 B：作为主仓库子目录构建（非 colcon）

顶层 CMake 已有 `option(BT_BUILD_ROS2 ...)`，在已 source ROS2 的终端里：

```bash
cd /path/to/behavior_tree_cpp
cmake -S . -B build -DBT_BUILD_ROS2=ON
cmake --build build -j
```

此时顶层已 `add_subdirectory(bt_core)`，`bt::core` target 已存在，本包直接复用
（无需 find_package）。注意：此方式不产出 ament 安装布局，`ros2 launch` 找包仍建议用方式 A。

---

## 4. 运行

```bash
source /opt/ros/$ROS_DISTRO/setup.bash
source ~/bt_ws/install/setup.bash

# 用 launch（默认加载本包 share 里的 trees/example.xml，2Hz）
ros2 launch bt_ros2 bt_executor.launch.py

# 或直接 run，手动传参
ros2 run bt_ros2 bt_executor --ros-args \
  -p tree_file:=$(ros2 pkg prefix bt_ros2)/share/bt_ros2/trees/example.xml \
  -p tick_rate_hz:=2.0
```

### 观察与交互

```bash
# 看根状态
ros2 topic echo /bt_executor/bt_status

# 看动作节点发布的问候
ros2 topic echo /bt/chatter

# 给条件节点喂数据（/robot/ready 为 true → 条件 SUCCESS）
ros2 topic pub /robot/ready std_msgs/msg/Bool "{data: true}"
```

示例树两步都成功后，`BtExecutorNode` 会打印终结状态并停止定时器（跑完一轮即停）。
如需「无限循环执行」，见 `bt_executor_node.cpp::onTick()` 末尾注释（删掉终结即停那段即可）。

---

## 5. 扩展：把 ROS2 Action 桥接成异步 BT 节点

`RosTopicActionNode` 是最简单的**同步**动作（发一条 topic 即 SUCCESS）。要桥接长耗时的
ROS2 Action，标准范式（见 `src/ros_topic_action_node.cpp` 末尾注释）：

1. 首拍：用 `rclcpp_action::Client` 发送 goal，保存 future，返回 `RUNNING`；
2. 后续拍：轮询结果 —— 未就绪 `RUNNING`，成功 `SUCCESS`，失败/取消 `FAILURE`；
3. 重写 `onHalted()`：`async_cancel_goal()` 取消未完成的 goal。

`rclcpp_action` 已在 `package.xml` / `CMakeLists.txt` 声明依赖，可直接使用。

---

## 6. 验证状态（诚实声明）

> 本包是在**没有 ROS2 的机器上**编写的（`ROS_DISTRO` 未设置，无 `colcon` / `rclcpp`），
> 因此**未能在本机做 colcon 实编译验证**，需在装有 ROS2 humble/jazzy 的环境中实测。

本机已做的检查：
- ✅ 不依赖 rclcpp 的纯逻辑（`ros_blackboard_keys.hpp` 对接真实 bt_core 头）通过 `clang++ -std=c++17 -fsyntax-only` 语法检查；
- ✅ `package.xml` / `trees/example.xml` XML 良构性校验；
- ✅ `launch/bt_executor.launch.py` 通过 `python3 -m py_compile`；
- ✅ 所有对 bt_core 的 API 调用严格对照 `docs/design/API_CONTRACT.md`（工厂/树/XmlParser/黑板签名）。

待用户在 ROS2 环境验证：
- ⏳ rclcpp / rclcpp_action / std_msgs 相关的编译与链接（`colcon build`）；
- ⏳ `ros2 launch` 实跑、topic 收发、根状态发布。
