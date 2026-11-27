import { expect, test } from '@playwright/test';
import { GALLERY } from '../dev/gallery';

// Fixed point in time: the day after the autumn DST switch in Europe/Berlin.
const NOW = '2026-10-26T13:37:00Z';
const OUT = 'screenshots';

const variants = [
  { theme: 'light', lang: 'en' },
  { theme: 'dark', lang: 'de' },
] as const;

for (const v of variants) {
  test.describe(`${v.theme}-${v.lang}`, () => {
    test('gallery overview', async ({ page }) => {
      await page.goto(`/dev/index.html?now=${NOW}&theme=${v.theme}&lang=${v.lang}&playground=0`);
      await waitForCards(page, GALLERY.length);
      await page.screenshot({ path: `${OUT}/${v.theme}-${v.lang}/00-overview.png`, fullPage: true });
    });

    for (const item of GALLERY) {
      test(item.id, async ({ page }) => {
        await page.goto(
          `/dev/index.html?now=${NOW}&theme=${v.theme}&lang=${v.lang}&playground=0&only=${item.id}`,
        );
        await waitForCards(page, 1);
        const card = page.locator('.item chrono-heatmap-card').first();
        await card.screenshot({ path: `${OUT}/${v.theme}-${v.lang}/${item.id}.png` });
      });
    }
  });
}

test('tooltip on hover', async ({ page }) => {
  await page.goto(`/dev/index.html?now=${NOW}&playground=0&only=day-hour-temperature`);
  await waitForCards(page, 1);
  const cell = page.locator('chrono-heatmap-card rect.cell:not(.empty):not(.future)').nth(30);
  await cell.hover();
  const tooltip = page.locator('chrono-heatmap-card .tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('°C');
  await page
    .locator('.item')
    .first()
    .screenshot({ path: `${OUT}/interaction/tooltip.png` });
});

test('click opens more-info', async ({ page }) => {
  await page.goto(`/dev/index.html?now=${NOW}&playground=0&only=day-hour-temperature`);
  await waitForCards(page, 1);
  await page.locator('chrono-heatmap-card rect.cell').nth(5).click();
  await expect(page.locator('#event-log')).toHaveText('hass-more-info → sensor.outdoor_temperature');
});

test('playground form edits the YAML and the card', async ({ page }) => {
  await page.goto(`/dev/index.html?now=${NOW}&only=day-hour-temperature`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitForCards(page, 2);
  const form = page.locator('#form');
  await form.locator('label:has(code:text-is("row_unit")) select').selectOption('week');
  await form.locator('label:has(code:text-is("legend_ticks")) select').selectOption('auto');
  await expect(page.locator('#yaml')).toHaveValue(/row_unit: week[\s\S]*legend_ticks: auto/);
  await waitForCards(page, 2);
  await expect(page.locator('#playground-card chrono-heatmap-card .legend-tick').first()).toBeAttached();

  // and back: YAML typed by hand shows up in the form
  await page.locator('#yaml').fill('type: custom:chrono-heatmap-card\nentity: sensor.office_co2\nrows: 3\n');
  await expect(form.locator('label:has(code:text-is("rows")) input')).toHaveValue('3');
  await expect(form.locator('label:has(code:text-is("row_unit")) select')).toHaveValue('');
  await page.locator('#playground').screenshot({ path: `${OUT}/interaction/playground.png` });
});

async function waitForCards(page: import('@playwright/test').Page, count: number): Promise<void> {
  // a card is done when it shows either the grid or a warning
  await expect
    .poll(
      async () =>
        page
          .locator('chrono-heatmap-card')
          .evaluateAll(
            (els) => els.filter((el) => el.shadowRoot?.querySelector('svg.grid, .warning')).length,
          ),
      { timeout: 30_000 },
    )
    .toBe(count);
  await page.evaluate(() => document.fonts.ready);
}
