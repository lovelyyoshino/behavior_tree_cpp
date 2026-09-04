"""test_bt_web_core.py - 只读 ROS2 Web 适配器协议回归测试。

@author pony
@date 2026-08-17
@version v1.5.0
@last_modified 2026-08-24
@changelog
    - v1.5.0 (2026-08-24): 覆盖 executor manifest 生命周期和 action 内部服务过滤
    - v1.3.0 (2026-08-21): 覆盖 bt_web 直接读取 graph、命名空间和 action 推导
    - v1.2.0 (2026-08-19): 覆盖 service/action 能力与旧快照兼容
    - v1.1.0 (2026-08-18): 覆盖能力快照、CORS 响应和 OPTIONS 预检
    - v1.0.0 (2026-08-17): 初始实现
"""

from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from bt_web_core import (
    build_ros_graph_capabilities,
    CapabilitiesStore,
    DebugStateStore,
    load_tree_definition,
    make_request_handler,
    ServiceEventStore,
    SnapshotStore,
    select_live_executor_manifests,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
TREE_FILE = PACKAGE_ROOT / 'trees' / 'recharge.xml'


def snapshot_json(revision, seq=1, session_id='test-session'):
    return json.dumps({
        'schema': 'bt_ros2.bt_snapshot.v1',
        'session_id': session_id,
        'tree_revision': revision,
        'seq': seq,
        'steady_time_ms': 1000 + seq,
        'tree_id': 'RechargeTree',
        'root_status': 'SUCCESS',
        'nodes': [{
            'key': 'node/1',
            'id': 1,
            'instance_name': 'battery_guard',
            'registration_name': 'Fallback',
            'kind': 'Control',
            'status': 'SUCCESS',
        }],
    })


def service_event_json(revision, event_seq=1, session_id='test-session'):
    return json.dumps({
        'schema': 'bt_ros2.service_event.v1',
        'event_seq': event_seq,
        'call_id': 'start-1',
        'tick_seq': 1,
        'steady_time_ms': 1001,
        'session_id': session_id,
        'tree_revision': revision,
        'kind': 'service',
        'interface': '/bt_executor/start',
        'phase': 'completed',
        'request': {},
        'result': {'success': True, 'message': 'started'},
        'message': 'started',
        'duration_ms': 1,
    })


def debug_state_json(revision, condition_keys, overrides=None):
    return json.dumps({
        'schema': 'bt_ros2.debug_state.v1',
        'session_id': 'debug-session',
        'tree_revision': revision,
        'scenario_id': 'manual',
        'mode': 'paused',
        'paused': True,
        'tick_seq': 2,
        'condition_node_keys': condition_keys,
        'overrides': overrides or {},
    })


class BtWebCoreTest(unittest.TestCase):

    def test_structure_matches_runtime_dfs_ids(self):
        structure = load_tree_definition(TREE_FILE)
        self.assertEqual(structure['schema'], 'bt_ros2.bt_structure.v1')
        self.assertEqual(structure['main_tree_id'], 'RechargeTree')
        self.assertEqual(structure['root']['key'], 'node/1')
        self.assertEqual(structure['root']['registration_name'], 'Fallback')
        self.assertTrue(structure['tree_revision'].startswith('fnv1a64:'))
        self.assertEqual(structure['root']['children'][0]['children'][1]['kind'], 'Condition')

    def test_structure_expands_subtree_plus_and_keeps_custom_composition(self):
        xml = '''\
<root main_tree_to_execute="Main">
  <TreeNodesModel><Blackboard>
    <Entry key="message" type="string" value="hello"/>
  </Blackboard></TreeNodesModel>
  <BehaviorTree ID="Main">
    <Sequence><SubTreePlus ID="Worker" message="{message}"/></Sequence>
  </BehaviorTree>
  <BehaviorTree ID="Worker">
    <RunOnZoneTransition>
      <Sequence><AlwaysSuccess/></Sequence>
      <Sequence><AlwaysFailure/></Sequence>
    </RunOnZoneTransition>
  </BehaviorTree>
</root>
'''
        with tempfile.TemporaryDirectory() as directory:
            tree_file = Path(directory) / 'subtree_plus.xml'
            tree_file.write_text(xml, encoding='utf-8')
            structure = load_tree_definition(tree_file)

        root = structure['root']
        self.assertEqual(root['registration_name'], 'Sequence')
        self.assertEqual(len(root['children']), 1)
        wrapper = root['children'][0]
        self.assertEqual(wrapper['registration_name'], 'RunOnZoneTransition')
        self.assertEqual(wrapper['kind'], 'Control')
        self.assertEqual(len(wrapper['children']), 2)
        self.assertEqual(structure['root']['key'], 'node/1')

    def test_stores_validate_revision_sequence_and_session(self):
        revision = load_tree_definition(TREE_FILE)['tree_revision']
        snapshots = SnapshotStore(revision, 3)
        snapshots.update_json(snapshot_json(revision, 1))
        snapshots.update_json(snapshot_json(revision, 2))
        self.assertEqual(snapshots.latest()['snapshot']['seq'], 2)
        with self.assertRaisesRegex(ValueError, 'seq must increase'):
            snapshots.update_json(snapshot_json(revision, 2))
        snapshots.update_json(snapshot_json(revision, 1, 'new-session'))
        self.assertEqual(len(snapshots.history(10)['entries']), 1)

        events = ServiceEventStore(revision, 3)
        events.update_json(service_event_json(revision))
        self.assertEqual(events.latest()['event']['interface'], '/bt_executor/start')

    def test_capabilities_store_exposes_only_valid_runtime_snapshot(self):
        capabilities = CapabilitiesStore()
        capabilities.update_json(json.dumps({
            'schema': 'bt_ros2.capabilities.v1',
            'seq': 4,
            'executor_node': '/bt_executor',
            'ros_nodes': ['/bt_executor', '/planner'],
            'topics': [{'name': '/planner/healthy', 'types': ['std_msgs/msg/Bool']}],
            'services': [{'name': '/planner/reset', 'types': ['std_srvs/srv/Trigger']}],
            'actions': [{'name': '/navigate_to_pose',
                         'types': ['nav2_msgs/action/NavigateToPose']}],
            'manifests': [],
        }))
        latest = capabilities.latest()
        self.assertTrue(latest['available'])
        self.assertEqual(latest['capabilities']['topics'][0]['name'], '/planner/healthy')
        self.assertEqual(latest['capabilities']['services'][0]['name'], '/planner/reset')
        self.assertEqual(latest['capabilities']['actions'][0]['name'], '/navigate_to_pose')
        with self.assertRaisesRegex(ValueError, 'unsupported capabilities schema'):
            capabilities.update_json('{"schema":"unknown"}')

    def test_capabilities_store_normalizes_legacy_topic_only_snapshot(self):
        capabilities = CapabilitiesStore()
        capabilities.update_json(json.dumps({
            'schema': 'bt_ros2.capabilities.v1',
            'seq': 2,
            'executor_node': '/legacy_executor',
            'ros_nodes': ['/legacy_executor'],
            'topics': [],
            'manifests': [],
        }))
        snapshot = capabilities.latest()['capabilities']
        self.assertEqual(snapshot['services'], [])
        self.assertEqual(snapshot['actions'], [])

    def test_builds_capabilities_from_live_ros_graph_without_business_names(self):
        snapshot = build_ros_graph_capabilities(
            7,
            '/bt_executor',
            [
                ('planner', '/robot'),
                ('bt_web', '/'),
                ('planner', '/robot'),
            ],
            {
                '/robot/healthy': ['std_msgs/msg/Bool', 'std_msgs/msg/Bool'],
                '/telemetry/value': ['std_msgs/msg/Float64'],
            },
            {
                '/planner/reset': ['std_srvs/srv/Trigger'],
                '/navigate_to_pose/_action/send_goal': [
                    'nav2_msgs/action/NavigateToPose_SendGoal',
                ],
            },
            [{'registration_name': 'RosGraphCondition', 'type': 'Condition', 'ports': []}],
        )

        self.assertEqual(snapshot['ros_nodes'], ['/bt_web', '/robot/planner'])
        self.assertEqual(snapshot['topics'][0]['name'], '/robot/healthy')
        self.assertEqual(snapshot['topics'][0]['types'], ['std_msgs/msg/Bool'])
        self.assertEqual(snapshot['services'], [{
            'name': '/planner/reset',
            'types': ['std_srvs/srv/Trigger'],
        }])
        self.assertEqual(snapshot['actions'], [{
            'name': '/navigate_to_pose',
            'types': ['nav2_msgs/action/NavigateToPose'],
        }])
        self.assertEqual(snapshot['manifests'][0]['registration_name'], 'RosGraphCondition')

    def test_builds_capabilities_from_rclpy_list_shape(self):
        """rclpy 的 get_topic_names_and_types() 返回 list[tuple]，不是 dict。

        回归用例：曾因 _interface_list 只接受 dict，真实 graph 的 topic/service
        被静默丢成空列表，编辑器显示 "0 个 topic、0 个 service"。
        """
        snapshot = build_ros_graph_capabilities(
            1,
            '/bt_executor',
            [('bt_web', '/')],
            # rclpy 真实返回形状：list of (name, [types])
            [
                ('/nav3d/current_pose', ['geometry_msgs/msg/PoseStamped']),
                ('/nav3d/status', ['std_msgs/msg/String']),
            ],
            [
                ('/planner/reset', ['std_srvs/srv/Trigger']),
                ('/navigate_to_pose/_action/send_goal',
                 ['nav2_msgs/action/NavigateToPose_SendGoal']),
            ],
            [],
        )

        # topic 必须被完整保留，不能因形状不同而丢空。
        self.assertEqual(len(snapshot['topics']), 2)
        self.assertEqual(snapshot['topics'][0], {
            'name': '/nav3d/current_pose',
            'types': ['geometry_msgs/msg/PoseStamped'],
        })
        # 普通 service 保留，action 传输 service 归入 actions 而不重复出现。
        self.assertEqual(snapshot['services'], [{
            'name': '/planner/reset',
            'types': ['std_srvs/srv/Trigger'],
        }])
        self.assertEqual(snapshot['actions'], [{
            'name': '/navigate_to_pose',
            'types': ['nav2_msgs/action/NavigateToPose'],
        }])

    def test_executor_manifests_are_dropped_after_executor_leaves_graph(self):
        previous = {
            'executor_node': '/bt_executor',
            'manifests': [{'registration_name': 'LoadYuyiPath'}],
        }
        executor, manifests = select_live_executor_manifests(
            previous,
            [('bt_web', '/')],
            '/bt_web',
        )
        self.assertEqual(executor, '/bt_web')
        self.assertEqual(manifests, [])

        executor, manifests = select_live_executor_manifests(
            previous,
            [('bt_web', '/'), ('bt_executor', '/')],
            '/bt_web',
        )
        self.assertEqual(executor, '/bt_executor')
        self.assertEqual(manifests[0]['registration_name'], 'LoadYuyiPath')

    def test_action_transport_services_are_not_generic_service_candidates(self):
        snapshot = build_ros_graph_capabilities(
            8,
            '/bt_executor',
            [('bt_executor', '/')],
            {},
            {
                '/navigate/_action/send_goal': [
                    'example_interfaces/action/Fibonacci_SendGoal',
                ],
                '/navigate/_action/get_result': [
                    'example_interfaces/action/Fibonacci_GetResult',
                ],
                '/planner/reset': ['std_srvs/srv/Trigger'],
            },
            [],
        )
        self.assertEqual(snapshot['services'], [{
            'name': '/planner/reset',
            'types': ['std_srvs/srv/Trigger'],
        }])
        self.assertEqual(snapshot['actions'], [{
            'name': '/navigate',
            'types': ['example_interfaces/action/Fibonacci'],
        }])

    def test_http_adapter_is_read_only(self):
        structure = load_tree_definition(TREE_FILE)
        snapshots = SnapshotStore(structure['tree_revision'])
        events = ServiceEventStore(structure['tree_revision'])
        capabilities = CapabilitiesStore()
        capabilities.update_json(json.dumps({
            'schema': 'bt_ros2.capabilities.v1',
            'seq': 1,
            'executor_node': '/bt_executor',
            'ros_nodes': ['/bt_executor'],
            'topics': [],
            'manifests': [],
        }))
        snapshots.update_json(snapshot_json(structure['tree_revision']))
        events.update_json(service_event_json(structure['tree_revision']))
        with tempfile.TemporaryDirectory() as directory:
            web = Path(directory)
            (web / 'index.html').write_text('viewer', encoding='utf-8')
            (web / 'app.js').write_text('', encoding='utf-8')
            (web / 'styles.css').write_text('', encoding='utf-8')
            server = ThreadingHTTPServer(
                ('127.0.0.1', 0), make_request_handler(
                    snapshots, events, structure, web, capabilities=capabilities
                )
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(f'{base_url}/api/v1/bt/snapshots/latest') as response:
                    self.assertEqual(json.load(response)['snapshot']['seq'], 1)
                with urlopen(f'{base_url}/api/v1/bt/service-events') as response:
                    self.assertEqual(len(json.load(response)['entries']), 1)
                with urlopen(f'{base_url}/api/v1/bt/capabilities') as response:
                    self.assertEqual(response.headers['Access-Control-Allow-Origin'], '*')
                    self.assertTrue(json.load(response)['available'])
                options = Request(
                    f'{base_url}/api/v1/bt/capabilities',
                    method='OPTIONS',
                    headers={'Origin': 'http://127.0.0.1:5173'},
                )
                with urlopen(options) as response:
                    self.assertEqual(response.status, 204)
                    self.assertIn('GET', response.headers['Access-Control-Allow-Methods'])
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(f'{base_url}/api/v1/bt/snapshots/latest', data=b'{}'))
                self.assertEqual(error.exception.code, 405)
                error.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_viewer_exposes_branch_and_bulk_collapse_controls(self):
        page = (PACKAGE_ROOT / 'web' / 'index.html').read_text(encoding='utf-8')
        script = (PACKAGE_ROOT / 'web' / 'app.js').read_text(encoding='utf-8')
        styles = (PACKAGE_ROOT / 'web' / 'styles.css').read_text(encoding='utf-8')
        self.assertIn('id="collapse-all-button"', page)
        self.assertIn('id="expand-all-button"', page)
        self.assertIn('toggle.setAttribute("aria-expanded", String(!collapsed))', script)
        self.assertIn('function setAllNodesCollapsed(collapsed)', script)
        self.assertIn('.tree-item.collapsed > .tree-list { display: none; }', styles)
        self.assertIn('id="tick-chart"', page)
        self.assertIn('function renderTickChart()', script)
        self.assertIn('/api/v1/bt/snapshots?limit=48', script)
        self.assertIn('const TICK_CHART_LIMIT = 48', script)
        self.assertIn('total: snapshot.nodes.length', script)
        self.assertIn('ui.tickChart.scrollLeft = ui.tickChart.scrollWidth', script)
        self.assertIn('.tick-bar.success', styles)

    def test_debug_state_and_http_controls(self):
        structure = load_tree_definition(TREE_FILE)
        revision = structure['tree_revision']
        snapshots = SnapshotStore(revision)
        events = ServiceEventStore(revision)
        debug_state = DebugStateStore(revision)
        condition_keys = ['node/4', 'node/6']
        debug_state.update_json(debug_state_json(revision, condition_keys))
        calls = []

        def apply_overrides(scenario_id, overrides):
            calls.append(('overrides', scenario_id, overrides))
            return {'ok': True, 'message': 'submitted'}

        def call_control(action):
            calls.append(('control', action))
            return {'ok': True, 'message': action}

        with tempfile.TemporaryDirectory() as directory:
            web = Path(directory)
            for name in ('index.html', 'debug.html', 'app.js', 'debug.js', 'styles.css'):
                (web / name).write_text(name, encoding='utf-8')
            server = ThreadingHTTPServer(
                ('127.0.0.1', 0),
                make_request_handler(
                    snapshots,
                    events,
                    structure,
                    web,
                    debug_state,
                    apply_overrides,
                    call_control,
                ),
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(f'{base_url}/api/v1/debug/state') as response:
                    self.assertTrue(json.load(response)['state']['paused'])
                with urlopen(f'{base_url}/api/v1/debug/config') as response:
                    self.assertEqual(json.load(response)['monitor_port_offset'], 1)
                override_request = Request(
                    f'{base_url}/api/v1/debug/overrides',
                    data=json.dumps({
                        'scenario_id': 'manual',
                        'overrides': {'node/4': 'SUCCESS'},
                    }).encode(),
                    headers={'Content-Type': 'application/json'},
                )
                with urlopen(override_request) as response:
                    self.assertTrue(json.load(response)['ok'])
                control_request = Request(
                    f'{base_url}/api/v1/debug/control',
                    data=b'{"action":"step"}',
                    headers={'Content-Type': 'application/json'},
                )
                with urlopen(control_request) as response:
                    self.assertEqual(json.load(response)['message'], 'step')
                self.assertEqual(calls, [
                    ('overrides', 'manual', {'node/4': 'SUCCESS'}),
                    ('control', 'step'),
                ])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_debug_page_exposes_condition_and_step_controls(self):
        page = (PACKAGE_ROOT / 'web' / 'debug.html').read_text(encoding='utf-8')
        script = (PACKAGE_ROOT / 'web' / 'debug.js').read_text(encoding='utf-8')
        self.assertIn('id="step-button"', page)
        self.assertIn('id="apply-overrides"', page)
        self.assertIn('id="monitor-link"', page)
        self.assertIn('/api/v1/debug/overrides', script)
        self.assertIn('/api/v1/debug/control', script)
        self.assertIn('/api/v1/debug/config', script)
        self.assertIn('currentPort + config.monitor_port_offset', script)

    def test_debug_launch_separates_control_and_monitor_ports(self):
        launch = (PACKAGE_ROOT / 'launch' / 'bt_debug.launch.py').read_text(encoding='utf-8')
        self.assertIn("DeclareLaunchArgument('http_port', default_value='8089')", launch)
        self.assertIn("DeclareLaunchArgument('monitor_http_port', default_value='8090')", launch)
        self.assertIn("name='bt_debug_web'", launch)
        self.assertIn("name='bt_debug_monitor_web'", launch)
        self.assertIn("LaunchConfiguration('monitor_http_port')", launch)


if __name__ == '__main__':
    unittest.main()
