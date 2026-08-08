import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workbookPath = process.env.REAL_COMPETITION_X_XLSX;
const enabled = process.env.RUN_REAL_HEAT_PLANNING_INTEGRATION === '1' && Boolean(workbookPath);
const projectRoot = path.resolve(__dirname, '../../../..');

const localStatus = () => {
  const output = execFileSync('supabase', ['status', '--workdir', path.join(projectRoot, 'backend'), '-o', 'json'], { encoding: 'utf8' });
  return JSON.parse(output.slice(output.indexOf('{'))) as { DB_URL: string; API_URL: string; JWT_SECRET: string };
};

const authenticatedLocalToken = (secret: string) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'supabase-demo', role: 'authenticated', aud: 'authenticated',
    sub: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};

const waitFor = async (predicate: () => boolean, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('UI condition timeout');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  }
};

describe.runIf(enabled)('P2.5.6l Competition X atomic planning UI', () => {
  it('persists offline over LAN then displays a concurrent blocker without data loss', async () => {
    const status = localStatus();
    localStorage.setItem('supabase_url_override', status.API_URL);
    localStorage.setItem('supabase_anon_override', authenticatedLocalToken(status.JWT_SECRET));
    localStorage.setItem('supabase_mode', 'local');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    const { default: PlanningImportPanel } = await import('../PlanningImportPanel');
    const db = new Client({ connectionString: status.DB_URL });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const runId = `p256l_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    let eventId = 0;

    const click = async (label: string) => {
      const button = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(label));
      if (!button) throw new Error(`Button not found: ${label}`);
      await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    };

    try {
      await db.connect();
      eventId = Number((await db.query(`
        insert into public.events (name, organizer, start_date, end_date, price, currency, status, paid)
        values ($1, 'P2.5.6l Competition X UI test', current_date, current_date, 0, 'XOF', 'paid', true)
        returning id
      `, [runId])).rows[0].id);

      await act(async () => root.render(<PlanningImportPanel eventId={eventId} eventName={runId} />));
      const bytes = readFileSync(workbookPath!);
      const file = new File([new Uint8Array(bytes)], 'Competition X.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      await act(async () => {
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await waitFor(() => container.textContent?.includes('62') === true);
      expect(container.textContent).toContain('7');

      await click('Générer la preview en mémoire');
      await waitFor(() => container.querySelector('[data-testid="planning-safety-preflight"]')?.textContent?.includes('SAFE') === true);
      await click('Créer les heats sur cet événement');
      expect(container.querySelector('[role="dialog"]')?.textContent).toContain('PreflightSAFE');
      await click('Confirmer et créer');
      await waitFor(() => container.textContent?.includes('Planning créé avec succès') === true);

      const inventory = (await db.query(`
        select
          count(distinct h.id)::int as heats,
          count(distinct he.id)::int as entries,
          count(distinct hm.id)::int as mappings,
          count(distinct hc.heat_id)::int as configs,
          count(distinct h.id) filter (where h.is_active)::int as active_heats
        from public.heats h
        left join public.heat_entries he on he.heat_id = h.id
        left join public.heat_slot_mappings hm on hm.heat_id = h.id
        left join public.heat_configs hc on hc.heat_id = h.id
        where h.event_id = $1
      `, [eventId])).rows[0];
      expect(inventory.heats).toBeGreaterThan(0);
      expect(inventory.entries).toBeGreaterThan(0);
      expect(inventory.mappings).toBeGreaterThan(0);
      expect(inventory.configs).toBe(inventory.heats);
      expect(inventory.active_heats).toBe(0);

      // Rebuild the unchanged preview and obtain SAFE for the clean collision.
      await click('Générer la preview en mémoire');
      await waitFor(() => container.querySelector('[data-testid="planning-safety-preflight"]')?.textContent?.includes('SAFE') === true);
      const heatId = String((await db.query('select id from public.heats where event_id=$1 order by round, heat_number limit 1', [eventId])).rows[0].id);
      await db.query("update public.heat_realtime_config set status='open' where heat_id=$1", [heatId]);
      await db.query(`
        insert into public.scores (
          id, heat_id, competition, division, round, judge_id, judge_name,
          surfer, wave_number, score, timestamp, event_id, judge_station
        ) select $1, h.id, h.competition, h.division, h.round, 'J1', 'Judge',
                 'ROUGE', 1, 8, now(), h.event_id, 'J1'
          from public.heats h where h.id=$2
      `, [`${runId}_score`, heatId]);

      await click('Créer les heats sur cet événement');
      await click('Confirmer et créer');
      await waitFor(() => container.textContent?.includes('Création bloquée par le serveur') === true);
      expect(container.textContent).toContain('Prévisualisation des heats');
      expect(container.querySelector('[data-testid="planning-safety-preflight"]')?.textContent).toContain('BLOCKED');
      expect((await db.query('select count(*)::int as count from public.scores where id=$1', [`${runId}_score`])).rows[0].count).toBe(1);
      expect((await db.query('select count(*)::int as count from public.heats where event_id=$1', [eventId])).rows[0].count).toBe(inventory.heats);
    } finally {
      act(() => root.unmount());
      container.remove();
      if (eventId > 0) {
        await db.query('delete from public.heats where event_id=$1', [eventId]);
        await db.query('delete from public.participants where event_id=$1', [eventId]);
        await db.query('delete from public.events where id=$1', [eventId]);
      }
      await db.end().catch(() => undefined);
      localStorage.removeItem('supabase_url_override');
      localStorage.removeItem('supabase_anon_override');
      localStorage.removeItem('supabase_mode');
    }
  }, 40_000);
});
