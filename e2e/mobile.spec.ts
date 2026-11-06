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

test('pinching and swiping the plan never selects or moves anything; a tap selects', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('walkable-house');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.reload();
  await page.getByRole('button', { name: 'Explore demo' }).click();
  const canvas = page.locator('.plan-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  type P = { x: number; y: number; id: number };
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: P[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
  const undo = page.getByRole('button', { name: 'Undo' });
  const selected = page.locator('.inspector-title');

  // Pinch: the first finger lands and wobbles before the second arrives.
  await touch('touchStart', [{ x: cx, y: cy, id: 1 }]);
  await touch('touchMove', [{ x: cx + 4, y: cy + 3, id: 1 }]);
  await touch('touchStart', [{ x: cx + 4, y: cy + 3, id: 1 }, { x: cx + 40, y: cy, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: cx + 4 - i * 10, y: cy + 3, id: 1 }, { x: cx + 40 + i * 10, y: cy, id: 2 }]);
  await touch('touchEnd', [{ x: cx - 76, y: cy + 3, id: 1 }]);
  await touch('touchMove', [{ x: cx + 140, y: cy + 30, id: 2 }]);
  await touch('touchEnd', []);
  await expect(undo).toBeDisabled();
  await expect(selected).toHaveCount(0);

  // A one-finger swipe across the house pans instead of grabbing things.
  await touch('touchStart', [{ x: cx, y: cy, id: 3 }]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: cx + i * 15, y: cy + i * 10, id: 3 }]);
  await touch('touchEnd', []);
  await expect(undo).toBeDisabled();
  await expect(selected).toHaveCount(0);

  // A tap still selects.
  await touch('touchStart', [{ x: cx, y: cy, id: 4 }]);
  await touch('touchEnd', []);
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Edit' }).click();
  await expect(selected).toHaveCount(1);
  await expect(undo).toBeDisabled();
});
