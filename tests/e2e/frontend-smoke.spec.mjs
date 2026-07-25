import { expect, test } from '@playwright/test';

test('front index page is reachable', async ({ page }) => {
  const response = await page.goto('/front/index.html');
  expect(response).not.toBeNull();
  expect(response?.status()).toBe(200);
});
