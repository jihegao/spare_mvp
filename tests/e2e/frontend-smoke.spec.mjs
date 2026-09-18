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

test('equipment splitter responds immediately after its layout shrinks', async ({ page }) => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../front/app.js', import.meta.url), 'utf8');
  const binding = source.slice(source.indexOf('function bindEquipmentTreeResize()'), source.indexOf('\nfunction bindEvents()'));
  await page.setViewportSize({ width: 1600, height: 900 });
  const css = await readFile(new URL('../../front/styles.css', import.meta.url), 'utf8');
  await page.setContent(`
    <style>${css}</style>
    <div id="split-test"><div class="organization-layout equipment-modeling-layout" style="width:1400px">
      <aside class="tree-container equipment-modeling-tree">
        <div data-equipment-tree-resize class="equipment-tree-resize" tabindex="0" role="separator"></div>
      </aside><section class="detail-panel">details</section>
    </div></div>`);
  await page.addScriptTag({ content: `const app = document.querySelector('#split-test'); let equipmentTreeWidth = 300; ${binding}; bindEquipmentTreeResize();` });
  const handle = page.locator('[data-equipment-tree-resize]');
  const tree = page.locator('.equipment-modeling-tree');
  await expect(handle).toHaveAttribute('aria-valuenow', '300');
  await expect(handle).toHaveAttribute('aria-valuemax', '900');
  await handle.focus();
  await handle.press('End');
  expect((await tree.boundingBox()).width).toBe(900);
  await page.locator('.equipment-modeling-layout').evaluate(el => { el.style.width = '1100px'; });
  expect((await tree.boundingBox()).width).toBe(768);
  await expect(handle).toHaveAttribute('aria-valuenow', '768');
  await expect(handle).toHaveAttribute('aria-valuemax', '768');
  await handle.press('ArrowLeft');
  expect((await tree.boundingBox()).width).toBe(748);
  await expect(handle).toHaveAttribute('aria-valuenow', '748');
  await expect(handle).toHaveAttribute('aria-valuemax', '768');
  await handle.press('End');
  expect((await tree.boundingBox()).width).toBe(768);
  await handle.press('Home');
  expect((await tree.boundingBox()).width).toBe(300);
  await page.locator('#split-test').evaluate(el => { el.innerHTML = ''; });
  await page.locator('#split-test').evaluate(el => {
    el.innerHTML = '<div class="organization-layout equipment-modeling-layout" style="width:1000px;--equipment-tree-width:700px"><aside class="tree-container equipment-modeling-tree"><div data-equipment-tree-resize class="equipment-tree-resize" tabindex="0" role="separator"></div></aside><section>details</section></div>';
  });
  await expect(handle).toHaveAttribute('aria-valuenow', '668');
  await expect(handle).toHaveAttribute('aria-valuemax', '668');
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(handle).toBeHidden();
});
