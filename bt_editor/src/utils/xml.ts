/**
 * xml.ts - behavior-tree canvas/XML bidirectional conversion.
 *
 * @author pony
 * @date 2026-06-30
 * @version v1.2.0
 * @last_modified 2026-08-18
 * @changelog
 *   - v1.4.0 (2026-08-21): import XML or a strictly bound tree/blackboard bundle
 *   - v1.3.0 (2026-08-18): normalize and validate blackboard values at the XML boundary
 *   - v1.2.0 (2026-08-18): support complete multi-BehaviorTree document round trips
 *   - v1.1.0 (2026-08-18): support TreeNodesModel/Blackboard initial metadata
 */

import type {
  BlackboardEntry,
  BehaviorTreeDefinition,
  BehaviorTreeDocument,
  ImportedTreeArtifact,
  BtEdge,
  BtNode,
  BtNodeData,
  NodeKind,
  NodeManifest,
  PortManifest,
  TreeBundle,
} from '../types';

function buildChildrenMap(nodes: BtNode[], edges: BtEdge[]): Map<string, string[]> {
  const posById = new Map(nodes.map((node) => [node.id, node.position.x]));
  const childrenMap = new Map<string, string[]>();
  for (const edge of edges) {
    const children = childrenMap.get(edge.source) ?? [];
    children.push(edge.target);
    childrenMap.set(edge.source, children);
  }
  for (const children of childrenMap.values()) {
    children.sort((left, right) => (posById.get(left) ?? 0) - (posById.get(right) ?? 0));
  }
  return childrenMap;
}

/** Return the only node without an incoming edge, or null for an invalid graph. */
export function findRootId(nodes: BtNode[], edges: BtEdge[]): string | null {
  if (nodes.length === 0) return null;
  const hasParent = new Set(edges.map((edge) => edge.target));
  const roots = nodes.filter((node) => !hasParent.has(node.id));
  return roots.length === 1 ? roots[0].id : null;
}

/** DFS order used by both XML output and runtime status matching. */
export function dfsPreorderIds(nodes: BtNode[], edges: BtEdge[]): string[] {
  const rootId = findRootId(nodes, edges);
  if (rootId === null) return [];
  const childrenMap = buildChildrenMap(nodes, edges);
  const order: string[] = [];
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    order.push(id);
    for (const childId of childrenMap.get(id) ?? []) visit(childId);
  }
  visit(rootId);
  return order;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * XML names used by the editor intentionally exclude namespace prefixes.  The
 * runtime accepts arbitrary registration strings, but a malformed custom tag
 * or attribute cannot be represented in a portable XML document.
 */
export function isValidXmlName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value.trim());
}

function renderTree(tree: BehaviorTreeDefinition): string[] {
  const rootId = findRootId(tree.nodes, tree.edges);
  if (rootId === null) {
    throw new Error(`导出失败：树 ${tree.id} 必须有且仅有一个根节点`);
  }
  const nodeById = new Map(tree.nodes.map((node) => [node.id, node]));
  if (nodeById.size !== tree.nodes.length) {
    throw new Error(`导出失败：树 ${tree.id} 存在重复节点 ID`);
  }
  for (const edge of tree.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      throw new Error(`导出失败：树 ${tree.id} 存在指向未知节点的连线`);
    }
  }

  const childrenMap = buildChildrenMap(tree.nodes, tree.edges);
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function renderNode(id: string, indent: string): string {
    if (visiting.has(id)) throw new Error(`导出失败：树 ${tree.id} 存在循环连线`);
    if (visited.has(id)) throw new Error(`导出失败：树 ${tree.id} 的节点存在多个父节点`);
    const node = nodeById.get(id);
    if (!node) throw new Error(`导出失败：树 ${tree.id} 找不到节点 ${id}`);
    visiting.add(id);
    visited.add(id);

    const tag = node.data.registrationName.trim();
    if (!tag) throw new Error(`导出失败：树 ${tree.id} 存在空节点注册名`);
    if (!isValidXmlName(tag)) {
      throw new Error(`导出失败：节点注册名不是合法 XML 名称：${tag}`);
    }
    const attrs: string[] = [];
    if (node.data.instanceName) {
      attrs.push(`name="${escapeAttr(node.data.instanceName)}"`);
    }
    for (const [portName, portValue] of Object.entries(node.data.portValues)) {
      if (!isValidXmlName(portName)) {
        throw new Error(`导出失败：节点 ${tag} 包含非法 XML 属性名：${portName}`);
      }
      if (portValue !== '') attrs.push(`${portName}="${escapeAttr(portValue)}"`);
    }
    const attrText = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
    const children = childrenMap.get(id) ?? [];
    const result = children.length === 0
      ? `${indent}<${tag}${attrText}/>`
      : `${indent}<${tag}${attrText}>\n${children
          .map((childId) => renderNode(childId, `${indent}  `))
          .join('\n')}\n${indent}</${tag}>`;
    visiting.delete(id);
    return result;
  }

  const body = renderNode(rootId, '    ');
  if (visited.size !== tree.nodes.length) {
    throw new Error(`导出失败：树 ${tree.id} 含有未连接到根节点的节点`);
  }
  return [`  <BehaviorTree ID="${escapeAttr(tree.id)}">`, body, '  </BehaviorTree>'];
}

