#!/usr/bin/env python3
"""Pure XML, storage, and HTTP helpers for the read-only BT Web viewer."""

from __future__ import annotations

from collections import deque
from http.server import BaseHTTPRequestHandler
import json
from pathlib import Path
import threading
import time
from typing import Any
from urllib.parse import parse_qs, urlparse
import xml.etree.ElementTree as ET


VALID_STATUSES = {'IDLE', 'RUNNING', 'SUCCESS', 'FAILURE'}
CONTROL_TAGS = {'Sequence', 'Fallback', 'Parallel'}
DECORATOR_TAGS = {'Inverter', 'Retry', 'Repeat', 'ForceSuccess', 'ForceFailure'}
CONDITION_TAGS = {
    'AlwaysSuccess', 'AlwaysFailure', 'CompareBlackboard', 'CheckBool',
    'CooldownCondition', 'BlackboardExists', 'ScalarThreshold',
    'WaitUntilElapsed', 'FunctionCondition', 'RosTopicCondition',
    'IsObstacleClose', 'IsFlagTrue', 'IsDocked',
}
FNV_OFFSET = 14_695_981_039_346_656_037
FNV_PRIME = 1_099_511_628_211


class SnapshotValidationError(ValueError):
    """Raised when a tree snapshot does not match the observation contract."""


class ServiceEventValidationError(ValueError):
    """Raised when a service event does not match the observation contract."""


class DebugStateValidationError(ValueError):
    """Raised when a debug state message violates the sandbox contract."""


def _tree_revision(tree_file: Path) -> str:
    value = FNV_OFFSET
    payload = tree_file.name.encode('utf-8') + b'\0' + tree_file.read_bytes() + b'\0'
    for byte in payload:
        value ^= byte
        value = (value * FNV_PRIME) & 0xFFFFFFFFFFFFFFFF
    return f'fnv1a64:{value:016x}'


def _node_kind(tag: str) -> str:
    if tag in CONTROL_TAGS:
        return 'Control'
    if tag in DECORATOR_TAGS:
        return 'Decorator'
    if tag in CONDITION_TAGS:
        return 'Condition'
    return 'Leaf'


def load_tree_definition(tree_file: Path | str) -> dict[str, Any]:
    """Parse one strict bt_core XML file and inline SubTree references."""
    path = Path(tree_file)
    if not path.is_file():
        raise ValueError(f'behavior tree file does not exist: {path}')
    xml_root = ET.parse(path).getroot()
    if xml_root.tag != 'root':
        raise ValueError('behavior tree XML must start with <root>')

    definitions: dict[str, ET.Element] = {}
    first_tree_id = ''
    for behavior_tree in xml_root.findall('BehaviorTree'):
        tree_id = behavior_tree.attrib.get('ID', '')
        children = list(behavior_tree)
        if not tree_id or len(children) != 1:
            raise ValueError('each BehaviorTree needs one non-empty ID and one root node')
        if tree_id in definitions:
            raise ValueError(f'duplicate BehaviorTree ID: {tree_id}')
        definitions[tree_id] = children[0]
        if not first_tree_id:
            first_tree_id = tree_id

    main_tree_id = xml_root.attrib.get('main_tree_to_execute', first_tree_id)
    if main_tree_id not in definitions:
        raise ValueError(f'BehaviorTree ID is not defined: {main_tree_id}')

    next_id = 1

    def convert(element: ET.Element, path_prefix: str, stack: tuple[str, ...]) -> dict[str, Any]:
        nonlocal next_id
        if element.tag == 'SubTree':
            target = element.attrib.get('ID', '')
            if target not in definitions:
                raise ValueError(f'SubTree ID is not defined: {target}')
            if target in stack:
                raise ValueError(f"cyclic SubTree reference: {' -> '.join((*stack, target))}")
            return convert(definitions[target], path_prefix, (*stack, target))

        node_id = next_id
        next_id += 1
        instance_name = element.attrib.get('name', element.tag)
        node_path = f'{path_prefix}/{instance_name}'
        node = {
            'key': f'node/{node_id}',
            'id': node_id,
            'path': node_path,
            'kind': _node_kind(element.tag),
            'registration_name': element.tag,
            'instance_name': instance_name,
            'children': [],
        }
        node['children'] = [
            convert(child, node_path, stack) for child in list(element)
        ]
        return node

    return {
        'schema': 'bt_ros2.bt_structure.v1',
        'tree_revision': _tree_revision(path),
        'main_tree_id': main_tree_id,
        'root': convert(definitions[main_tree_id], main_tree_id, (main_tree_id,)),
    }


