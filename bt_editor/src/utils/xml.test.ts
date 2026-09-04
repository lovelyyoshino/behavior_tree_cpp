/**
 * XML 编辑器往返与调度节点顺序测试。
 *
 * @author pony
 * @date 2026-06-30
 * @version v1.2.0
 * @last_modified 2026-08-18
 * @changelog
 *   - v1.2.0 (2026-08-18): 覆盖 XML 黑板初值元数据的导入导出
 *   - v1.1.0 (2026-08-18): 覆盖优先级分支顺序与 TickRate 端口往返
 */
import { describe, expect, it } from 'vitest';

import type { BtEdge, BtNode, NodeManifest } from '../types';
import {
  dfsPreorderIds,
  exportDocumentToXml,
  exportToXml,
  findRootId,
  importDocumentFromXml,
  importFromXml,
  importTreeArtifact,
  isValidXmlName,
  normalizeBlackboardEntries,
} from './xml';

const manifests: NodeManifest[] = [
  { registration_name: 'Sequence', type: 'Control', ports: [] },
  { registration_name: 'PrioritySelector', type: 'Control', ports: [] },
  {
    registration_name: 'TickRate',
    type: 'Decorator',
    ports: [
      {
        name: 'tier',
        direction: 'input',
        type_name: 'string',
        default_value: 'normal',
        description: 'tick tier',
        enum_values: ['critical', 'normal', 'background'],
      },
    ],
  },
  {
    registration_name: 'PrintMessage',
    type: 'Action',
    ports: [
      {
        name: 'message',
        direction: 'input',
        type_name: 'string',
        default_value: '',
        description: 'message',
        enum_values: [],
      },
    ],
  },
  { registration_name: 'AlwaysSuccess', type: 'Condition', ports: [] },
];

function node(
  id: string,
  registrationName: string,
  kind: BtNode['data']['kind'],
  x: number,
  portValues: Record<string, string> = {},
): BtNode {
  return {
    id,
    type: 'btNode',
    position: { x, y: 0 },
    data: {
      registrationName,
      kind,
      instanceName: id,
      portValues,
      portManifests: [],
      runStatus: 'IDLE',
    },
  };
}

