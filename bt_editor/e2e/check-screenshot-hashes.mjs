/**
 * @author lovelyyoshino
 * @date 2026-07-13
 * @version v1.0.0
 * @last_modified 2026-07-13
 * @changelog
 *   - v1.0.0 (2026-07-13): 拒绝缺失、空白或内容重复的文档截图
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const screenshotDir = path.resolve(process.cwd(), '../docs/blog/screenshots');
const names = [
  '01_editor_loaded.png',
  '02_sample_tree.png',
  '03_tick_colored.png',
  '04_tick_highlight_fixed.png',
];

const hashes = [];
for (const name of names) {
  const data = await readFile(path.join(screenshotDir, name));
  if (data.length < 10_000) {
    throw new Error(`${name} is unexpectedly small (${data.length} bytes)`);
  }
  const hash = createHash('sha256').update(data).digest('hex');
  hashes.push(hash);
  console.log(`${hash}  ${name}`);
}

if (new Set(hashes).size !== names.length) {
  throw new Error('documentation screenshots must contain four distinct states');
}
