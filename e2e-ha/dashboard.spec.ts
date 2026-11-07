import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

// written by e2e-ha/setup.ts
const session = JSON.parse(readFileSync('e2e-ha-run/session.json', 'utf8')) as {
  username: string;
  password: string;
  dashboard: string;
};
const OUT = 'e2e-ha-run/screenshots';
const TITLES = ['Temperature by hour', 'Energy per day', 'Front door open', 'Temperature by day'];

/** Fails the test on uncaught errors in the page that come from the card. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));
  return errors;
}
const cardErrors = (errors: string[]) => errors.filter((e) => /chrono/i.test(e));

function card(page: Page, title: string): Locator {
  return page
    .locator('chrono-heatmap-card')
    .filter({ has: page.locator('.header', { hasText: title }) })
    .first();
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto(session.dashboard);
  // a card is done when it shows either the grid or a warning
  await expect
    .poll(
      () =>
        page
          .locator('chrono-heatmap-card')
          .evaluateAll(
            (els) => els.filter((el) => el.shadowRoot?.querySelector('svg.grid, .warning')).length,
          ),
      { timeout: 60_000 },
    )
    .toBe(TITLES.length);
  await page.evaluate(() => document.fonts.ready);
}

test('logs in through the Home Assistant login page', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth\/authorize/);
  await page.getByRole('textbox', { name: 'Username' }).fill(session.username);
  await page.getByRole('textbox', { name: 'Password' }).fill(session.password);
  await page.getByRole('button', { name: /log in/i }).click();
  await expect(page).not.toHaveURL(/\/auth\//);
  await expect(page.getByText('Chrono E2E').first()).toBeVisible();
  await context.close();
});

test('all cards render a grid with data', async ({ page }) => {
  const errors = watchErrors(page);
  await openDashboard(page);
  for (const title of TITLES) {
    const c = card(page, title);
    await expect(c.locator('svg.grid'), title).toBeVisible();
    await expect(c.locator('.warning'), title).toHaveCount(0);
    await expect
      .poll(() => c.locator('rect.cell:not(.empty):not(.future)').count(), {
        message: `${title}: colored cells`,
      })
      .toBeGreaterThan(0);
  }
  // statistics-backed cards are well filled (14 days × 24 hours, 5 weeks × 7 days)
  expect(
    await card(page, 'Temperature by hour').locator('rect.cell:not(.empty):not(.future)').count(),
  ).toBeGreaterThanOrEqual(13 * 24 - 1); // 13 full days, one may be the 23-hour DST day
  expect(
    await card(page, 'Energy per day').locator('rect.cell:not(.empty):not(.future)').count(),
  ).toBeGreaterThan(4 * 7);
  await page.screenshot({ path: `${OUT}/dashboard-light.png`, fullPage: true });
  expect(cardErrors(errors)).toEqual([]);
});

test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });
  test('dashboard screenshot', async ({ page }) => {
    await openDashboard(page);
    await page.screenshot({ path: `${OUT}/dashboard-dark.png`, fullPage: true });
  });
});

test('hover shows a tooltip', async ({ page }) => {
  await openDashboard(page);
  const c = card(page, 'Temperature by hour');
  await c.locator('rect.cell:not(.empty):not(.future)').nth(30).hover();
  const tooltip = c.locator('.tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('°C');
  await c.screenshot({ path: `${OUT}/tooltip.png` });
});

test('clicking the header opens more-info', async ({ page }) => {
  await openDashboard(page);
  await card(page, 'Temperature by hour').locator('.header').click();
  // HA dialogs slot their content into the role=dialog element, so search from the dialog's host element
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('ha-more-info-dialog').getByText('Outdoor temperature').first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/more-info.png` });
});

test('card picker offers the card and its visual editor works', async ({ page }) => {
  const errors = watchErrors(page);
  // ?edit=1 opens the dashboard in edit mode; fall back to the toolbar button
  await page.goto(`${session.dashboard}?edit=1`);
  const addCard = page.getByRole('button', { name: 'Add card' });
  const editDashboard = page.getByRole('button', { name: 'Edit dashboard' });
  await expect(addCard.or(editDashboard).first()).toBeVisible();
  if (!(await addCard.isVisible())) await editDashboard.click();
  await addCard.click();

  await page.getByRole('tab', { name: 'By card' }).click();
  await page
    .getByPlaceholder(/search cards/i)
    .or(page.getByRole('textbox', { name: /search cards/i }))
    .first()
    .fill('Chrono Heatmap');
  const entry = page.getByText('Chrono Heatmap', { exact: true }).first();
  await expect(entry).toBeVisible();
  await page.screenshot({ path: `${OUT}/card-picker.png` });
  // each picker entry is covered by a transparent overlay that receives the click
  await entry.click({ force: true });

  // visual editor from getConfigForm(): our labels, a live preview, no error
  const editor = page.locator('hui-dialog-edit-card');
  await expect(editor.getByText('Number of rows').first()).toBeVisible();
  await expect(editor.getByText('Show legend').first()).toBeVisible();
  await expect(editor.locator('chrono-heatmap-card svg.grid').first()).toBeVisible();
  await expect(editor.locator('ha-alert[alert-type="error"]')).toHaveCount(0);
  await page.screenshot({ path: `${OUT}/card-editor.png` });
  expect(cardErrors(errors)).toEqual([]);
});

test('offers a reload when the dashboard resource was updated meanwhile', async ({ page }) => {
  const errors = watchErrors(page);
  await openDashboard(page);
  // the toast text (the second copy is the hidden screen-reader announcement)
  const toast = page.locator('span.message', { hasText: 'Chrono Heatmap Card was updated' });
  // unchanged resource: no toast
  await page.waitForTimeout(2_000);
  await expect(toast).toHaveCount(0);

  type Resource = { id: string; url: string; type: string };
  const callWS = <T>(msg: Record<string, unknown>) =>
    page.evaluate(
      (m) =>
        (
          document.querySelector('home-assistant') as unknown as {
            hass: { callWS: (x: unknown) => Promise<unknown> };
          }
        ).hass.callWS(m),
      msg,
    ) as Promise<T>;
  const resources = await callWS<Resource[]>({ type: 'lovelace/resources' });
  const ours = resources.find((r) => r.url.includes('chrono-heatmap-card.js'))!;
  expect(ours, 'dashboard resource of the card').toBeDefined();
  try {
    // what the Marketplace does on an update: same file, new cache-busting URL
    await callWS({
      type: 'lovelace/resources/update',
      resource_id: ours.id,
      url: `${ours.url.split('?')[0]}?v=e2e-next`,
      res_type: 'module',
    });
    // the app comes back to the foreground (checks are at least 10 s apart)
    await page.waitForTimeout(10_500);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(toast).toBeVisible();
    await page.screenshot({ path: `${OUT}/update-toast.png` });

    // the toast's button reloads the page, which then runs the new resource URL: no toast anymore
    await page.getByRole('button', { name: 'Reload' }).click();
    await page.waitForLoadState('load');
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .some((e) => e.name.includes('chrono-heatmap-card.js?v=e2e-next')),
        ),
      )
      .toBe(true);
    await page.waitForTimeout(2_000);
    await expect(toast).toHaveCount(0);
  } finally {
    await callWS({
      type: 'lovelace/resources/update',
      resource_id: ours.id,
      url: ours.url,
      res_type: 'module',
    });
  }
  expect(cardErrors(errors)).toEqual([]);
});
