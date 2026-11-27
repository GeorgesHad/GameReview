import { expect, test } from '@playwright/test';

test('loads the built shell and displays a healthy same-origin Worker', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Football Match Review' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API operational');
  await expect(page.getByText('local', { exact: true })).toBeVisible();

  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const image = await page.request.get(icon.src);
    expect(image.headers()['content-type']).toContain('image/png');
  }
});

test('keeps API errors as JSON on navigation and recovers from a failed health request', async ({ page }) => {
  const response = await page.goto('/api/v1/unknown');
  expect(response?.status()).toBe(404);
  expect(response?.headers()['content-type']).toContain('application/json');

  await page.route('**/api/v1/health', (route) => route.fulfill({ status: 503 }), { times: 1 });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('API unavailable');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('status')).toHaveText('API operational');
});
