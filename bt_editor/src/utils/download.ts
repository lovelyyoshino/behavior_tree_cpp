/**
 * download.ts — 浏览器端文本文件下载辅助。
 *
 * @author pony
 * @date 2026-08-18
 * @version v1.0.0
 * @last_modified 2026-08-18
 * @changelog
 *   - v1.0.0 (2026-08-18): 支持 XML 和行为树配置包下载
 *
 * 该函数只负责把已经生成的文本交给浏览器下载，不参与 XML 或 JSON 序列化，
 * 这样导出格式仍由 App 和 xml 工具统一管理，也方便在无后端时使用。
 */

/** 将文本作为文件下载；调用方负责保证内容已完成校验。 */
export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
