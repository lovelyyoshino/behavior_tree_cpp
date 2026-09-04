/**
 * tree-import-fixture.ts — Playwright 共用的行为树文件导入夹具
 *
 * @author pony
 * @date 2026-08-21
 * @version v1.0.0
 * @last_modified 2026-08-21
 * @changelog
 *   - v1.0.0 (2026-08-21): 统一通过文件输入覆盖树与黑板导入流程
 */

import type { Page } from '@playwright/test';

export const SAMPLE_TREE_XML = `<root main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <Sequence name="巡逻序列">
      <PrintMessage message="开始巡逻"/>
      <Fallback name="选择分支">
        <Inverter>
          <AlwaysSuccess/>
        </Inverter>
        <PrintMessage message="走兜底分支"/>
      </Fallback>
      <Retry num_attempts="2">
        <AlwaysSuccess/>
      </Retry>
    </Sequence>
  </BehaviorTree>
</root>`;

export async function importTreeFile(
  page: Page,
  xml = SAMPLE_TREE_XML,
  name = 'sample.xml',
): Promise<void> {
  await page.getByLabel('选择行为树 XML 或树黑板配置包').setInputFiles({
    name,
    mimeType: name.endsWith('.json') ? 'application/json' : 'application/xml',
    buffer: Buffer.from(xml),
  });
}
