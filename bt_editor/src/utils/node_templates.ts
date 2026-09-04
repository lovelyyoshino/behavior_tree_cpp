/**
 * node_templates.ts — 编辑器「通用节点模板库」定义
 *
 * 每个模板是一次插入若干节点 + 连线的「常用组合」，让用户不用手动逐个添加
 * 和连线。模板只描述注册名、大类、端口默认值和父子关系；真正实例化仍走
 * createNodeFromManifest（见 App.tsx），保证与单节点添加共享同一套端口契约。
 *
 * @author pony
 * @date 2026-08-24
 * @version v1.0.0
 * @last_modified 2026-08-24
 * @changelog
 *   - v1.0.0 (2026-08-24): 初始版本
 */

import type { NodeKind } from '../types';

/** 模板里的单个节点：注册名 + 大类 + 端口值覆盖 */
export interface NodeTemplateNode {
  registrationName: string;
  kind: NodeKind;
  /** 端口名 → 值；模板可覆盖，未列的端口沿用 manifest 默认值 */
  portValues?: Record<string, string>;
}

/** 模板节点之间的连线：parent 是内嵌父节点，children 挂在 parent 下 */
export interface NodeTemplateEdge {
  parentIndex: number;
  childIndex: number;
}

/** 一个可插入的节点组合 */
export interface NodeTemplate {
  id: string;
  label: string;
  description: string;
  nodes: NodeTemplateNode[];
  edges: NodeTemplateEdge[];
}

/**
 * 内置模板库。注册名必须是运行时(bt_nodes/bt_ros2)已注册节点；
 * 否则节点仍插入但执行前需提供插件。
 */
export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    id: 'reactive-emergency-stop',
    label: '反应式急停门控',
    description: 'ReactiveSequence 根 + RosTopicCondition(急停) + AlwaysSuccess 兜底',
    nodes: [
      { registrationName: 'ReactiveSequence', kind: 'Control' },
      { registrationName: 'RosTopicCondition', kind: 'Condition',
        portValues: { topic: '/safety/e_stop', default: 'false' } },
      { registrationName: 'AlwaysSuccess', kind: 'Action' },
    ],
    edges: [
      { parentIndex: 0, childIndex: 1 },
      { parentIndex: 0, childIndex: 2 },
    ],
  },
  {
    id: 'blackboard-gate',
    label: '黑板值门控',
    description: 'Sequence 根 + BlackboardGate(key) + AlwaysSuccess 动作',
    nodes: [
      { registrationName: 'Sequence', kind: 'Control' },
      { registrationName: 'BlackboardGate', kind: 'Condition',
        portValues: { key: 'mode', expected: 'zone2' } },
      { registrationName: 'AlwaysSuccess', kind: 'Action' },
    ],
    edges: [
      { parentIndex: 0, childIndex: 1 },
      { parentIndex: 0, childIndex: 2 },
    ],
  },
  {
    id: 'long-running-scheduler',
    label: '长驻调度器',
    description: 'KeepRunningUntilFailure 根 + Fallback + 触发/空闲延时',
    nodes: [
      { registrationName: 'KeepRunningUntilFailure', kind: 'Decorator' },
      { registrationName: 'Fallback', kind: 'Control' },
      { registrationName: 'Sequence', kind: 'Control' },
      { registrationName: 'TimeCondition', kind: 'Condition',
        portValues: { mode: 'interval', interval_sec: '1800' } },
      { registrationName: 'SubTreePlus', kind: 'Action',
        portValues: { ID: 'WorkRoute' } },
      { registrationName: 'NonBlockingDelay', kind: 'Action',
        portValues: { msec: '1000' } },
    ],
    edges: [
      { parentIndex: 0, childIndex: 1 },
      { parentIndex: 1, childIndex: 2 },
      { parentIndex: 2, childIndex: 3 },
      { parentIndex: 2, childIndex: 4 },
      { parentIndex: 1, childIndex: 5 },
    ],
  },
];
