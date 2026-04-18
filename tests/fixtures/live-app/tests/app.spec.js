const { test, expect } = require('@playwright/test');

test('loads data from the live fixture app', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#message')).toHaveText('Kernel ready');
});

test('missing CTA test id is surfaced to AOK as a real browser failure', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('launch-cta').click();
});
