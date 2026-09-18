import {test, expect} from '@playwright/test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/spare_mvp_abm/aircraft_support_v1/solara_app.py', import.meta.url), 'utf8');
const style = source.match(/VISUAL_SIMULATION_STYLE = """([\s\S]*?)"""/)[1];

test('Solara controls override Vuetify purple for current and legacy primary classes', async ({page}) => {
  // Current classes and purple default were observed on native Edge/Solara.
  await page.setContent(`<style>.bg-primary,.primary {background:rgb(98,0,238) !important}</style>
    <style>${style}</style><main class="visual-simulation-page">
    ${['bg-primary','primary'].map(primary => `<section>${['重置','推演','单步推进'].map(label => `<button class="v-btn ${primary}">${label}</button>`).join('')}</section>`).join('')}
    </main>`);
  for (const button of await page.getByRole('button').all()) {
    await expect(button).toHaveCSS('background-color', 'rgb(15, 92, 191)');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
  }
});
