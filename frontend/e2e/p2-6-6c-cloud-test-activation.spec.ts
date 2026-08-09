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

test('Cloud test activation is audited while an ordinary unpaid event remains blocked', async ({ page }) => {
  test.skip(process.env.RUN_REAL_CLOUD_TEST_ACTIVATION_E2E !== '1', 'opt-in Cloud test activation');
  test.setTimeout(240_000);

  const env = parseEnv(path.resolve(process.cwd(), '.env.local'));
  const cloudUrl = env.VITE_SUPABASE_URL_CLOUD || env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY_CLOUD || env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY_CLOUD;
  const workbookPath = process.env.REAL_COMPETITION_X_XLSX;
  if (!cloudUrl || !anonKey || !serviceKey) throw new Error('Cloud test configuration unavailable');
  if (!workbookPath) throw new Error('REAL_COMPETITION_X_XLSX is required');

  const service = createClient(cloudUrl, serviceKey, { auth: { persistSession: false } });
  const suffix = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const email = `p266c-${suffix}@example.invalid`;
  const password = `P2.6.6C-${crypto.randomBytes(18).toString('base64url')}!`;
  const activatedName = `P2.6.6C CLOUD TEST ${suffix}`;
  const unpaidName = `P2.6.6C UNPAID ${suffix}`;
  let userId: string | null = null;
  const eventIds: number[] = [];

  try {
    const { data: createdUser, error: userError } = await service.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (userError || !createdUser.user) throw userError ?? new Error('fixture user missing');
    userId = createdUser.user.id;

    const { error: configureError } = await service.rpc('configure_cloud_test_activation', {
      p_enabled: true,
      p_user_id: userId,
      p_authorized: true,
      p_authorized_by: 'P2.6.6C E2E',
    });
    if (configureError) throw configureError;

    await page.goto('/my-events');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole('button', { name: 'Se connecter avec mot de passe' }).click();
    await expect(page.getByRole('heading', { name: 'Mes événements' })).toBeVisible();

    await page.getByRole('button', { name: /Créer un nouvel événement/ }).click();
    let inputs = page.locator('form input');
    await inputs.nth(0).fill(activatedName);
    await inputs.nth(1).fill('P2.6.6C authorized test activation');
    await inputs.nth(3).fill('2026-08-09');
    await inputs.nth(4).fill('2026-08-09');
    await page.getByRole('button', { name: /Créer l'événement/ }).click();
    await expect(page).toHaveURL(/\/payment/);
    await expect(page.getByRole('button', { name: 'Activer pour test — aucun paiement réel' })).toBeVisible();

    const { data: activatedRows, error: activatedLookupError } = await service
      .from('events').select('id').eq('name', activatedName).eq('user_id', userId).limit(1);
    if (activatedLookupError || !activatedRows?.[0]) throw activatedLookupError ?? new Error('event missing');
    eventIds.push(Number(activatedRows[0].id));

    await page.getByRole('button', { name: 'Activer pour test — aucun paiement réel' }).click();
    await expect(page).toHaveURL(new RegExp(`/participants\\?eventId=${eventIds[0]}`));
    await expect(page.getByText(/activation test/i)).toBeVisible();

    const { data: activatedState, error: activatedStateError } = await service
      .from('events')
      .select('paid,status,method,test_activated_at,test_activated_by')
      .eq('id', eventIds[0]).single();
    if (activatedStateError) throw activatedStateError;
    expect(activatedState).toMatchObject({
      paid: false,
      status: 'pending',
      method: null,
      test_activated_by: userId,
    });
    expect(activatedState.test_activated_at).not.toBeNull();

    await page.getByRole('button', { name: 'Ouvrir l’import hors ligne recommandé' }).click();
    const panel = page.getByTestId('planning-import-panel');
    await panel.getByLabel('Fichier local CSV/XLSX').setInputFiles(workbookPath);
    await expect(panel.getByText('Lignes valides').locator('..')).toContainText('62', { timeout: 20_000 });
    await expect(panel.getByText('Catégories').locator('..')).toContainText('7');

    const categorySelect = panel.getByLabel('Catégorie preview');
    const categories = await categorySelect.locator('option').allTextContents();
    expect(categories).toHaveLength(7);
    for (const category of categories) {
      await categorySelect.selectOption({ label: category });
      await panel.getByRole('button', { name: 'Générer la preview en mémoire' }).click();
      await expect(panel.getByTestId('planning-safety-preflight')).toContainText('SAFE', { timeout: 15_000 });
      await panel.getByTestId('persist-planning-button').click();
      await expect(panel.getByRole('dialog', { name: 'Confirmation création planning' })).toContainText('PreflightSAFE');
      await panel.getByRole('button', { name: 'Confirmer et créer' }).click();
      await expect(panel.getByRole('status')).toContainText('Planning créé avec succès', { timeout: 20_000 });
    }

    const { count: participantCount, error: participantCountError } = await service
      .from('participants').select('id', { count: 'exact', head: true }).eq('event_id', eventIds[0]);
    if (participantCountError) throw participantCountError;
    expect(participantCount).toBe(62);
    const { data: heats, error: heatsError } = await service
      .from('heats').select('id').eq('event_id', eventIds[0]);
    if (heatsError) throw heatsError;
    expect(heats.length).toBeGreaterThan(0);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin/);
    await page.reload();
    await expect(page).toHaveURL(/\/admin/);

    const user = createClient(cloudUrl, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await user.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    const { data: unpaidCreated, error: unpaidError } = await user.rpc('create_event_secure', {
      p_name: unpaidName,
      p_organizer: 'P2.6.6C unpaid control',
      p_start_date: '2026-08-09', p_end_date: '2026-08-09', p_price: 50000,
      p_currency: 'XOF', p_categories: [], p_judges: [],
    });
    if (unpaidError || !unpaidCreated?.[0]) throw unpaidError ?? new Error('unpaid event missing');
    eventIds.push(Number(unpaidCreated[0].id));

    await page.goto(`/participants?eventId=${eventIds[1]}`);
    await expect(page.getByText(/paiement ou activation test autorisée requis/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Générer les séries →' })).toBeDisabled();
  } finally {
    for (const eventId of eventIds) {
      const cleanupResults = await Promise.all([
        service.from('payments').delete().eq('event_id', eventId),
        service.from('heats').delete().eq('event_id', eventId),
        service.from('participants').delete().eq('event_id', eventId),
      ]);
      const cleanupError = cleanupResults.find((result) => result.error)?.error;
      if (cleanupError) throw cleanupError;
      const { error: eventCleanupError } = await service.from('events').delete().eq('id', eventId);
      if (eventCleanupError) throw eventCleanupError;
    }
    if (userId) {
      const { error: disableError } = await service.rpc('configure_cloud_test_activation', {
        p_enabled: false,
        p_user_id: userId,
        p_authorized: false,
        p_authorized_by: 'P2.6.6C cleanup',
      });
      if (disableError) throw disableError;
      const { error: deleteUserError } = await service.auth.admin.deleteUser(userId);
      if (deleteUserError) throw deleteUserError;
    }
  }
});