const BLACKBOARD_TYPES: readonly BlackboardEntry['type'][] = [
  'string',
  'bool',
  'int',
  'double',
];
const INTEGER_LITERAL = /^[+-]?\d+$/;
const DOUBLE_LITERAL = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

/**
 * Normalize the editor/API representation before it crosses the XML boundary.
 * Keeping this in the serializer prevents callers other than App from emitting
 * a document that the C++ parser will reject later.
 */
export function normalizeBlackboardEntries(entries: BlackboardEntry[]): BlackboardEntry[] {
  const seenKeys = new Set<string>();
  return entries.map((entry) => {
    const key = entry.key.trim();
    if (!key) throw new Error('黑板参数存在空键名，请先补全或删除该行');
    if (seenKeys.has(key)) throw new Error(`黑板键名重复：${key}`);
    seenKeys.add(key);
    if (!BLACKBOARD_TYPES.includes(entry.type)) {
      throw new Error(`黑板参数类型不支持：${entry.type}`);
    }
    // Numeric/boolean values use the same whitespace-tolerant parsing as the
    // C++ blackboard, but are emitted canonically so API and XML see one value.
    const value = entry.type === 'string' ? entry.value : entry.value.trim();
    if (entry.type === 'bool' && !['true', 'false', '1', '0'].includes(value)) {
      throw new Error(`bool 黑板参数只能是 true/false/1/0：${key}`);
    }
    if (entry.type === 'int' &&
        (!INTEGER_LITERAL.test(value) ||
         !Number.isSafeInteger(Number(value)) ||
         Number(value) < -2147483648 || Number(value) > 2147483647)) {
      throw new Error(`int 黑板参数无法解析：${key}`);
    }
    if (entry.type === 'double' &&
        (!DOUBLE_LITERAL.test(value) || !Number.isFinite(Number(value)))) {
      throw new Error(`double 黑板参数无法解析：${key}`);
    }
    return { ...entry, key, value };
  });
}

function renderBlackboard(entries: BlackboardEntry[]): string[] {
  if (entries.length === 0) return [];
  return [
    '  <TreeNodesModel>',
    '    <Blackboard>',
    ...entries.map((entry) => {
      const attrs = [
        `key="${escapeAttr(entry.key.trim())}"`,
        `type="${escapeAttr(entry.type)}"`,
        `value="${escapeAttr(entry.value)}"`,
      ];
      if (entry.description.trim()) {
        attrs.push(`description="${escapeAttr(entry.description)}"`);
      }
      return `      <Entry ${attrs.join(' ')}/>`;
    }),
    '    </Blackboard>',
    '  </TreeNodesModel>',
  ];
}

/** Serialize one complete document, including all subtree definitions. */
export function exportDocumentToXml(document: BehaviorTreeDocument): string {
  const mainTreeId = document.mainTreeId.trim();
  if (!mainTreeId) throw new Error('导出失败：主树 ID 不能为空');
  if (document.trees.length === 0) throw new Error('导出失败：至少需要一个 BehaviorTree 定义');

  const treeIds = new Set<string>();
  const trees = document.trees.map((tree) => {
    const id = tree.id.trim();
    if (!id) throw new Error('导出失败：BehaviorTree ID 不能为空');
    if (treeIds.has(id)) throw new Error(`导出失败：BehaviorTree ID 重复：${id}`);
    treeIds.add(id);
    return { ...tree, id };
  });
  if (!treeIds.has(mainTreeId)) {
    throw new Error(`导出失败：主树 ${mainTreeId} 没有对应的 BehaviorTree 定义`);
  }
  const blackboardEntries = normalizeBlackboardEntries(document.blackboardEntries);

  return [
    `<root main_tree_to_execute="${escapeAttr(mainTreeId)}">`,
    ...renderBlackboard(blackboardEntries),
    ...trees.flatMap(renderTree),
    '</root>',
  ].join('\n');
}

