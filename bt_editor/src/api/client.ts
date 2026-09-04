/**
 * client.ts - bt_server HTTP API 客户端。
 *
 * 封装与 bt_server 的所有 HTTP 交互。树 API 统一使用 /api 相对路径；ROS2 图通过
 * App 指定的本机 bridge 代理读取，不能把只读 ROS 网关冒充树执行后端。
 *
 * @author pony
 * @date 2026-06-30
 * @version v1.4.0
 * @last_modified 2026-08-21
 * @changelog
 *   - v1.4.0 (2026-08-21): ROS2 图由编辑器固定连接本机 bridge 代理
 *   - v1.3.0 (2026-08-19): normalize legacy ROS capability snapshots without service/action arrays
 *   - v1.2.0 (2026-08-18): ROS2 能力请求支持独立来源地址
 *   - v1.1.0 (2026-08-18): 保留后端 JSON 错误详情，避免只显示 HTTP 状态码
 */

import type {
  NodeManifest,
  LoadResult,
  ExportResult,
  TickResult,
  RunResult,
  ValidateResult,
  FormatResult,
  HealthResult,
  RosCapabilitiesResponse,
  BlackboardEntry,
} from '../types';

/** 统一的 JSON 请求封装：检查 HTTP 状态码并解析 JSON */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    // bt_server 会在 error 字段中返回可操作原因，不能只保留模糊的 HTTP 状态码。
    const text = await resp.text();
    let detail = text.trim();
    if (detail) {
      try {
        const body = JSON.parse(detail) as { error?: unknown; message?: unknown };
        if (typeof body.error === 'string') detail = body.error;
        else if (typeof body.message === 'string') detail = body.message;
      } catch {
        // 非 JSON 错误（例如代理返回纯文本）原样保留，便于定位代理或旧后端问题。
      }
    }
    const suffix = detail ? `：${detail}` : '';
    throw new Error(`HTTP ${resp.status} ${resp.statusText} @ ${url}${suffix}`);
  }
  return (await resp.json()) as T;
}

/** GET /api/nodes —— 拉取所有已注册节点的 manifest */
export async function fetchNodes(): Promise<NodeManifest[]> {
  return requestJson<NodeManifest[]>('/api/nodes');
}

/** POST /api/tree/load —— 把 XML 发给后端构建树 */
export async function loadTree(xml: string): Promise<LoadResult> {
  return requestJson<LoadResult>('/api/tree/load', {
    method: 'POST',
    body: JSON.stringify({ xml }),
  });
}

/** POST /api/tree/blackboard —— 给已加载的普通 bt_server 写入一个初始化值。 */
export async function seedBlackboard(entry: BlackboardEntry): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>('/api/tree/blackboard', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

/** POST /api/tree/validate —— 只校验 XML，不替换后端当前树 */
export async function validateTree(xml: string): Promise<ValidateResult> {
  return requestJson<ValidateResult>('/api/tree/validate', {
    method: 'POST',
    body: JSON.stringify({ xml }),
  });
}

/** POST /api/tree/format —— 只格式化 XML，不替换后端当前树 */
export async function formatTree(xml: string): Promise<FormatResult> {
  return requestJson<FormatResult>('/api/tree/format', {
    method: 'POST',
    body: JSON.stringify({ xml }),
  });
}

/** GET /api/tree/export —— 从后端取当前树的 XML */
export async function exportTree(): Promise<ExportResult> {
  return requestJson<ExportResult>('/api/tree/export');
}

/** POST /api/tree/tick —— 执行一拍并取回每个节点的运行态 */
export async function tickTree(): Promise<TickResult> {
  return requestJson<TickResult>('/api/tree/tick', { method: 'POST' });
}

/** POST /api/tree/run —— 跑到终态并返回状态变化序列 */
export async function runTree(): Promise<RunResult> {
  return requestJson<RunResult>('/api/tree/run', { method: 'POST' });
}

/** GET /api/health —— 健康检查，返回后端版本 */
export async function checkHealth(): Promise<HealthResult> {
  return requestJson<HealthResult>('/api/health');
}

/**
 * GET /api/v1/bt/capabilities —— 可选 ROS-aware backend 的运行时能力快照。
 * 普通 bt_server 没有该接口，调用方应把 404 当成“无动态发现”而不是错误弹窗。
 */
export async function fetchRosCapabilities(
  url = '/api/v1/bt/capabilities',
): Promise<RosCapabilitiesResponse> {
  const response = await requestJson<RosCapabilitiesResponse>(url);
  if (!response.capabilities) return response;
  return {
    ...response,
    capabilities: {
      ...response.capabilities,
      services: response.capabilities.services ?? [],
      actions: response.capabilities.actions ?? [],
    },
  };
}
