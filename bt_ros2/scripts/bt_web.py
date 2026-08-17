#!/usr/bin/env python3
"""ROS2-to-HTTP adapter for read-only behavior-tree visualization."""

from __future__ import annotations

from http.server import ThreadingHTTPServer
from pathlib import Path
import threading

from ament_index_python.packages import get_package_share_directory
from bt_web_core import (
    DebugStateStore,
    load_tree_definition,
    make_request_handler,
    ServiceEventStore,
    SnapshotStore,
)
import rclpy
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import String
from std_srvs.srv import Trigger


class BtWebNode(Node):

    def __init__(self) -> None:
        super().__init__('bt_web')
        package_share = Path(get_package_share_directory('bt_ros2'))
        self.declare_parameter('bind_address', '127.0.0.1')
        self.declare_parameter('http_port', 8088)
        self.declare_parameter('monitor_http_port', 8090)
        self.declare_parameter('tree_file', str(package_share / 'trees' / 'example.xml'))
        self.declare_parameter('snapshot_topic', '/bt_executor/tree_snapshot')
        self.declare_parameter('service_event_topic', '/bt_executor/service_event')
        self.declare_parameter('history_limit', 240)
        self.declare_parameter('debug_mode', False)
        self.declare_parameter('debug_state_topic', '/bt_debug_executor/debug_state')
        self.declare_parameter('debug_override_topic', '/bt_debug_executor/debug_overrides')
        self.declare_parameter('debug_service_prefix', '/bt_debug_executor')

        bind_address = self.get_parameter('bind_address').value
        http_port = self.get_parameter('http_port').value
        monitor_http_port = self.get_parameter('monitor_http_port').value
        history_limit = self.get_parameter('history_limit').value
        debug_mode = self.get_parameter('debug_mode').value
        if not isinstance(bind_address, str) or not bind_address:
            raise ValueError('bind_address must be a non-empty string')
        if not isinstance(http_port, int) or not 1 <= http_port <= 65535:
            raise ValueError('http_port must be in [1, 65535]')
        if not isinstance(monitor_http_port, int) or not 1 <= monitor_http_port <= 65535:
            raise ValueError('monitor_http_port must be in [1, 65535]')
        if debug_mode and monitor_http_port == http_port:
            raise ValueError('debug and monitor HTTP ports must be different')
        if not isinstance(history_limit, int) or history_limit <= 0:
            raise ValueError('history_limit must be positive')

        tree_definition = load_tree_definition(self.get_parameter('tree_file').value)
        self._snapshots = SnapshotStore(tree_definition['tree_revision'], history_limit)
        self._service_events = ServiceEventStore(tree_definition['tree_revision'], history_limit)
        self._debug_state = (
            DebugStateStore(tree_definition['tree_revision']) if debug_mode else None
        )
        self._debug_override_publisher = None
        self._debug_clients: dict[str, object] = {}
        if debug_mode:
            override_topic = self.get_parameter('debug_override_topic').value
            service_prefix = self.get_parameter('debug_service_prefix').value.rstrip('/')
            self._debug_override_publisher = self.create_publisher(String, override_topic, 10)
            self._debug_clients = {
                action: self.create_client(Trigger, f'{service_prefix}/{action}')
                for action in ('pause', 'resume', 'step', 'reload')
            }
        handler = make_request_handler(
            self._snapshots,
            self._service_events,
            tree_definition,
            package_share / 'web',
            self._debug_state,
            self._apply_overrides if debug_mode else None,
            self._call_control if debug_mode else None,
            monitor_http_port - http_port if debug_mode else None,
        )
        self._server = ThreadingHTTPServer((bind_address, http_port), handler)
        self._server_thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._server_thread.start()

        snapshot_qos = QoSProfile(
            depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        event_qos = QoSProfile(
            depth=max(1, min(history_limit, 64)),
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        self._snapshot_subscription = self.create_subscription(
            String, self.get_parameter('snapshot_topic').value, self._on_snapshot, snapshot_qos
        )
        self._event_subscription = self.create_subscription(
            String,
            self.get_parameter('service_event_topic').value,
            self._on_service_event,
            event_qos,
        )
        self._debug_state_subscription = None
        if debug_mode:
            self._debug_state_subscription = self.create_subscription(
                String,
                self.get_parameter('debug_state_topic').value,
                self._on_debug_state,
                QoSProfile(
                    depth=1,
                    reliability=ReliabilityPolicy.RELIABLE,
                    durability=DurabilityPolicy.TRANSIENT_LOCAL,
                ),
            )
            self.get_logger().warn(
                f'DEBUG SANDBOX Web control listening on http://{bind_address}:{http_port}'
            )
        else:
            self.get_logger().info(
                f'BT Web viewer listening on http://{bind_address}:{http_port}'
            )

    def _on_snapshot(self, message: String) -> None:
        try:
            self._snapshots.update_json(message.data)
        except (ValueError, TypeError) as error:
            self.get_logger().error(f'rejected tree snapshot: {error}')

    def _on_service_event(self, message: String) -> None:
        try:
            self._service_events.update_json(message.data)
        except (ValueError, TypeError) as error:
            self.get_logger().error(f'rejected service event: {error}')

    def _on_debug_state(self, message: String) -> None:
        try:
            self._debug_state.update_json(message.data)
        except (ValueError, TypeError) as error:
            self.get_logger().error(f'rejected debug state: {error}')

    def _apply_overrides(
        self, scenario_id: str, overrides: dict[str, str]
    ) -> dict[str, object]:
        if any(character in scenario_id for character in '|,\r\n'):
            raise RuntimeError('scenario_id contains a reserved separator')
        if self._debug_override_publisher.get_subscription_count() == 0:
            raise RuntimeError('debug executor override subscriber is not ready')
        active = {
            key: value for key, value in overrides.items() if value != 'AUTO'
        }
        assignments = ','.join(f'{key}={active[key]}' for key in sorted(active))
        message = String()
        message.data = f'{scenario_id}|{assignments}'
        self._debug_override_publisher.publish(message)
        return {
            'ok': True,
            'scenario_id': scenario_id,
            'message': 'debug overrides submitted atomically',
            'overrides': active,
        }

    def _call_control(self, action: str) -> dict[str, object]:
        client = self._debug_clients[action]
        if not client.service_is_ready():
            raise RuntimeError(f'debug {action} service is not ready')
        future = client.call_async(Trigger.Request())
        completed = threading.Event()
        future.add_done_callback(lambda _: completed.set())
        if not completed.wait(timeout=3.0):
            raise RuntimeError(f'debug {action} service timed out')
        response = future.result()
        if response is None:
            raise RuntimeError(f'debug {action} service failed')
        return {'ok': response.success, 'action': action, 'message': response.message}

    def destroy_node(self) -> bool:
        self._server.shutdown()
        self._server.server_close()
        self._server_thread.join(timeout=2.0)
        return super().destroy_node()


def main(args: list[str] | None = None) -> None:
    rclpy.init(args=args)
    node = BtWebNode()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