/** Backward-compatible single-tree serializer. */
export function exportToXml(
  nodes: BtNode[],
  edges: BtEdge[],
  treeId = 'MainTree',
  blackboardEntries: BlackboardEntry[] = [],
): string {
  return exportDocumentToXml({
    mainTreeId: treeId,
    trees: [{ id: treeId, nodes, edges }],
    blackboardEntries,
  });
}

const NODE_X_GAP = 220;
const NODE_Y_GAP = 140;

function parseBlackboard(doc: Document): BlackboardEntry[] {
  const entries: BlackboardEntry[] = [];
  const seenKeys = new Set<string>();
  for (const element of Array.from(doc.querySelectorAll('TreeNodesModel > Blackboard > Entry'))) {
    const key = element.getAttribute('key')?.trim() ?? '';
    const type = element.getAttribute('type') as BlackboardEntry['type'] | null;
    const value = element.getAttribute('value');
    if (!key || !type || value === null) {
      throw new Error('XML 黑板 Entry 必须包含非空 key、type 和 value 属性');
    }
    if (!BLACKBOARD_TYPES.includes(type)) {
      throw new Error(`XML 黑板参数类型不支持：${type}`);
    }
    if (seenKeys.has(key)) throw new Error(`XML 黑板键名重复：${key}`);
    seenKeys.add(key);
    entries.push({
      key,
      type,
      value,
      description: element.getAttribute('description') ?? '',
    });
  }
  return normalizeBlackboardEntries(entries);
}

function parseTreeElement(
  element: Element,
  treeId: string,
  manifestByName: Map<string, NodeManifest>,
): BehaviorTreeDefinition {
  const roots = Array.from(element.children);
  if (roots.length !== 1) {
    throw new Error(`<BehaviorTree ID="${treeId}"> 必须包含恰好一个根节点`);
  }
  const nodes: BtNode[] = [];
  const edges: BtEdge[] = [];
  const xCursorByDepth = new Map<number, number>();
  let idSequence = 0;

  function resolveKind(registrationName: string, childCount: number): NodeKind {
    const manifest = manifestByName.get(registrationName);
    if (manifest) return manifest.type;
    if (childCount === 0) return 'Action';
    if (childCount === 1) return 'Decorator';
    return 'Control';
  }

  function walk(nodeElement: Element, depth: number, parentId: string | null): void {
    const registrationName = nodeElement.tagName;
    const childElements = Array.from(nodeElement.children);
    const manifest = manifestByName.get(registrationName);
    const portValues: Record<string, string> = {};
    let instanceName = '';
    for (const attribute of Array.from(nodeElement.attributes)) {
      if (attribute.name === 'name') instanceName = attribute.value;
      else portValues[attribute.name] = attribute.value;
    }

    const x = xCursorByDepth.get(depth) ?? 0;
    xCursorByDepth.set(depth, x + NODE_X_GAP);
    // React Flow ids only need to be unique in the visible definition. Keeping
    // the historical n0/n1 shape also preserves existing status/test contracts.
    const id = `n${idSequence++}`;
    const data: BtNodeData = {
      registrationName,
      kind: resolveKind(registrationName, childElements.length),
      instanceName,
      portValues,
      portManifests: manifest?.ports ?? [],
      runStatus: 'IDLE',
    };
    nodes.push({ id, type: 'btNode', position: { x, y: depth * NODE_Y_GAP }, data });
    if (parentId !== null) {
      edges.push({ id: `e-${parentId}-${id}`, source: parentId, target: id });
    }
    for (const child of childElements) walk(child, depth + 1, id);
  }

  walk(roots[0], 0, null);
  return { id: treeId, nodes, edges };
}

