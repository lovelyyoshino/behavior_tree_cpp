#!/usr/bin/env python3
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    package_share = get_package_share_directory('bt_ros2')
    default_tree = os.path.join(package_share, 'trees', 'example.xml')
    arguments = [
        DeclareLaunchArgument('tree_file', default_value=default_tree),
        DeclareLaunchArgument('bind_address', default_value='127.0.0.1'),
        DeclareLaunchArgument('http_port', default_value='8088'),
        DeclareLaunchArgument('snapshot_topic', default_value='/bt_executor/tree_snapshot'),
        DeclareLaunchArgument('service_event_topic', default_value='/bt_executor/service_event'),
        DeclareLaunchArgument('history_limit', default_value='240'),
    ]
    viewer = Node(
        package='bt_ros2',
        executable='bt_web',
        name='bt_web',
        output='screen',
        parameters=[{
            'tree_file': LaunchConfiguration('tree_file'),
            'bind_address': LaunchConfiguration('bind_address'),
            'http_port': LaunchConfiguration('http_port'),
            'snapshot_topic': LaunchConfiguration('snapshot_topic'),
            'service_event_topic': LaunchConfiguration('service_event_topic'),
            'history_limit': LaunchConfiguration('history_limit'),
        }],
    )
    return LaunchDescription([*arguments, viewer])