describe('xml utilities', () => {
  it('finds the single root and rejects multiple roots', () => {
    const nodes = [
      node('root', 'Sequence', 'Control', 0),
      node('child', 'AlwaysSuccess', 'Condition', 0),
    ];

    expect(findRootId(nodes, [{ id: 'e', source: 'root', target: 'child' }])).toBe(
      'root',
    );
    expect(findRootId(nodes, [])).toBeNull();
  });

  it('exports XML using visual left-to-right child order', () => {
    const nodes = [
      node('root', 'Sequence', 'Control', 100),
      node('right', 'PrintMessage', 'Action', 300, { message: 'right' }),
      node('left', 'PrintMessage', 'Action', 0, { message: 'left & <safe>' }),
    ];
    const edges: BtEdge[] = [
      { id: 'e1', source: 'root', target: 'right' },
      { id: 'e2', source: 'root', target: 'left' },
    ];

    const xml = exportToXml(nodes, edges, 'DemoTree');

    expect(xml).toContain('<root main_tree_to_execute="DemoTree">');
    expect(xml.indexOf('message="left &amp; &lt;safe&gt;"')).toBeLessThan(
      xml.indexOf('message="right"'),
    );
  });

  it('imports XML, keeps DFS ids stable, and assigns non-overlapping layout', () => {
    const xml = `<root main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <Sequence name="root">
      <PrintMessage message="hello"/>
      <AlwaysSuccess/>
    </Sequence>
  </BehaviorTree>
</root>`;

    const result = importFromXml(xml, manifests);

    expect(result.nodes.map((item) => item.data.registrationName)).toEqual([
      'Sequence',
      'PrintMessage',
      'AlwaysSuccess',
    ]);
    expect(result.edges).toHaveLength(2);
    expect(dfsPreorderIds(result.nodes, result.edges)).toEqual([
      'n0',
      'n1',
      'n2',
    ]);
    expect(result.nodes[1].position).toEqual({ x: 0, y: 140 });
    expect(result.nodes[2].position).toEqual({ x: 220, y: 140 });
  });

  it('round-trips imported trees back to compatible XML', () => {
    const input = `<root main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <Sequence name="root">
      <PrintMessage message="{greeting}"/>
    </Sequence>
  </BehaviorTree>
</root>`;

    const { nodes, edges } = importFromXml(input, manifests);
    const output = exportToXml(nodes, edges);

    expect(output).toContain('<Sequence name="root">');
    expect(output).toContain('<PrintMessage message="{greeting}"/>');
  });

  it('binds typed blackboard initial values to XML and restores them on import', () => {
    const nodes = [node('root', 'PrintMessage', 'Action', 0, { message: '{greeting}' })];
    const xml = exportToXml(nodes, [], 'MainTree', [
      {
        key: 'greeting',
        type: 'string',
        value: 'hello & welcome',
        description: 'ROS & startup value',
      },
      {
        key: 'retry_count',
        type: 'int',
        value: '3',
        description: '',
      },
    ]);

    expect(xml).toContain('<TreeNodesModel>');
    expect(xml).toContain('<Blackboard>');
    expect(xml).toContain(
      'key="greeting" type="string" value="hello &amp; welcome" description="ROS &amp; startup value"',
    );
    const imported = importFromXml(xml, manifests);
    expect(imported.blackboardEntries).toEqual([
      {
        key: 'greeting',
        type: 'string',
        value: 'hello & welcome',
        description: 'ROS & startup value',
      },
      {
        key: 'retry_count',
        type: 'int',
        value: '3',
        description: '',
      },
    ]);
    expect(exportToXml(imported.nodes, imported.edges, 'MainTree', imported.blackboardEntries))
      .toBe(xml);
  });

  it('normalizes blackboard keys before XML export and rejects invalid values', () => {
    expect(normalizeBlackboardEntries([
      { key: ' temperature ', type: 'double', value: '25.5', description: '' },
    ])[0].key).toBe('temperature');
    expect(() => normalizeBlackboardEntries([
      { key: 'temperature', type: 'double', value: '1', description: '' },
      { key: ' temperature ', type: 'double', value: '2', description: '' },
    ])).toThrow('黑板键名重复：temperature');
    expect(() => exportToXml(
      [node('root', 'PrintMessage', 'Action', 0)],
      [],
      'MainTree',
      [{ key: 'ready', type: 'bool', value: 'yes', description: '' }],
    )).toThrow('bool 黑板参数只能是 true/false/1/0：ready');
    expect(() => normalizeBlackboardEntries([
      { key: 'value', type: 'double', value: '0x10', description: '' },
    ])).toThrow('double 黑板参数无法解析：value');
  });

  it('rejects malformed custom XML tags and attributes before download/load', () => {
    expect(isValidXmlName('LoadYuyiPath')).toBe(true);
    expect(isValidXmlName('_route.step-1')).toBe(true);
    expect(isValidXmlName('9invalid')).toBe(false);
    expect(isValidXmlName('path:file')).toBe(false);
    expect(() => exportToXml(
      [node('root', 'Load Yuyi Path', 'Action', 0)],
      [],
      'MainTree',
    )).toThrow('节点注册名不是合法 XML 名称');
    expect(() => exportToXml(
      [node('root', 'LoadYuyiPath', 'Action', 0, { 'path file': 'route.yaml' })],
      [],
      'MainTree',
    )).toThrow('非法 XML 属性名');
  });

  it('preserves priority branch order and tick tier during editor round trip', () => {
    const input = `<root main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <PrioritySelector name="scheduler">
      <Sequence name="critical"><AlwaysSuccess/></Sequence>
      <TickRate name="background" tier="background"><AlwaysSuccess/></TickRate>
    </PrioritySelector>
  </BehaviorTree>
</root>`;

    const { nodes, edges } = importFromXml(input, manifests);
    const output = exportToXml(nodes, edges);

    expect(nodes.map((item) => item.data.registrationName)).toEqual([
      'PrioritySelector',
      'Sequence',
      'AlwaysSuccess',
      'TickRate',
      'AlwaysSuccess',
    ]);
    expect(output.indexOf('<Sequence name="critical">')).toBeLessThan(
      output.indexOf('<TickRate name="background" tier="background">'),
    );
    expect(output).toContain('<TickRate name="background" tier="background">');
  });

  it('round-trips the main tree, SubTreePlus call, subtree definition, and blackboard', () => {
    const input = `<root main_tree_to_execute="Main">
  <TreeNodesModel><Blackboard><Entry key="source_value" type="double" value="25.5"/></Blackboard></TreeNodesModel>
  <BehaviorTree ID="Main"><Sequence><SubTreePlus ID="Worker" message="{source_value}"/></Sequence></BehaviorTree>
  <BehaviorTree ID="Worker"><PrintMessage message="{message}"/></BehaviorTree>
</root>`;
    const document = importDocumentFromXml(input, manifests);
    expect(document.mainTreeId).toBe('Main');
    expect(document.trees.map((tree) => tree.id)).toEqual(['Main', 'Worker']);
    expect(document.trees[0].nodes[1].data.registrationName).toBe('SubTreePlus');
    const output = exportDocumentToXml(document);
    expect(output).toContain('<BehaviorTree ID="Worker">');
    expect(output).toContain('<SubTreePlus ID="Worker" message="{source_value}"/>');
    expect(output).toContain('<Entry key="source_value" type="double" value="25.5"/>');
    const restored = importDocumentFromXml(output, manifests);
    expect(restored.trees).toHaveLength(2);
    expect(restored.blackboardEntries[0]).toMatchObject({ key: 'source_value', type: 'double' });
  });

  it('imports XML and a tree bundle through one strict artifact boundary', () => {
    const xml = `<root main_tree_to_execute="MainTree">
  <TreeNodesModel><Blackboard><Entry key="mission" type="string" value="zone1" description="task"/></Blackboard></TreeNodesModel>
  <BehaviorTree ID="MainTree"><PrintMessage message="{mission}"/></BehaviorTree>
</root>`;
    expect(importTreeArtifact(xml, manifests).blackboardEntries).toEqual([
      { key: 'mission', type: 'string', value: 'zone1', description: 'task' },
    ]);

    const bundle = JSON.stringify({
      schema: 'bt_editor.tree_bundle.v1',
      exported_at: '2026-08-21T00:00:00.000Z',
      xml,
      blackboard: [
        { key: 'mission', type: 'string', value: 'zone1', description: 'task' },
      ],
    });
    expect(importTreeArtifact(bundle, manifests).trees[0].nodes[0].data.portValues.message)
      .toBe('{mission}');
  });

  it('restores custom typed ports from a bundle without overriding a live manifest', () => {
    const xml = `<root main_tree_to_execute="MainTree">
  <TreeNodesModel><Blackboard><Entry key="route_path" type="string" value="unused"/></Blackboard></TreeNodesModel>
  <BehaviorTree ID="MainTree"><LoadYuyiPath path_file="route.yaml" path="{route_path}"/></BehaviorTree>
</root>`;
    const editorManifest: NodeManifest = {
      registration_name: 'LoadYuyiPath',
      type: 'Action',
      ports: [
        {
          name: 'path_file',
          direction: 'input',
          type_name: 'string',
          default_value: '',
          description: 'route file',
          enum_values: [],
        },
        {
          name: 'path',
          direction: 'output',
          type_name: 'PoseArray',
          default_value: '',
          description: 'path output',
          enum_values: [],
        },
      ],
    };
    const imported = importTreeArtifact(JSON.stringify({
      schema: 'bt_editor.tree_bundle.v1',
      exported_at: '2026-08-24T00:00:00.000Z',
      xml,
      blackboard: [{ key: 'route_path', type: 'string', value: 'unused', description: '' }],
      editor_manifests: [editorManifest],
    }), manifests);
    expect(imported.editorManifests).toHaveLength(1);
    expect(imported.trees[0].nodes[0].data.portManifests).toEqual(editorManifest.ports);

    const runtimeManifest: NodeManifest = {
      ...editorManifest,
      ports: editorManifest.ports.map((port) => ({ ...port, type_name: 'runtime_type' })),
    };
    const runtimeImported = importTreeArtifact(JSON.stringify({
      schema: 'bt_editor.tree_bundle.v1',
      exported_at: '2026-08-24T00:00:00.000Z',
      xml,
      blackboard: [{ key: 'route_path', type: 'string', value: 'unused', description: '' }],
      editor_manifests: [editorManifest],
    }), [...manifests, runtimeManifest]);
    expect(runtimeImported.trees[0].nodes[0].data.portManifests[0].type_name)
      .toBe('runtime_type');
  });

  it('rejects a tree bundle whose detached blackboard disagrees with XML', () => {
    const xml = `<root main_tree_to_execute="MainTree">
  <TreeNodesModel><Blackboard><Entry key="mission" type="string" value="zone1"/></Blackboard></TreeNodesModel>
  <BehaviorTree ID="MainTree"><AlwaysSuccess/></BehaviorTree>
</root>`;
    expect(() => importTreeArtifact(JSON.stringify({
      schema: 'bt_editor.tree_bundle.v1',
      exported_at: '2026-08-21T00:00:00.000Z',
      xml,
      blackboard: [
        { key: 'mission', type: 'string', value: 'zone2', description: '' },
      ],
    }), manifests)).toThrow('XML 黑板与 blackboard 数组不一致');
  });
});
