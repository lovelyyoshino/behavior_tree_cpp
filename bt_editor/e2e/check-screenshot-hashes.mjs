/**
 * @author lovelyyoshino
 * @date 2026-07-13
 * @version v1.3.0
 * @last_modified 2026-09-03
 * @changelog
 *   - v1.3.0 (2026-09-03): 纳入行为树基础概念页三张配图；断言改为按清单长度校验
 *   - v1.0.0 (2026-07-13): 拒绝缺失、空白或内容重复的文档截图
 *   - v1.1.0 (2026-07-13): 支持校验发布 gate 的临时截图目录
 *   - v1.2.0 (2026-07-13): 校验 PNG 签名、IHDR 和预期截图尺寸
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const screenshotDir = path.resolve(
  process.cwd(),
  process.env.BT_SCREENSHOT_DIR ?? '../docs/blog/screenshots',
);
// 文档截图门禁清单。只登记由 spec 可复现产出的截图；手工补的历史图片
// (05-14) 没有生成脚本，不在此门禁内，避免用无源文件冒充可复现证据。
const screenshots = [
  { name: '01_editor_loaded.png', width: 2400, height: 740 },
  { name: '02_sample_tree.png', width: 2400, height: 1328 },
  { name: '03_tick_colored.png', width: 2400, height: 1328 },
  { name: '04_tick_highlight_fixed.png', width: 2400, height: 1328 },
  // 行为树基础概念页配图，由 basics-screenshots.spec.ts 产出。
  { name: '15_basics_node_categories.png', width: 640, height: 1328 },
  { name: '16_basics_four_node_types.png', width: 2400, height: 1328 },
  { name: '17_basics_tick_status.png', width: 2400, height: 1328 },
];
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const hashes = [];
for (const { name, width, height } of screenshots) {
  const data = await readFile(path.join(screenshotDir, name));
  if (data.length < 10_000) {
    throw new Error(`${name} is unexpectedly small (${data.length} bytes)`);
  }
  if (
    !data.subarray(0, pngSignature.length).equals(pngSignature) ||
    data.readUInt32BE(8) !== 13 ||
    data.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error(`${name} is not a valid PNG with an IHDR header`);
  }
  const actualWidth = data.readUInt32BE(16);
  const actualHeight = data.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(
      `${name} has unexpected dimensions ${actualWidth}x${actualHeight}; expected ${width}x${height}`,
    );
  }
  const hash = createHash('sha256').update(data).digest('hex');
  hashes.push(hash);
  console.log(`${hash}  ${name}`);
}

if (new Set(hashes).size !== screenshots.length) {
  throw new Error(
    `documentation screenshots must be pairwise distinct states (expected ${screenshots.length} unique hashes, got ${new Set(hashes).size})`,
  );
}
