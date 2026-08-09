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

test('exécute le vrai checkout sandbox et attend le callback Cloud', async ({ page }) => {
  test.skip(process.env.RUN_REAL_CLOUD_PAYMENT_E2E !== '1', 'opt-in Cloud provider test');
  test.setTimeout(150_000);
  const env = parseEnv(path.resolve(process.cwd(), '.env.local'));
  const cloudUrl = env.VITE_SUPABASE_URL_CLOUD || env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY_CLOUD || env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY_CLOUD;
  if (!cloudUrl || !anonKey || !serviceKey) throw new Error('Cloud payment configuration unavailable');

  const service = createClient(cloudUrl, serviceKey, { auth: { persistSession: false } });
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const email = `p266b-pay-${suffix}@example.invalid`;
  const password = `P2.6.6B-${crypto.randomBytes(18).toString('base64url')}!`;
  const eventName = `P2.6.6B CLOUD PAYMENT TEST ${suffix}`;
  let userId: string | null = null;
  let eventId = 0;

  try {
    const { data: createdUser, error: createUserError } = await service.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createUserError || !createdUser.user) throw createUserError ?? new Error('fixture user missing');
    userId = createdUser.user.id;

    const userClient = createClient(cloudUrl, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    const { data: created, error: eventError } = await userClient.rpc('create_event_secure', {
      p_name: eventName,
      p_organizer: 'P2.6.6B isolated payment smoke',
      p_start_date: '2026-08-09', p_end_date: '2026-08-09', p_price: 0,
      p_currency: 'XOF', p_categories: [], p_judges: [],
    });
    if (eventError || !created?.[0]) throw eventError ?? new Error('fixture event missing');
    eventId = Number(created[0].id);

    const { data: paymentData, error: paymentError } = await userClient.functions.invoke('payments', {
      body: {
        action: 'initiate', eventId, provider: 'stripe', amount: 50000, currency: 'xof',
        event_name: eventName, organizer: 'P2.6.6B isolated payment smoke',
        successUrl: `http://localhost/payment?eventId=${eventId}&status=success`,
        cancelUrl: `http://localhost/payment?eventId=${eventId}&status=failed`,
      },
    });
    if (paymentError) throw paymentError;
    const checkoutUrl = typeof paymentData?.checkoutUrl === 'string' ? paymentData.checkoutUrl : '';
    const checkout = checkoutUrl ? new URL(checkoutUrl) : null;
    const sandbox = Boolean(checkout && checkout.hostname === 'checkout.stripe.com' && checkout.pathname.includes('cs_test_'));
    console.info(JSON.stringify({ provider: checkout?.hostname ?? null, sandbox, checkoutUrlReturned: Boolean(checkoutUrl) }));
    expect(checkoutUrl).not.toBe('');
    expect(sandbox, 'Stripe checkout must be an official test-mode session before automation continues').toBe(true);

    await page.goto(checkoutUrl);
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.locator('input[name="cardNumber"]').fill('4242424242424242');
    await page.locator('input[name="cardExpiry"]').fill('1230');
    await page.locator('input[name="cardCvc"]').fill('123');
    const billingName = page.locator('input[name="billingName"]');
    if (await billingName.isVisible().catch(() => false)) await billingName.fill('P2.6.6B Test');
    const agentDisclosure = page.getByRole('checkbox', { name: /AI agent acting on behalf/i });
    if (await agentDisclosure.isVisible().catch(() => false)) {
      await agentDisclosure.check();
      await expect(agentDisclosure).toBeChecked();
    }
    await page.getByRole('button', { name: /^Pay/ }).click();
    await page.waitForURL((url) => url.href.includes('status=success'), { timeout: 60_000 });

    let paid = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { data: eventState, error: stateError } = await service
        .from('events').select('paid,status').eq('id', eventId).single();
      if (stateError) throw stateError;
      if (eventState.paid === true) { paid = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    expect(paid, 'Stripe callback must set events.paid=true through the real workflow').toBe(true);
  } finally {
    if (eventId > 0) {
      await service.from('payments').delete().eq('event_id', eventId);
      await service.from('events').delete().eq('id', eventId).eq('name', eventName);
    }
    if (userId) await service.auth.admin.deleteUser(userId);
  }
});
