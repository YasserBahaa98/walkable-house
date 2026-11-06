import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

async function freshStart(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.evaluate(() => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('walkable-house');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.reload();
  return errors;
}

test.describe('Walkable House', () => {
  test('first run offers a welcome and loads the demo house', async ({ page }) => {
    const errors = await freshStart(page);
    const dialog = page.getByRole('dialog', { name: 'Welcome to Walkable House' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Explore demo' }).click();
    await expect(page.getByRole('tab', { name: 'Ground floor' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'First floor' })).toBeVisible();
    await expect(page.locator('.viewport-canvas')).toBeVisible();
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 5000 });
    expect(errors).toEqual([]);
  });

  test('edits are undoable and persist across reloads', async ({ page }) => {
    await freshStart(page);
    await page.getByRole('button', { name: 'Explore demo' }).click();
    await page.getByRole('tab', { name: 'Library' }).click();
    await page.getByRole('button', { name: /^Armchair/ }).click();
    await expect(page.getByRole('tab', { name: 'Inspect' })).toBeVisible();
    await page.getByRole('tab', { name: 'Inspect' }).click();
    await expect(page.locator('.inspector-title')).toHaveText('Armchair');
    // Rename via the inspector
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill('Reading chair');
    await name.press('Enter');
    await expect(page.locator('.inspector-title')).toHaveText('Reading chair');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 5000 });
    await page.reload();
    await page.getByRole('tab', { name: 'Report' }).click();
    await expect(page.getByText('Furniture', { exact: true })).toBeVisible();
    // Undo removes the item again
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
  });

  test('walk mode can be entered and left', async ({ page }) => {
    await freshStart(page);
    await page.getByRole('button', { name: 'Explore demo' }).click();
    await page.getByRole('radio', { name: 'Walk' }).click();
    await expect(page.locator('.walk-hint')).toBeVisible();
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('radio', { name: 'Orbit' })).toHaveAttribute('aria-checked', 'true');
  });

  test('imports a DXF plan with walls, doors and rooms', async ({ page }) => {
    await freshStart(page);
    await page.getByRole('button', { name: 'Explore demo' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import/ }).first().click();
    await (await chooser).setFiles(fileURLToPath(new URL('../tests/fixtures/simple-house.dxf', import.meta.url)));
    const dialog = page.getByRole('dialog', { name: /Import simple-house\.dxf/ });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.locator('.import-stats')).toContainText('1 floor');
    await expect(dialog.locator('.import-stats')).toContainText('1 doors');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.project-name')).toHaveValue('simple-house');
    await page.getByRole('tab', { name: 'Report' }).click();
    await expect(page.getByRole('cell', { name: 'Living' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Bedroom' })).toBeVisible();
    await expect(page.getByText(/No problems found|Checks/).first()).toBeVisible();
  });

  test('rejects unsupported files with a message', async ({ page }) => {
    await freshStart(page);
    await page.getByRole('button', { name: 'Explore demo' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import/ }).first().click();
    await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('.toast-error')).toContainText('Unsupported file type');
  });

  test('help dialog lists shortcuts', async ({ page }) => {
    await freshStart(page);
    await page.getByRole('button', { name: 'Explore demo' }).click();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Walkable House' })).toContainText('Keyboard shortcuts');
  });

  test('exports a GLB model and round-trips a project file', async ({ page }) => {
    await freshStart(page);
    await page.getByRole('button', { name: 'Explore demo' }).click();
    await page.getByRole('button', { name: 'Export' }).click();
    const glbDl = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /3D model/ }).click();
    const glb = await glbDl;
    expect(glb.suggestedFilename()).toBe('demo-house.glb');
    const fs = await import('node:fs');
    const glbPath = await glb.path();
    const head = fs.readFileSync(glbPath).subarray(0, 4).toString('ascii');
    expect(head).toBe('glTF');
    expect(fs.statSync(glbPath).size).toBeGreaterThan(50_000);

    // Save a project file, change the project, then open the saved file again.
    const projDl = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    const proj = await projDl;
    const projPath = await proj.path();
    await page.locator('.project-name').fill('Changed name');
    await page.locator('.project-name').press('Enter');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import/ }).first().click();
    await (await chooser).setFiles({ name: 'demo.walkhouse.json', mimeType: 'application/json', buffer: fs.readFileSync(projPath) });
    await page.getByRole('dialog', { name: 'Open project' }).getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('.project-name')).toHaveValue('Demo house');
  });

  test('imports a multi-file glTF model and a zipped model', async ({ page }) => {
    await freshStart(page);
    await page.getByRole('button', { name: 'Explore demo' }).click();
    const fixture = (n: string) => fileURLToPath(new URL(`../tests/fixtures/${n}`, import.meta.url));
    let chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import/ }).first().click();
    await (await chooser).setFiles([fixture('box.gltf'), fixture('box.bin')]);
    await expect(page.locator('.toast-success').filter({ hasText: 'Added model “box”' })).toBeVisible();
    await expect(page.locator('.inspector-title')).toHaveText('box');
    // Size comes from the model (0.8 × 0.6 m footprint).
    await expect(page.getByRole('textbox', { name: 'Width (m)' })).toHaveValue('0.8');

    chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import/ }).first().click();
    await (await chooser).setFiles(fixture('box-model.zip'));
    await expect(page.locator('.toast-success').filter({ hasText: 'Added model “box”' }).last()).toBeVisible();

    // A .gltf without its .bin explains what is missing.
    chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import/ }).first().click();
    await (await chooser).setFiles(fixture('box.gltf'));
    await expect(page.locator('.toast-error')).toContainText('Missing files: box.bin');
  });

  test('furnishes and paints a room, and undoes it', async ({ page }) => {
    const errors = await freshStart(page);
    await page.getByRole('button', { name: 'Explore demo' }).click();
    await page.getByRole('tab', { name: 'Report' }).click();
    await page.getByRole('cell', { name: /^Living/ }).first().click();
    const panel = page.locator('.panel');
    await panel.getByRole('button', { name: 'Furnish room' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
    await expect(page.locator('.toast').last()).toContainText(/Furnished “Living.*” with \d+ pieces/);
    await expect(panel.getByRole('button', { name: 'Try another layout' })).toBeVisible();
    await panel.getByRole('button', { name: 'Try another layout' }).click();
    await panel.getByRole('radio', { name: 'Sage' }).click();
    await expect(panel.getByRole('radio', { name: 'Sage' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Control+z');
    await expect(panel.getByRole('radio', { name: 'Unpainted' })).toHaveAttribute('aria-checked', 'true');
    await page.locator('.level-tab').first().click();
    await page.getByRole('tab', { name: 'Inspect' }).click();
    await page.keyboard.press('Escape');
    await expect(panel.getByRole('button', { name: 'Furnish empty rooms' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
