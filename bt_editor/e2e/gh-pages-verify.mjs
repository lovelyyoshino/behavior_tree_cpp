import { chromium } from 'playwright';

const BASE = (process.env.BT_PAGES_URL ?? 'https://lovelyyoshino.github.io/behavior_tree_cpp').replace(/\/$/, '');
const pages = ['/', '/behavior_tree_basics.html', '/node_catalog.html', '/function_manual.html', '/quickstart.html', '/scheduling.html', '/editor_playwright.html', '/api_reference.html', '/architecture.html', '/testing_matrix.html', '/pages_deployment.html'];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const page = await ctx.newPage();
let ok = 0;
let fail = 0;
for (const p of pages) {
  const url = BASE + p;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = resp ? resp.status() : 0;
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText.trim() ?? '');
    const healthy = status === 200 && title.length > 0 && text.length > 200;
    console.log(`${healthy ? 'OK ' : 'BAD'} ${status} text=${text.length} title="${title}" ${p}`);
    healthy ? ok++ : fail++;
  } catch (e) {
    console.log(`ERR ${p}: ${e.message.split('\n')[0]}`);
    fail++;
  }
}
// 内容断言：四类节点、反应式变体和核心装饰器必须在已发布页面可见。
await page.goto(BASE + '/behavior_tree_basics.html', { waitUntil: 'domcontentloaded' });
const body = await page.evaluate(() => document.body.innerText);
for (const kw of ['Sequence', 'Fallback', 'Parallel', 'Decorator', 'ReactiveSequence', 'ReactiveFallback', 'PrioritySelector', 'Inverter', 'Retry', 'Repeat', 'ForceSuccess', 'TickRate', 'KeepRunningUntilFailure', 'KeepRunningUntilSuccess']) {
  const present = body.includes(kw);
  console.log(`${present ? 'HAS ' : 'MISS'} ${kw}`);
  if (!present) fail++;
}
if (!body.includes('GitHub Actions') || !body.includes('success')) {
  console.log('MISS deployment guidance/status wording');
  fail++;
}
await browser.close();
console.log(`\n== ${ok} OK / ${fail} FAIL == (${BASE})`);
process.exit(fail > 0 ? 1 : 0);
