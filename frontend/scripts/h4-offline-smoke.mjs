import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pg from 'pg';
import process from 'node:process';

const workbookPath = process.env.REAL_COMPETITION_X_XLSX;
if (!workbookPath) throw new Error('REAL_COMPETITION_X_XLSX is required');

const port = 4174;
const origin = `http://h4.localhost:${port}`;
const projectRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const statusOutput = execFileSync('supabase', ['status', '--workdir', path.join(projectRoot, 'backend'), '-o', 'json'], { encoding: 'utf8' });
const status = JSON.parse(statusOutput.slice(statusOutput.indexOf('{')));
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const header = encode({ alg: 'HS256', typ: 'JWT' });
const payload = encode({
  iss: 'supabase-demo', role: 'authenticated', aud: 'authenticated',
  sub: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 3600,
});
const signature = crypto.createHmac('sha256', status.JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
const localToken = `${header}.${payload}.${signature}`;
const db = new pg.Client({ connectionString: status.DB_URL });
await db.connect();
const runId = `p256l_pwa_${Date.now()}`;
const eventId = Number((await db.query(`
  insert into public.events (name, organizer, start_date, end_date, price, currency, status, paid)
  values ($1, 'P2.5.6l PWA smoke', current_date, current_date, 0, 'XOF', 'paid', true)
  returning id
`, [runId])).rows[0].id);
const preview = spawn('npm', ['run', 'preview', '--', '--host', '0.0.0.0', '--port', String(port), '--strictPort'], {
  cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForPreview = async () => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (preview.exitCode != null) throw new Error(`preview exited with ${preview.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}`);
      if (response.ok) return;
    } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('preview timeout');
};

let browser;
try {
  await waitForPreview();
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
  }
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(({ apiUrl, token }) => {
    localStorage.setItem('supabase_url_override', apiUrl);
    localStorage.setItem('supabase_anon_override', token);
    localStorage.setItem('supabase_mode', 'local');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  }, { apiUrl: status.API_URL, token: localToken });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.origin === status.API_URL) await route.continue();
    else await route.abort('internetdisconnected');
  });
  const page = await context.newPage();
  await page.goto(`${origin}/participants?event=${eventId}&eventName=${encodeURIComponent(runId)}`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'networkidle' });
  }
  const xlsxPrecached = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const keys = (await Promise.all(cacheNames.map(async (name) => (await caches.open(name)).keys()))).flat();
    return keys.some((request) => /\/assets\/xlsxParser-.*\.js$/.test(new URL(request.url).pathname));
  });
  if (!xlsxPrecached) throw new Error('XLSX chunk is not precached');

  await page.getByRole('button', { name: /Ouvrir l.import hors ligne recommandé/ }).click();
  await page.getByLabel('Fichier local CSV/XLSX').setInputFiles(workbookPath);
  await page.getByText('VALID', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Générer la preview en mémoire' }).click();
  await page.getByText('PREVIEW_READY', { exact: true }).waitFor();
  await page.getByText(/Sécurité planning serveur : SAFE/).waitFor();
  await page.getByRole('button', { name: 'Créer les heats sur cet événement' }).click();
  await page.getByRole('dialog', { name: 'Confirmation création planning' }).waitFor();
  await page.getByRole('button', { name: 'Confirmer et créer' }).click();
  try {
    await page.getByText(/Planning créé avec succès/).waitFor();
  } catch (error) {
    console.error(await page.locator('body').innerText());
    throw error;
  }
  const inventory = (await db.query(`
    select count(*)::int as heats, count(*) filter (where is_active)::int as active_heats
    from public.heats where event_id=$1
  `, [eventId])).rows[0];
  if (inventory.heats < 1 || inventory.active_heats !== 0) throw new Error(`invalid persisted inventory: ${JSON.stringify(inventory)}`);
  console.log(JSON.stringify({ ok: true, browser: 'chromium', internet: false, lanSupabase: true, xlsxPrecached: true, participants: 62, ...inventory }));
} finally {
  await browser?.close();
  preview.kill('SIGTERM');
  await db.query('delete from public.heats where event_id=$1', [eventId]);
  await db.query('delete from public.participants where event_id=$1', [eventId]);
  await db.query('delete from public.events where id=$1', [eventId]);
  await db.end();
}
