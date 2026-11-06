import { expect, test } from '@playwright/test';

test('phone layout switches between plan, 3D and editor tabs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('walkable-house');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.reload();
  await page.getByRole('button', { name: 'Explore demo' }).click();
  const tabs = page.getByRole('navigation', { name: 'Views' });
  await expect(tabs).toBeVisible();
  await expect(page.locator('.plan-pane')).toBeVisible();
  await tabs.getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.view-pane')).toBeVisible();
  await expect(page.locator('.plan-pane')).toBeHidden();
  await tabs.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('.panel')).toBeVisible();
  // No horizontal page scroll
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