/** Parse main tree, all subtree definitions, and shared blackboard metadata. */
export function importDocumentFromXml(
  xml: string,
  manifests: NodeManifest[],
): BehaviorTreeDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error(`XML 解析失败：${parseError.textContent}`);

  const root = doc.documentElement;
  if (!root || root.tagName !== 'root') throw new Error('XML 缺少 <root> 节点');
  const treeElements = Array.from(root.children).filter(
    (element) => element.tagName === 'BehaviorTree',
  );
  if (treeElements.length === 0) throw new Error('XML 缺少 <BehaviorTree> 节点');

  const manifestByName = new Map(manifests.map((manifest) => [manifest.registration_name, manifest]));
  const treeIds = new Set<string>();
  const trees = treeElements.map((element) => {
    const id = element.getAttribute('ID')?.trim() ?? '';
    if (!id) throw new Error('<BehaviorTree> 缺少非空 ID 属性');
    if (treeIds.has(id)) throw new Error(`BehaviorTree ID 重复：${id}`);
    treeIds.add(id);
    return parseTreeElement(element, id, manifestByName);
  });

  const explicitMain = root.getAttribute('main_tree_to_execute')?.trim() ?? '';
  if (!explicitMain && trees.length > 1) {
    throw new Error('XML 包含多个 BehaviorTree 时必须指定 main_tree_to_execute');
  }
  const mainTreeId = explicitMain || trees[0].id;
  if (!treeIds.has(mainTreeId)) {
    throw new Error(`main_tree_to_execute="${mainTreeId}" 没有对应的 BehaviorTree`);
  }
  return { mainTreeId, trees, blackboardEntries: parseBlackboard(doc) };
}

function validateBundleBlackboard(value: unknown): BlackboardEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('树 + 黑板配置包缺少 blackboard 数组');
  }
  const entries = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`配置包 blackboard[${index}] 必须是对象`);
    }
    const candidate = entry as Partial<BlackboardEntry>;
    if (
      typeof candidate.key !== 'string' ||
      typeof candidate.type !== 'string' ||
      typeof candidate.value !== 'string' ||
      typeof candidate.description !== 'string'
    ) {
      throw new Error(`配置包 blackboard[${index}] 字段类型无效`);
    }
    return candidate as BlackboardEntry;
  });
  return normalizeBlackboardEntries(entries);
}

/**
 * Validate optional editor-only manifests carried by a .bt.json bundle.
 * These values affect controls and structural hints only; the C++ executor
 * still validates the XML against its own runtime factory.
 */
function validateBundleManifests(value: unknown): NodeManifest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('树 + 黑板配置包的 editor_manifests 必须是数组');
  }
  const kinds: NodeKind[] = ['Control', 'Decorator', 'Action', 'Condition'];
  const registrationNames = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`配置包 editor_manifests[${index}] 必须是对象`);
    }
    const raw = entry as Record<string, unknown>;
    const registrationName = raw.registration_name;
    const kind = raw.type;
    if (
      typeof registrationName !== 'string' ||
      !isValidXmlName(registrationName) ||
      typeof kind !== 'string' ||
      !kinds.includes(kind as NodeKind)
    ) {
      throw new Error(`配置包 editor_manifests[${index}] 的注册名或类别无效`);
    }
    if (registrationNames.has(registrationName)) {
      throw new Error(`配置包 editor_manifests 的注册名重复：${registrationName}`);
    }
    registrationNames.add(registrationName);
    if (!Array.isArray(raw.ports)) {
      throw new Error(`配置包 editor_manifests[${index}].ports 必须是数组`);
    }
    const ports = raw.ports.map((port, portIndex): PortManifest => {
      if (!port || typeof port !== 'object') {
        throw new Error(`配置包 editor_manifests[${index}].ports[${portIndex}] 必须是对象`);
      }
      const candidate = port as Record<string, unknown>;
      const direction = candidate.direction;
      if (
        typeof candidate.name !== 'string' ||
        !isValidXmlName(candidate.name) ||
        typeof candidate.type_name !== 'string' ||
        typeof candidate.default_value !== 'string' ||
        typeof candidate.description !== 'string' ||
        !['input', 'output', 'inout'].includes(String(direction))
      ) {
        throw new Error(`配置包 editor_manifests[${index}] 的端口字段无效`);
      }
      const enumValues = candidate.enum_values === undefined
        ? []
        : candidate.enum_values;
      if (!Array.isArray(enumValues) || !enumValues.every((item) => typeof item === 'string')) {
        throw new Error(`配置包 editor_manifests[${index}] 的枚举端口无效`);
      }
      const normalized: PortManifest = {
        name: candidate.name,
        direction: direction as PortManifest['direction'],
        type_name: candidate.type_name,
        default_value: candidate.default_value,
        description: candidate.description,
        enum_values: enumValues,
      };
      if (typeof candidate.editor_hint === 'string' && candidate.editor_hint) {
        normalized.editor_hint = candidate.editor_hint;
      }
      return normalized;
    });
    const portNames = new Set<string>();
    for (const port of ports) {
      if (portNames.has(port.name)) {
        throw new Error(`配置包 editor_manifests[${index}] 的端口名重复：${port.name}`);
      }
      portNames.add(port.name);
    }
    const manifest: NodeManifest = {
      registration_name: registrationName,
      type: kind as NodeKind,
      ports,
    };
    if (raw.documentation && typeof raw.documentation === 'object') {
      const documentation = raw.documentation as Record<string, unknown>;
      const fields = ['summary', 'usage', 'status_semantics', 'failure_conditions', 'example_xml'];
      if (fields.every((field) => typeof documentation[field] === 'string')) {
        manifest.documentation = {
          summary: documentation.summary as string,
          usage: documentation.usage as string,
          status_semantics: documentation.status_semantics as string,
          failure_conditions: documentation.failure_conditions as string,
          example_xml: documentation.example_xml as string,
        };
      }
    }
    return manifest;
  });
}

