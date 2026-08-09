import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const parseEnv = (file: string) => Object.fromEntries(
  readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, '')];
    }),
);

test('Cloud exige une vraie auth puis crée par RPC avant paiement', async ({ page }) => {
  test.skip(process.env.RUN_REAL_CLOUD_EVENT_E2E !== '1', 'opt-in Cloud fixture test');
  test.setTimeout(60_000);

  const env = parseEnv(path.resolve(process.cwd(), '.env.local'));
  const cloudUrl = env.VITE_SUPABASE_URL_CLOUD || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY_CLOUD;
  if (!cloudUrl || !serviceKey) throw new Error('Cloud test configuration unavailable');

  const service = createClient(cloudUrl, serviceKey, { auth: { persistSession: false } });
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const email = `p266a-${suffix}@example.invalid`;
  const password = `P2.6.6A-${crypto.randomBytes(18).toString('base64url')}!`;
  const fixtureName = `P2.6.6A CLOUD ${suffix}`;
  let userId: string | null = null;
  let eventId = 0;

  try {
    const { data: createdUser, error: userError } = await service.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (userError || !createdUser.user) throw userError ?? new Error('Cloud fixture user missing');
    userId = createdUser.user.id;

    await page.goto('/my-events');
    await expect(page.getByRole('heading', { name: 'Connexion requise' })).toBeVisible();
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole('button', { name: 'Se connecter avec mot de passe' }).click();
    await expect(page.getByRole('heading', { name: 'Mes événements' })).toBeVisible();

    await page.getByRole('button', { name: /Créer un nouvel événement/ }).click();
    const inputs = page.locator('form input');
    await inputs.nth(0).fill(fixtureName);
    await inputs.nth(1).fill('P2.6.6A Cloud isolated smoke');
    await inputs.nth(3).fill('2026-08-09');
    await inputs.nth(4).fill('2026-08-09');
    await page.getByRole('button', { name: /Créer l'événement/ }).click();
    await expect(page).toHaveURL(/\/payment/);

    const { data: events, error: eventError } = await service
      .from('events')
      .select('id,user_id,owner_id,paid,status,method')
      .eq('name', fixtureName)
      .eq('user_id', userId)
      .limit(1);
    if (eventError) throw eventError;
    expect(events).toHaveLength(1);
    eventId = Number(events![0].id);
    expect(Number.isSafeInteger(eventId) && eventId > 0).toBe(true);
    expect(events![0]).toMatchObject({ user_id: userId, owner_id: userId, paid: false, status: 'pending', method: null });
  } finally {
    if (eventId > 0) await service.from('events').delete().eq('id', eventId).eq('name', fixtureName);
    if (userId) await service.auth.admin.deleteUser(userId);
  }
});
