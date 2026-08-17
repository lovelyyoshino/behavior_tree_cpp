from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from bt_web_core import (
    DebugStateStore,
    load_tree_definition,
    make_request_handler,
    ServiceEventStore,
    SnapshotStore,
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

    def test_http_adapter_is_read_only(self):
        structure = load_tree_definition(TREE_FILE)
        snapshots = SnapshotStore(structure['tree_revision'])
        events = ServiceEventStore(structure['tree_revision'])
        snapshots.update_json(snapshot_json(structure['tree_revision']))
        events.update_json(service_event_json(structure['tree_revision']))
        with tempfile.TemporaryDirectory() as directory:
            web = Path(directory)
            (web / 'index.html').write_text('viewer', encoding='utf-8')
            (web / 'app.js').write_text('', encoding='utf-8')
            (web / 'styles.css').write_text('', encoding='utf-8')
            server = ThreadingHTTPServer(
                ('127.0.0.1', 0), make_request_handler(snapshots, events, structure, web)
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(f'{base_url}/api/v1/bt/snapshots/latest') as response:
                    self.assertEqual(json.load(response)['snapshot']['seq'], 1)
                with urlopen(f'{base_url}/api/v1/bt/service-events') as response:
                    self.assertEqual(len(json.load(response)['entries']), 1)
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
        self.assertIn('/api/v1/debug/overrides', script)
        self.assertIn('/api/v1/debug/control', script)


if __name__ == '__main__':
    unittest.main()