function portableBlackboardSignature(entries: BlackboardEntry[]): string {
  return normalizeBlackboardEntries(entries)
    .map(({ key, type, value, description }) =>
      `${key}\u0000${type}\u0000${value}\u0000${description}`)
    .sort()
    .join('\u0001');
}

/** Import a local XML document or the JSON package emitted by "导出树 + 黑板". */
export function importTreeArtifact(
  source: string,
  manifests: NodeManifest[],
): ImportedTreeArtifact {
  const text = source.trim();
  if (!text) throw new Error('导入文件为空');
  if (text.startsWith('<')) return importDocumentFromXml(text, manifests);

  let rawBundle: unknown;
  try {
    rawBundle = JSON.parse(text);
  } catch {
    throw new Error('导入文件既不是行为树 XML，也不是有效的树 + 黑板 JSON 配置包');
  }
  if (!rawBundle || typeof rawBundle !== 'object') {
    throw new Error('树 + 黑板配置包必须是 JSON 对象');
  }
  const bundle = rawBundle as Partial<TreeBundle>;
  if (bundle.schema !== 'bt_editor.tree_bundle.v1') {
    throw new Error(`不支持的树配置包 schema：${String(bundle.schema ?? '<缺失>')}`);
  }
  if (typeof bundle.xml !== 'string' || !bundle.xml.trim()) {
    throw new Error('树 + 黑板配置包缺少非空 xml 字段');
  }

  const editorManifests = validateBundleManifests(bundle.editor_manifests);
  const manifestByName = new Map<string, NodeManifest>();
  // Editor contracts are portable fallbacks. A live executor/server manifest
  // is authoritative when both describe the same registration.
  for (const manifest of [...editorManifests, ...manifests]) {
    manifestByName.set(manifest.registration_name, manifest);
  }
  const document = importDocumentFromXml(bundle.xml, [...manifestByName.values()]);
  const bundleBlackboard = validateBundleBlackboard(bundle.blackboard);
  if (
    portableBlackboardSignature(document.blackboardEntries) !==
    portableBlackboardSignature(bundleBlackboard)
  ) {
    throw new Error('配置包中的 XML 黑板与 blackboard 数组不一致，已拒绝导入');
  }
  return { ...document, editorManifests };
}

/** Backward-compatible main-tree importer. */
export function importFromXml(
  xml: string,
  manifests: NodeManifest[],
): { nodes: BtNode[]; edges: BtEdge[]; blackboardEntries: BlackboardEntry[] } {
  const document = importDocumentFromXml(xml, manifests);
  const mainTree = document.trees.find((tree) => tree.id === document.mainTreeId);
  if (!mainTree) throw new Error(`XML 主树 ${document.mainTreeId} 不存在`);
  return {
    nodes: mainTree.nodes,
    edges: mainTree.edges,
    blackboardEntries: document.blackboardEntries,
  };
}
