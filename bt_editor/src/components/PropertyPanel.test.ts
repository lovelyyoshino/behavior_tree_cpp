/**
 * PropertyPanel.test.ts — 属性面板端口模式回归测试
 *
 * @author pony
 * @date 2026-07-13
 * @version v1.3.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.3.0 (2026-08-19): 覆盖动态 ROS graph 类型候选
 *   - v1.2.0 (2026-08-18): 覆盖自定义 XML 属性预览
 *   - v1.1.0 (2026-08-18): 覆盖黑板键名、输出端口和动态键名判断
 */

import { describe, expect, it } from 'vitest';

import type { BtNode, PortManifest, RosCapabilities } from '../types';
import {
  buildNodeXmlPreview,
  inferPortValueMode,
  inferWidget,
  isBlackboardKeyNamePort,
  isBlackboardRemap,
  resolveRosGraphOptionSource,
  unwrapBlackboardKey,
} from './PropertyPanel';

function port(overrides: Partial<PortManifest>): PortManifest {
  return {
    name: 'p',
    direction: 'input',
    type_name: 'string',
    default_value: '',
    description: '',
    enum_values: [],
    ...overrides,
  };
}

describe('PropertyPanel port widget inference', () => {
  it('prefers enum widgets when enum values are provided', () => {
    expect(inferWidget(port({ enum_values: ['A', 'B'] }))).toBe('enum');
  });

  it('infers primitive widgets from type names', () => {
    expect(inferWidget(port({ type_name: 'bool' }))).toBe('bool');
    expect(inferWidget(port({ type_name: 'int' }))).toBe('int');
    expect(inferWidget(port({ type_name: 'unsigned long' }))).toBe('int');
    expect(inferWidget(port({ type_name: 'double' }))).toBe('float');
    expect(inferWidget(port({ type_name: 'float' }))).toBe('float');
  });

  it('falls back to text for strings and unknown types', () => {
    expect(inferWidget(port({ type_name: 'std::string' }))).toBe('text');
    expect(inferWidget(port({ type_name: 'Pose2D' }))).toBe('text');
  });

  it('keeps key ports as literal key names by default', () => {
    const key = port({ name: 'key' });
    expect(isBlackboardKeyNamePort(key)).toBe(true);
    expect(inferPortValueMode(key, 'mission_count')).toBe('key_name');
    expect(inferPortValueMode(key, '{selected_key}')).toBe('blackboard');
  });

  it('requires output ports to use blackboard remapping semantics', () => {
    const output = port({ name: 'value', direction: 'output', type_name: 'double' });
    expect(inferPortValueMode(output, '')).toBe('blackboard');
    expect(inferPortValueMode(output, '{temperature}')).toBe('blackboard');
  });

  it('recognizes only complete remaps and exposes their key', () => {
    expect(isBlackboardRemap('{battery_level}')).toBe(true);
    expect(isBlackboardRemap('{battery_level')).toBe(false);
    expect(unwrapBlackboardKey('{battery_level}')).toBe('battery_level');
    expect(unwrapBlackboardKey('battery_level')).toBe('');
  });

  it('keeps custom XML attributes that are absent from the manifest', () => {
    const node: BtNode = {
      id: 'custom',
      type: 'btNode',
      position: { x: 0, y: 0 },
      data: {
        registrationName: 'LoadYuyiPath',
        kind: 'Action',
        instanceName: '',
        portValues: { path_file: 'config/route.yaml', frame_id: 'map' },
        portManifests: [],
        runStatus: 'IDLE',
      },
    };
    expect(buildNodeXmlPreview(node)).toBe(
      '<LoadYuyiPath path_file="config/route.yaml" frame_id="map"/>',
    );
  });

  it('switches generic ROS graph candidates without business-name rules', () => {
    const capabilities: RosCapabilities = {
      schema: 'bt_ros2.capabilities.v1',
      seq: 1,
      executor_node: '/bt_executor',
      ros_nodes: ['/planner'],
      topics: [{ name: '/planner/healthy', types: ['std_msgs/msg/Bool'] }],
      services: [{ name: '/planner/reset', types: ['std_srvs/srv/Trigger'] }],
      actions: [{ name: '/navigate_to_pose', types: ['nav2_msgs/action/NavigateToPose'] }],
      manifests: [],
    };
    const entityName = port({
      name: 'entity_name',
      editor_hint: 'ros_graph_entity',
    });
    expect(resolveRosGraphOptionSource(
      entityName, { entity_type: 'node' }, capabilities,
    )?.options.map((option) => option.name)).toEqual(['/planner']);
    expect(resolveRosGraphOptionSource(
      entityName, { entity_type: 'service' }, capabilities,
    )?.options.map((option) => option.name)).toEqual(['/planner/reset']);
    expect(resolveRosGraphOptionSource(
      port({ editor_hint: 'ros_action' }), {}, capabilities,
    )?.options.map((option) => option.name)).toEqual(['/navigate_to_pose']);
  });
});
