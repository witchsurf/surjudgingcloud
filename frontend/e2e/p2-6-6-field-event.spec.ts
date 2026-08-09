import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

const workdir = process.env.SUPABASE_TEST_WORKDIR ?? '../backend';

const localStatus = () => {
  const output = execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'json'], { encoding: 'utf8' });
  return JSON.parse(output.slice(output.indexOf('{'))) as {
    API_URL: string;
    ANON_KEY: string;
    DB_URL: string;
  };
};

test('Field crée un événement DB canonique sans WAN ni paiement et le retrouve après reload', async ({ page }) => {
  const status = localStatus();
  const db = new Client({ connectionString: status.DB_URL });
  const fixtureName = 'P2.6.6 FIELD TEST';
  const publicRequests: string[] = [];
  let eventId = 0;

  await page.addInitScript(({ apiUrl, anonKey }) => {
    localStorage.setItem('supabase_url_override', apiUrl);
    localStorage.setItem('supabase_anon_override', anonKey);
    localStorage.setItem('supabase_cloud_lock', 'true');
  }, { apiUrl: status.API_URL, anonKey: status.ANON_KEY });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const lan = url.hostname === 'priority.local'
      || /^10\./.test(url.hostname)
      || /^192\.168\./.test(url.hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
    if (!loopback) {
      if (lan) {
        await route.abort('blockedbyclient');
        return;
      }
      publicRequests.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  try {
    await db.connect();
    await page.goto('/my-events');
    await expect(page.getByRole('heading', { name: 'Mes événements' })).toBeVisible();
    await page.getByRole('button', { name: /Créer un nouvel événement/ }).click();
    await expect(page).toHaveURL(/\/create-event/);

    const inputs = page.locator('form input');
    await inputs.nth(0).fill(fixtureName);
    await inputs.nth(1).fill('P2.6.6 isolated smoke');
    await inputs.nth(3).fill('2026-08-09');
    await inputs.nth(4).fill('2026-08-09');
    await page.getByRole('button', { name: /Créer l'événement/ }).click();

    await expect(page).toHaveURL(/\/participants\?eventId=\d+/);
    expect(page.url()).not.toContain('/payment');
    const eventIdParam = new URL(page.url()).searchParams.get('eventId');
    eventId = Number(eventIdParam);
    expect(Number.isSafeInteger(eventId) && eventId > 0).toBe(true);

    const inserted = await db.query(
      'select id, name, paid from public.events where id=$1 and name=$2',
      [eventId, fixtureName],
    );
    expect(inserted.rowCount).toBe(1);
    expect(inserted.rows[0]).toMatchObject({ name: fixtureName, paid: false });

    await expect(page.getByText(new RegExp(`base locale.*ID ${eventId}`, 'i'))).toBeVisible();
    await page.reload();
    await expect(page.getByText(new RegExp(`base locale.*ID ${eventId}`, 'i'))).toBeVisible();

    await page.goto('/my-events');
    await expect(page.getByText(fixtureName)).toBeVisible();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin/);

    await page.goto(`/payment?eventId=${eventId}`);
    await expect(page).toHaveURL(new RegExp(`/participants\\?eventId=${eventId}`));
    await expect(page.getByText(/Stripe/i)).toHaveCount(0);

    expect(publicRequests).toEqual([]);
  } finally {
    if (eventId > 0) {
      await db.query('delete from public.events where id=$1 and name=$2', [eventId, fixtureName]);
    }
    await db.end().catch(() => undefined);
  }
});
