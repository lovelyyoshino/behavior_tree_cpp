// ============================================================================
//  bt_core/src/xml_parser.cpp
//  XmlParser 实现 —— 基于 tinyxml2。
//
//  反序列化流程：
//    root -> 找到 main_tree_to_execute 指定的 <BehaviorTree> -> 递归 build。
//    递归 build 一个 XML 元素：
//      1) 标签名 = 注册名，用 factory 建节点；
//      2) 属性 -> 端口：值形如 "{k}" 记为重映射 port->k；否则字面量写入黑板;
//      3) 子元素递归 build，按节点族(控制/装饰)挂接。
//
//  序列化流程：
//    深度优先把每个节点写成同名标签，端口重映射写回 "{k}" 形式属性。
// ============================================================================
#include "bt_core/xml_parser.hpp"

#include <fstream>
#include <sstream>
#include <stdexcept>

#include "tinyxml2.h"

namespace bt_core {

using namespace tinyxml2;

namespace {

// 从一个 XML 元素递归构建节点。
TreeNode::Ptr buildNode(const XMLElement* elem, NodeFactory& factory,
                        Blackboard::Ptr bb) {
  const std::string reg_name = elem->Name();

  // 实例名：可由 name 属性指定，否则用注册名。
  std::string inst_name = reg_name;
  if (const char* n = elem->Attribute("name")) {
    inst_name = n;
  }

  // 解析属性 -> 端口映射 / 字面量。
  NodeConfig cfg;
  cfg.blackboard = bb;
  for (const XMLAttribute* attr = elem->FirstAttribute(); attr;
       attr = attr->Next()) {
    const std::string key = attr->Name();
    if (key == "name") continue;  // name 是保留属性，非端口
    const std::string val = attr->Value();
    if (val.size() >= 2 && val.front() == '{' && val.back() == '}') {
      // "{bb_key}" -> 端口重映射到黑板 key
      cfg.port_remap[key] = val.substr(1, val.size() - 2);
    } else {
      // 字面量：仅存入节点本地 port_values(私有端口语义)。
      // 不写共享黑板——否则多个同名端口(如两个 PrintMessage 的 message)会互相
      // 覆盖。getInput<T>() 会优先读本地字面量。序列化时也从 port_values 还原。
      cfg.port_values[key] = val;
    }
  }

  TreeNode::Ptr node = factory.createNode(reg_name, inst_name, cfg);

  // 递归挂接子节点。
  if (auto* ctrl = dynamic_cast<ControlNode*>(node.get())) {
    for (const XMLElement* child = elem->FirstChildElement(); child;
         child = child->NextSiblingElement()) {
      ctrl->addChild(buildNode(child, factory, bb));
    }
  } else if (auto* deco = dynamic_cast<DecoratorNode*>(node.get())) {
    const XMLElement* child = elem->FirstChildElement();
    if (!child) {
      throw std::runtime_error("装饰节点 '" + reg_name + "' 缺少子节点");
    }
    deco->setChild(buildNode(child, factory, bb));
    if (child->NextSiblingElement()) {
      throw std::runtime_error("装饰节点 '" + reg_name + "' 只能有一个子节点");
    }
  }
  // 叶子节点无子节点。

  return node;
}

// 递归把节点写成 XML 元素。
void writeNode(const TreeNode::Ptr& node, XMLElement* parent,
               XMLDocument& doc) {
  // 标签名用注册名(无则退化为实例名)。
  const std::string tag = node->registrationName().empty()
                              ? node->name()
                              : node->registrationName();
  XMLElement* elem = doc.NewElement(tag.c_str());

  // 实例名与注册名不同才写 name 属性。
  if (!node->name().empty() && node->name() != tag) {
    elem->SetAttribute("name", node->name().c_str());
  }

  // 端口重映射写回 "{k}" 属性。
  for (const auto& [port, key] : node->config().port_remap) {
    elem->SetAttribute(port.c_str(), ("{" + key + "}").c_str());
  }
  // 字面量端口值原样写回属性(保证 round-trip 不丢失)。
  for (const auto& [port, value] : node->config().port_values) {
    elem->SetAttribute(port.c_str(), value.c_str());
  }

  parent->InsertEndChild(elem);

  // 递归子节点。
  if (auto* ctrl = dynamic_cast<ControlNode*>(node.get())) {
    for (const auto& c : ctrl->children()) writeNode(c, elem, doc);
  } else if (auto* deco = dynamic_cast<DecoratorNode*>(node.get())) {
    if (deco->child()) writeNode(deco->child(), elem, doc);
  }
}

}  // namespace

// ------------------------------ 反序列化 ------------------------------------

Tree XmlParser::loadFromText(const std::string& xml_text,
                             Blackboard::Ptr blackboard) {
  XMLDocument doc;
  if (doc.Parse(xml_text.c_str()) != XML_SUCCESS) {
    throw std::runtime_error(std::string("XML 解析失败: ") + doc.ErrorStr());
  }

  const XMLElement* root = doc.FirstChildElement("root");
  if (!root) {
    throw std::runtime_error("XML 缺少 <root> 元素");
  }

  // 选定主树：优先 main_tree_to_execute 指定的；否则取第一个 <BehaviorTree>。
  const char* main_id = root->Attribute("main_tree_to_execute");
  const XMLElement* bt = nullptr;
  for (const XMLElement* e = root->FirstChildElement("BehaviorTree"); e;
       e = e->NextSiblingElement("BehaviorTree")) {
    if (main_id) {
      if (const char* id = e->Attribute("ID")) {
        if (std::string(id) == main_id) { bt = e; break; }
      }
    } else {
      bt = e;
      break;
    }
  }
  if (!bt) {
    throw std::runtime_error("找不到目标 <BehaviorTree>");
  }

  const XMLElement* root_node_elem = bt->FirstChildElement();
  if (!root_node_elem) {
    throw std::runtime_error("<BehaviorTree> 为空");
  }

  auto bb = blackboard ? blackboard : Blackboard::create();
  TreeNode::Ptr root_node = buildNode(root_node_elem, factory_, bb);
  return Tree(root_node, bb);
}

Tree XmlParser::loadFromFile(const std::string& file_path,
                             Blackboard::Ptr blackboard) {
  std::ifstream ifs(file_path);
  if (!ifs) {
    throw std::runtime_error("无法打开文件: " + file_path);
  }
  std::stringstream ss;
  ss << ifs.rdbuf();
  return loadFromText(ss.str(), blackboard);
}

// ------------------------------- 序列化 -------------------------------------

std::string XmlParser::writeToText(const Tree& tree,
                                   const std::string& main_tree_id) {
  XMLDocument doc;
  XMLElement* root = doc.NewElement("root");
  root->SetAttribute("main_tree_to_execute", main_tree_id.c_str());
  doc.InsertEndChild(root);

  XMLElement* bt = doc.NewElement("BehaviorTree");
  bt->SetAttribute("ID", main_tree_id.c_str());
  root->InsertEndChild(bt);

  if (tree.root()) {
    writeNode(tree.root(), bt, doc);
  }

  XMLPrinter printer;
  doc.Print(&printer);
  return printer.CStr();
}

void XmlParser::writeToFile(const Tree& tree, const std::string& file_path,
                            const std::string& main_tree_id) {
  std::ofstream ofs(file_path);
  if (!ofs) {
    throw std::runtime_error("无法写入文件: " + file_path);
  }
  ofs << writeToText(tree, main_tree_id);
}

}  // namespace bt_core
