#!/usr/bin/env python3
"""Launch an isolated behavior-tree debug executor and Web control surface."""

import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, SetEnvironmentVariable
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    package_share = get_package_share_directory('bt_ros2')
    default_tree = os.path.join(package_share, 'trees', 'example.xml')

    arguments = [
        DeclareLaunchArgument('ros_domain_id', default_value='77'),
        DeclareLaunchArgument('tree_file', default_value=default_tree),
        DeclareLaunchArgument('tick_rate_hz', default_value='2.0'),
        DeclareLaunchArgument('bind_address', default_value='127.0.0.1'),
        DeclareLaunchArgument('http_port', default_value='8089'),
        DeclareLaunchArgument('monitor_http_port', default_value='8090'),
    ]

    executor = Node(
        package='bt_ros2',
        executable='bt_executor',
        name='bt_debug_executor',
        output='screen',
        parameters=[{
            'tree_file': LaunchConfiguration('tree_file'),
            'tick_rate_hz': ParameterValue(
                LaunchConfiguration('tick_rate_hz'), value_type=float
            ),
            'autostart': False,
            'stop_on_terminal': False,
            'debug_mode': True,
            'status_topic': '~/bt_status',
            'snapshot_topic': '~/tree_snapshot',
            'service_event_topic': '~/service_event',
            'debug_state_topic': '~/debug_state',
            'debug_override_topic': '~/debug_overrides',
        }],
    )

    debug_web = Node(
        package='bt_ros2',
        executable='bt_web',
        name='bt_debug_web',
        output='screen',
        parameters=[{
            'tree_file': LaunchConfiguration('tree_file'),
            'bind_address': LaunchConfiguration('bind_address'),
            'http_port': ParameterValue(
                LaunchConfiguration('http_port'), value_type=int
            ),
            'monitor_http_port': ParameterValue(
                LaunchConfiguration('monitor_http_port'), value_type=int
            ),
            'snapshot_topic': '/bt_debug_executor/tree_snapshot',
            'service_event_topic': '/bt_debug_executor/service_event',
            'debug_mode': True,
            'debug_state_topic': '/bt_debug_executor/debug_state',
            'debug_override_topic': '/bt_debug_executor/debug_overrides',
            'debug_service_prefix': '/bt_debug_executor',
        }],
    )

    monitor_web = Node(
        package='bt_ros2',
        executable='bt_web',
        name='bt_debug_monitor_web',
        output='screen',
        parameters=[{
            'tree_file': LaunchConfiguration('tree_file'),
            'bind_address': LaunchConfiguration('bind_address'),
            'http_port': ParameterValue(
                LaunchConfiguration('monitor_http_port'), value_type=int
            ),
            'snapshot_topic': '/bt_debug_executor/tree_snapshot',
            'service_event_topic': '/bt_debug_executor/service_event',
            'history_limit': 240,
        }],
    )

    return LaunchDescription([
        *arguments,
        SetEnvironmentVariable('ROS_DOMAIN_ID', LaunchConfiguration('ros_domain_id')),
        executor,
        debug_web,
        monitor_web,
    ])
