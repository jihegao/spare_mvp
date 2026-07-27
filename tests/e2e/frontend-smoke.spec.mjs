import { expect, test } from '@playwright/test';

test('front index page is reachable', async ({ page }) => {
  const response = await page.goto('/front/index.html');
  expect(response).not.toBeNull();
  expect(response?.status()).toBe(200);
});

test('RMS equipment tree expands its desktop panel to the expanded tree width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/front/index.html');
  await page.setContent(`
    <link rel="stylesheet" href="/front/styles.css">
    <main class="organization-layout equipment-layout rms-layout" style="width: 1200px">
      <aside class="tree-container rms-equipment-tree">
        <div class="object-tree rms-equipment-tree-list">
          <div class="tree-node-item">
            <div class="tree-node-row"><button class="tree-node-label"><span class="tree-node-toggle">•</span><span class="tree-node-text">飞机</span></button></div>
            <div class="tree-node-children"><div class="tree-node-item"><div class="tree-node-row"><button class="tree-node-label"><span class="tree-node-toggle">•</span><span class="tree-node-text">超长名称装备系统用于验证展开层级的面板自适应宽度</span><span class="tree-node-meta">分系统 / 运行比 1</span></button></div></div></div>
          </div>
        </div>
      </aside>
      <section class="detail-panel">安装数详情</section>
    </main>
  `);
  await page.waitForFunction(() => Array.from(document.styleSheets).some((sheet) => sheet.href?.endsWith('/front/styles.css')));

  const { panelWidth, detailWidth } = await page.locator('.rms-layout').evaluate((layout) => {
    const panel = layout.querySelector('.rms-equipment-tree');
    const detail = layout.querySelector('.detail-panel');
    return {
      panelWidth: panel.getBoundingClientRect().width,
      detailWidth: detail.getBoundingClientRect().width
    };
  });

  expect(panelWidth).toBeGreaterThan(300);
  expect(panelWidth).toBeLessThanOrEqual(560);
  expect(detailWidth).toBeGreaterThan(0);
});
