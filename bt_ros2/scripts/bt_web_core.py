#!/usr/bin/env python3
"""bt_web_core.py - 只读行为树 Web 观察器的 XML、存储和 HTTP 辅助层。

@author pony
@date 2026-08-17
@version v1.5.0
@last_modified 2026-08-24
@changelog
    - v1.5.0 (2026-08-24): 仅保留当前 graph 中仍存活 executor 的 manifest，并区分 action 内部服务
    - v1.4.0 (2026-08-21): 提供可测试的 ROS graph 快照组装与命名空间归一化
    - v1.3.0 (2026-08-19): 校验 service/action 能力并兼容旧版缺失字段
    - v1.2.0 (2026-08-18): 展开 SubTreePlus，并按自定义节点子节点数量保留结构类别
    - v1.1.0 (2026-08-18): 增加 ROS2 能力快照接口及跨端口编辑器 CORS 契约
    - v1.0.0 (2026-08-17): 初始实现
"""

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
SUBTREE_TAGS = {'SubTree', 'SubTreePlus'}
CONDITION_TAGS = {
    'AlwaysSuccess', 'AlwaysFailure', 'CompareBlackboard', 'CheckBool',
    'CooldownCondition', 'BlackboardExists', 'ScalarThreshold',
    'WaitUntilElapsed', 'FunctionCondition', 'RosTopicCondition',
    'RosGraphCondition',
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


class CapabilitiesValidationError(ValueError):
    """Raised when a runtime ROS capability snapshot is malformed."""


def _tree_revision(tree_file: Path) -> str:
    value = FNV_OFFSET
    payload = tree_file.name.encode('utf-8') + b'\0' + tree_file.read_bytes() + b'\0'
    for byte in payload:
        value ^= byte
        value = (value * FNV_PRIME) & 0xFFFFFFFFFFFFFFFF
    return f'fnv1a64:{value:016x}'


def _node_kind(tag: str, child_count: int = 0) -> str:
    if tag in CONTROL_TAGS:
        return 'Control'
    if tag in DECORATOR_TAGS:
        return 'Decorator'
    if tag in CONDITION_TAGS:
        return 'Condition'
    # Project-specific Yuyi/ROS nodes are not available to the read-only web
    # adapter at import time. Their child arity still gives a useful structural
    # fallback, so the viewer preserves composition instead of labelling every
    # custom wrapper as a leaf.
    if child_count > 1:
        return 'Control'
    if child_count == 1:
        return 'Decorator'
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
        if element.tag in SUBTREE_TAGS:
            target = element.attrib.get('ID', '')
            if target not in definitions:
                raise ValueError(f'{element.tag} ID is not defined: {target}')
            if target in stack:
                raise ValueError(
                    f"cyclic {element.tag} reference: {' -> '.join((*stack, target))}"
                )
            return convert(definitions[target], path_prefix, (*stack, target))

        node_id = next_id
        next_id += 1
        instance_name = element.attrib.get('name', element.tag)
        node_path = f'{path_prefix}/{instance_name}'
        node = {
            'key': f'node/{node_id}',
            'id': node_id,
            'path': node_path,
            'kind': _node_kind(element.tag, len(element)),
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


def validate_capabilities(value: Any) -> dict[str, Any]:
    """校验执行器发布的动态能力，拒绝把未验证的 ROS 图数据交给编辑器。"""
    if not isinstance(value, dict) or value.get('schema') != 'bt_ros2.capabilities.v1':
        raise CapabilitiesValidationError('unsupported capabilities schema')
    if not isinstance(value.get('seq'), int) or value['seq'] < 0:
        raise CapabilitiesValidationError('seq must be a non-negative integer')
    if not isinstance(value.get('executor_node'), str) or not value['executor_node']:
        raise CapabilitiesValidationError('executor_node must be a non-empty string')
    if not isinstance(value.get('ros_nodes'), list) or not all(
        isinstance(name, str) and name for name in value['ros_nodes']
    ):
        raise CapabilitiesValidationError('ros_nodes must contain strings')
    normalized = dict(value)
    # v1 schema originally exposed only topics. Missing arrays are normalized
    # at this read-only boundary so a rolling executor upgrade cannot turn an
    # otherwise valid capability snapshot into an HTTP 500 response.
    normalized.setdefault('services', [])
    normalized.setdefault('actions', [])
    for resource_name in ('topics', 'services', 'actions'):
        resources = normalized.get(resource_name)
        if not isinstance(resources, list):
            raise CapabilitiesValidationError(f'{resource_name} must be an array')
        for resource in resources:
            if (
                not isinstance(resource, dict)
                or not isinstance(resource.get('name'), str)
                or not resource['name']
            ):
                raise CapabilitiesValidationError(
                    f'each {resource_name[:-1]} needs a name'
                )
            if not isinstance(resource.get('types'), list) or not all(
                isinstance(interface_type, str) and interface_type
                for interface_type in resource['types']
            ):
                raise CapabilitiesValidationError(
                    f'{resource_name[:-1]} types must contain strings'
                )
    if not isinstance(normalized.get('manifests'), list):
        raise CapabilitiesValidationError('manifests must be an array')
    return normalized


def _interface_list(values: Any) -> list[dict[str, Any]]:
    """把 rclpy graph 数据转换为稳定、去重、可序列化的接口列表。

    rclpy 的 get_topic_names_and_types() / get_service_names_and_types() 返回
    list[tuple[str, list[str]]]，而内部聚合（如 actions）用 dict。两种形状都要
    支持，否则真实 graph 的 topic/service 会被静默丢成空列表。
    """
    if isinstance(values, dict):
        items = values.items()
    elif isinstance(values, (list, tuple)):
        items = values
    else:
        return []
    result: list[dict[str, Any]] = []
    for entry in sorted(items):
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            continue
        name, interface_types = entry
        if not isinstance(name, str) or not name:
            continue
        types = interface_types if isinstance(interface_types, (list, tuple)) else []
        result.append({
            'name': name,
            'types': sorted({
                item for item in types if isinstance(item, str) and item
            }),
        })
    return result


def _fully_qualified_node_name(name: Any, namespace: Any) -> str | None:
    if not isinstance(name, str) or not name:
        return None
    if name.startswith('/'):
        return name
    if not isinstance(namespace, str) or not namespace:
        namespace = '/'
    normalized_namespace = '/' if namespace == '/' else f'/{namespace.strip("/")}'
    return f'/{name}' if normalized_namespace == '/' else f'{normalized_namespace}/{name}'


def fully_qualified_node_names(node_names_and_namespaces: Any) -> set[str]:
    """把一次 rclpy 节点发现结果归一化为完整名称集合。"""
    if not isinstance(node_names_and_namespaces, (list, tuple)):
        return set()
    return {
        full_name
        for item in node_names_and_namespaces
        if isinstance(item, (list, tuple)) and len(item) == 2
        for full_name in [_fully_qualified_node_name(item[0], item[1])]
        if full_name
    }


def select_live_executor_manifests(
    previous_capabilities: Any,
    node_names_and_namespaces: Any,
    fallback_executor: str,
) -> tuple[str, list[dict[str, Any]]]:
    """只把仍存在于本次 graph 的 executor manifest 交给编辑器。"""
    current_nodes = fully_qualified_node_names(node_names_and_namespaces)
    if isinstance(previous_capabilities, dict):
        executor_node = previous_capabilities.get('executor_node')
        manifests = previous_capabilities.get('manifests')
        if (
            isinstance(executor_node, str)
            and executor_node in current_nodes
            and isinstance(manifests, list)
        ):
            return executor_node, manifests
    return fallback_executor, []


def build_ros_graph_capabilities(
    seq: int,
    executor_node: str,
    node_names_and_namespaces: Any,
    topics: Any,
    services: Any,
    manifests: Any,
) -> dict[str, Any]:
    """从一次 rclpy graph 读取构造编辑器使用的只读能力快照。"""
    nodes = fully_qualified_node_names(node_names_and_namespaces)

    all_service_items = _interface_list(services)
    actions: dict[str, list[str]] = {}
    action_service_names = {
        '/_action/send_goal',
        '/_action/get_result',
        '/_action/cancel_goal',
    }
    for item in all_service_items:
        name = item['name']
        if not any(name.endswith(suffix) for suffix in action_service_names):
            continue
        suffix = next(suffix for suffix in action_service_names if name.endswith(suffix))
        action_name = name[:-len(suffix)]
        if not action_name:
            continue
        for interface_type in item['types']:
            if interface_type.endswith('_SendGoal'):
                actions.setdefault(action_name, []).append(
                    interface_type[:-len('_SendGoal')]
                )

    # Action transport services are implementation details of an action and
    # cannot be called through the generic Trigger/SetBool adapters. Keep them
    # in the action capability list only, so the editor does not offer a
    # misleading ordinary-service candidate.
    service_items = [
        item for item in all_service_items
        if not any(item['name'].endswith(suffix) for suffix in action_service_names)
    ]

    return validate_capabilities({
        'schema': 'bt_ros2.capabilities.v1',
        'seq': seq,
        'executor_node': executor_node,
        'ros_nodes': sorted(nodes),
        'topics': _interface_list(topics),
        'services': service_items,
        'actions': _interface_list(actions),
        'manifests': manifests if isinstance(manifests, list) else [],
    })


class CapabilitiesStore:
    """线程安全地保存最新 ROS 能力；不做历史缓存，避免使用过期 graph。"""

    def __init__(self) -> None:
        self._value: dict[str, Any] | None = None
        self._lock = threading.Lock()

    def update_json(self, raw: str) -> None:
        value = validate_capabilities(json.loads(raw))
        with self._lock:
            self._value = value

    def latest(self) -> dict[str, Any]:
        with self._lock:
            return {'available': self._value is not None, 'capabilities': self._value}


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
    monitor_port_offset: int | None = None,
    capabilities: CapabilitiesStore | None = None,
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
            # 编辑器可把能力来源设为 http://127.0.0.1:8088；开发服务器端口不同，
            # 因此只读观测接口需要允许浏览器读取。bt_web 不在普通模式暴露写接口。
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
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
            if parsed.path == '/api/v1/bt/capabilities':
                if capabilities is None:
                    self._json(404, {'ok': False,
                                     'error': 'runtime ROS capabilities are unavailable'})
                else:
                    self._json(200, capabilities.latest())
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
            if parsed.path == '/api/v1/debug/config' and debug_state is not None:
                self._json(200, {'monitor_port_offset': monitor_port_offset or 1})
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

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._send(204, b'', 'text/plain; charset=utf-8')

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
