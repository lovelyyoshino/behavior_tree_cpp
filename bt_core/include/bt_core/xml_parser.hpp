// ============================================================================
//  bt_core/xml_parser.hpp
//  XmlParser —— 行为树的 XML 序列化/反序列化。
//
//  @author lovelyyoshino
//  @date 2026-06-30
//  @version v1.3.0
//  @last_modified 2026-08-18
//  @changelog
//    - v1.3.0 (2026-08-18): 多树源文档导出保留 SubTree/SubTreePlus 定义
//    - v1.2.0 (2026-08-18): 支持 TreeNodesModel/Blackboard 启动初值元数据
//    - v1.1.0 (2026-07-13): 增加全量结构/端口校验与确定性导出契约
//
//  设计说明：
//    采用兼容 BehaviorTree.CPP / Groot 的 XML 结构：
//
//      <root main_tree_to_execute="MainTree">
//        <BehaviorTree ID="MainTree">
//          <Sequence name="root_seq">
//            <SayHello msg="hi"/>
//            <Inverter>
//              <CheckBattery/>
//            </Inverter>
//          </Sequence>
//        </BehaviorTree>
//      </root>
//
//    可选的启动黑板值放在兼容元数据区，不会成为行为树节点：
//
//      <TreeNodesModel>
//        <Blackboard>
//          <Entry key="temperature" type="double" value="25.5"
//                 description="启动测试值"/>
//        </Blackboard>
//      </TreeNodesModel>
//
//    解析规则：
//      - 每个 XML 元素的“标签名”= 节点的注册名(registration name)，经 NodeFactory
//        实例化。
//      - 元素的 XML 属性 = 端口的“值或重映射”。属性值形如 "{key}" 表示重映射到
//        黑板 key；否则视为该节点私有的字面量初值。
//      - 子元素按出现顺序成为子节点(控制节点可多个，装饰节点恰一个)。
//      - 每个 BehaviorTree 恰有一个根节点；叶子不得包含子节点；XML 端口必须
//        在节点 manifest 中声明。错误会携带节点注册名、实例名与行号。
//
//    反序列化产出一棵展开后的可执行 Tree，同时保存源文档；含多个 BehaviorTree 或
//    SubTree 引用时，序列化保留原始定义/调用并刷新黑板初值元数据。
// ============================================================================
#ifndef BT_CORE_XML_PARSER_HPP
#define BT_CORE_XML_PARSER_HPP

#include <string>

#include "bt_core/node_factory.hpp"
#include "bt_core/tree.hpp"

namespace bt_core {

/**
 * @brief 行为树 XML 解析器。依赖一个已注册所需节点的 NodeFactory。
 */
class XmlParser {
public:
  /**
   * @param factory 已注册节点类型的工厂(反序列化按标签名建节点)。
   */
  explicit XmlParser(NodeFactory& factory) : factory_(factory) {}

  /**
   * @brief 从 XML 字符串构建一棵树。
   * @param xml_text XML 内容。
   * @param blackboard 可选共享黑板；为空时内部新建。
   * @return 构建好的 Tree。
   * @throws std::runtime_error XML 格式错误 / 节点未注册 / 结构非法。
   */
  Tree loadFromText(const std::string& xml_text,
                    Blackboard::Ptr blackboard = nullptr);

  /**
   * @brief 从 XML 文件构建一棵树。
   * @throws std::runtime_error 文件读取失败或解析失败。
   */
  Tree loadFromFile(const std::string& file_path,
                    Blackboard::Ptr blackboard = nullptr);

  /**
   * @brief 把一棵树序列化为 XML 字符串。
   * @param tree 要导出的树。
   * @param main_tree_id 主树 ID(写入 root 的 main_tree_to_execute)。
   * @return XML 文本。
   */
  std::string writeToText(const Tree& tree,
                          const std::string& main_tree_id = "MainTree");

  /**
   * @brief 把一棵树序列化并写入文件。
   * @throws std::runtime_error 文件写入失败。
   */
  void writeToFile(const Tree& tree, const std::string& file_path,
                   const std::string& main_tree_id = "MainTree");

private:
  NodeFactory& factory_;
};

}  // namespace bt_core

#endif  // BT_CORE_XML_PARSER_HPP