def _flatten_tree(root: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = [root]
    for child in root['children']:
        nodes.extend(_flatten_tree(child))
    return nodes


def validate_snapshot(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get('schema') != 'bt_ros2.bt_snapshot.v1':
        raise SnapshotValidationError('unsupported behavior-tree snapshot schema')
    for field in ('session_id', 'tree_revision', 'tree_id', 'root_status'):
        if not isinstance(value.get(field), str) or not value[field]:
            raise SnapshotValidationError(f'{field} must be a non-empty string')
    if value['root_status'] not in VALID_STATUSES:
        raise SnapshotValidationError('invalid root_status')
    if not isinstance(value.get('seq'), int) or value['seq'] < 0:
        raise SnapshotValidationError('seq must be a non-negative integer')
    if not isinstance(value.get('steady_time_ms'), int):
        raise SnapshotValidationError('steady_time_ms must be an integer')
    if not isinstance(value.get('nodes'), list):
        raise SnapshotValidationError('nodes must be an array')
    seen: set[str] = set()
    for node in value['nodes']:
        if not isinstance(node, dict) or not isinstance(node.get('key'), str):
            raise SnapshotValidationError('each node needs a string key')
        if node['key'] in seen:
            raise SnapshotValidationError(f"duplicate node key: {node['key']}")
        seen.add(node['key'])
        if node.get('status') not in VALID_STATUSES:
            raise SnapshotValidationError('invalid node status')
        if node.get('override', 'AUTO') not in {'AUTO', 'SUCCESS', 'FAILURE'}:
            raise SnapshotValidationError('invalid node override')
    return value


def validate_service_event(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get('schema') != 'bt_ros2.service_event.v1':
        raise ServiceEventValidationError('unsupported service event schema')
    for field in ('call_id', 'session_id', 'tree_revision', 'interface', 'phase'):
        if not isinstance(value.get(field), str) or not value[field]:
            raise ServiceEventValidationError(f'{field} must be a non-empty string')
    if value.get('kind') != 'service':
        raise ServiceEventValidationError('kind must be service')
    for field in ('event_seq', 'tick_seq', 'duration_ms'):
        if not isinstance(value.get(field), int) or value[field] < 0:
            raise ServiceEventValidationError(f'{field} must be a non-negative integer')
    if not isinstance(value.get('request'), dict) or not isinstance(value.get('result'), dict):
        raise ServiceEventValidationError('request and result must be objects')
    return value


class ObservationStore:
    """Thread-safe, session-aware bounded storage for ROS JSON events."""

    def __init__(self, tree_revision: str, history_limit: int = 240) -> None:
        if not tree_revision or history_limit <= 0:
            raise ValueError('tree_revision and a positive history_limit are required')
        self._tree_revision = tree_revision
        self._history: deque[dict[str, Any]] = deque(maxlen=history_limit)
        self._session_id: str | None = None
        self._lock = threading.Lock()

    def _append(self, value: dict[str, Any], sequence_field: str, payload_field: str) -> None:
        if value['tree_revision'] != self._tree_revision:
            raise ValueError('event tree_revision does not match the loaded XML')
        entry = {'received_at_unix_ms': time.time_ns() // 1_000_000, payload_field: value}
        with self._lock:
            if self._session_id != value['session_id']:
                self._history.clear()
                self._session_id = value['session_id']
            elif (
                self._history
                and value[sequence_field]
                <= self._history[-1][payload_field][sequence_field]
            ):
                raise ValueError(f'{sequence_field} must increase within a session')
            self._history.append(entry)

    def latest(self) -> dict[str, Any]:
        with self._lock:
            return (
                {'available': False}
                if not self._history
                else {'available': True, **self._history[-1]}
            )

    def history(self, limit: int) -> dict[str, Any]:
        with self._lock:
            return {'entries': list(self._history)[-max(1, min(limit, 240)):]}


class SnapshotStore(ObservationStore):

    def update_json(self, raw: str) -> None:
        self._append(validate_snapshot(json.loads(raw)), 'seq', 'snapshot')


class ServiceEventStore(ObservationStore):

    def update_json(self, raw: str) -> None:
        self._append(validate_service_event(json.loads(raw)), 'event_seq', 'event')


class DebugStateStore:
    """Thread-safe latest-value store for the isolated debug executor state."""

    def __init__(self, tree_revision: str) -> None:
        self._tree_revision = tree_revision
        self._state: dict[str, Any] | None = None
        self._lock = threading.Lock()

    def update_json(self, raw: str) -> None:
        value = json.loads(raw)
        if not isinstance(value, dict) or value.get('schema') != 'bt_ros2.debug_state.v1':
            raise DebugStateValidationError('unsupported debug state schema')
        for field in ('session_id', 'tree_revision', 'scenario_id', 'mode'):
            if not isinstance(value.get(field), str) or not value[field]:
                raise DebugStateValidationError(f'{field} must be a non-empty string')
        if value['tree_revision'] != self._tree_revision:
            raise DebugStateValidationError('debug state tree_revision does not match XML')
        if value['mode'] not in {'running', 'paused'}:
            raise DebugStateValidationError('debug mode must be running or paused')
        if not isinstance(value.get('paused'), bool):
            raise DebugStateValidationError('paused must be boolean')
        if value['paused'] != (value['mode'] == 'paused'):
            raise DebugStateValidationError('paused must agree with mode')
        if not isinstance(value.get('tick_seq'), int) or value['tick_seq'] < 0:
            raise DebugStateValidationError('tick_seq must be a non-negative integer')
        keys = value.get('condition_node_keys')
        if not isinstance(keys, list) or not all(isinstance(key, str) and key for key in keys):
            raise DebugStateValidationError('condition_node_keys must contain strings')
        if len(keys) != len(set(keys)):
            raise DebugStateValidationError('condition_node_keys must be unique')
        overrides = value.get('overrides')
        if not isinstance(overrides, dict) or not all(
            isinstance(key, str) and state in {'SUCCESS', 'FAILURE'}
            for key, state in overrides.items()
        ):
            raise DebugStateValidationError('overrides must contain condition results')
        if not set(overrides).issubset(keys):
            raise DebugStateValidationError('override keys must be condition node keys')
        with self._lock:
            self._state = value

    def latest(self) -> dict[str, Any]:
        with self._lock:
            return {'available': self._state is not None, 'state': self._state}


def make_request_handler(
    snapshots: SnapshotStore,
    service_events: ServiceEventStore,
    tree_definition: dict[str, Any],
    web_root: Path | str,
    debug_state: DebugStateStore | None = None,
    apply_overrides: Any = None,
    call_control: Any = None,
) -> type[BaseHTTPRequestHandler]:
    root = Path(web_root).resolve()
    debug_enabled = debug_state is not None
    static_files = {
        '/': (
            'debug.html' if debug_enabled else 'index.html',
            'text/html; charset=utf-8',
        ),
        '/index.html': ('index.html', 'text/html; charset=utf-8'),
        '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
        '/styles.css': ('styles.css', 'text/css; charset=utf-8'),
    }
    if debug_enabled:
        static_files.update({
            '/debug.html': ('debug.html', 'text/html; charset=utf-8'),
            '/debug.js': ('debug.js', 'text/javascript; charset=utf-8'),
        })

    class BtWebRequestHandler(BaseHTTPRequestHandler):

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self'",
            )
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: Any) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
            self._send(status, body, 'application/json; charset=utf-8')

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            if parsed.path == '/api/v1/health':
                self._json(200, {'ok': True, 'source': 'ros2', 'version': '1'})
                return
            if parsed.path == '/api/v1/bt/structure':
                self._json(200, tree_definition)
                return
            if parsed.path == '/api/v1/bt/snapshots/latest':
                self._json(200, snapshots.latest())
                return
            if parsed.path in {'/api/v1/bt/snapshots', '/api/v1/bt/service-events'}:
                try:
                    limit = int(query.get('limit', ['60'])[0])
                except ValueError:
                    self._json(400, {'ok': False, 'error': 'limit must be an integer'})
                    return
                store = snapshots if parsed.path.endswith('snapshots') else service_events
                self._json(200, store.history(limit))
                return
            if parsed.path == '/api/v1/bt/service-events/latest':
                self._json(200, service_events.latest())
                return
            if parsed.path == '/api/v1/debug/state' and debug_state is not None:
                self._json(200, debug_state.latest())
                return
            if parsed.path in static_files:
                filename, content_type = static_files[parsed.path]
                asset = root / filename
                if asset.is_file() and asset.parent == root:
                    self._send(200, asset.read_bytes(), content_type)
                else:
                    self._json(404, {'ok': False, 'error': 'asset not found'})
                return
            self._json(404, {'ok': False, 'error': 'not found'})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if not debug_enabled:
                self._json(405, {'ok': False, 'error': 'read-only endpoint'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 65_536:
                    raise ValueError('request body size is invalid')
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError('request body must be an object')
                if parsed.path == '/api/v1/debug/overrides':
                    scenario_id = payload.get('scenario_id', 'manual')
                    overrides = payload.get('overrides', {})
                    if not isinstance(scenario_id, str) or not scenario_id:
                        raise ValueError('scenario_id must be a non-empty string')
                    if not isinstance(overrides, dict):
                        raise ValueError('overrides must be an object')
                    valid_keys = {
                        node['key'] for node in _flatten_tree(tree_definition['root'])
                        if node['kind'] == 'Condition'
                    }
                    for key, state in overrides.items():
                        if key not in valid_keys:
                            raise ValueError(f'unknown condition node key: {key}')
                        if state not in {'AUTO', 'SUCCESS', 'FAILURE'}:
                            raise ValueError('override must be AUTO, SUCCESS, or FAILURE')
                    if apply_overrides is None:
                        raise RuntimeError('debug override publisher is not configured')
                    self._json(200, apply_overrides(scenario_id, overrides))
                    return
                if parsed.path == '/api/v1/debug/control':
                    action = payload.get('action')
                    if action not in {'pause', 'resume', 'step', 'reload'}:
                        raise ValueError('unsupported debug action')
                    if call_control is None:
                        raise RuntimeError('debug service client is not configured')
                    self._json(200, call_control(action))
                    return
                self._json(404, {'ok': False, 'error': 'not found'})
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                self._json(400, {'ok': False, 'error': str(error)})
            except RuntimeError as error:
                self._json(503, {'ok': False, 'error': str(error)})

        def log_message(self, format_string: str, *args: object) -> None:
            return

    return BtWebRequestHandler
