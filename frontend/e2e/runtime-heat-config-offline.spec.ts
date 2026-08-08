import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';

const isolatedWorkdir = process.env.P263G_SUPABASE_WORKDIR;
const enabled = process.env.RUN_P263G_RUNTIME_HEAT_CONFIG === '1' && Boolean(isolatedWorkdir);

const localStatus = () => {
  const output = execFileSync('supabase', ['status', '--workdir', isolatedWorkdir!, '-o', 'json'], { encoding: 'utf8' });
  return JSON.parse(output.slice(output.indexOf('{'))) as {
    DB_URL: string; API_URL: string; JWT_SECRET: string; SERVICE_ROLE_KEY: string;
  };
};

const authenticatedToken = (secret: string, subject: string) => {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    iss: 'supabase-demo', role: 'authenticated', aud: 'authenticated', sub: subject,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};

const installRuntime = async (page: Page, apiUrl: string, token: string) => {
  await page.addInitScript(({ url, authToken }) => {
    localStorage.setItem('supabase_url_override', url);
    localStorage.setItem('supabase_anon_override', authToken);
    localStorage.setItem('supabase_mode', 'local');
  }, { url: apiUrl, authToken: token });
};

const saveConfiguration = async (page: Page, heatId: string, eventId: number, waves: number) => {
  await page.evaluate(async ({ targetHeat, targetEvent, targetWaves }) => {
    const { heatRepository } = await import('/src/repositories/HeatRepository.ts');
    await heatRepository.saveConfiguration(targetHeat, {
      eventId: targetEvent,
      judges: [],
      surfers: ['ROUGE', 'BLANC'],
      judgeNames: {},
      judgeIdentities: {},
      surferNames: { ROUGE: 'Surfeur Rouge', BLANC: 'Surfeur Blanc' },
      surferCountries: { ROUGE: 'SN', BLANC: 'SN' },
      waves: targetWaves,
      tournamentType: 'elimination',
      podiumId: 'B',
    });
  }, { targetHeat: heatId, targetEvent: eventId, targetWaves: waves });
};

const legacyQueue = async (page: Page) => page.evaluate(async () => {
  const { legacyGetAll } = await import('/src/lib/idbOfflineStore.ts');
  return legacyGetAll();
});

const replayQueue = async (page: Page) => page.evaluate(async () => {
  const { syncOffline } = await import('/src/lib/supabase.ts');
  await syncOffline();
});

test.describe('P2.6.3G real runtime heat config offline validation', () => {
  test.skip(!enabled, 'Requires an explicitly isolated Supabase workdir');

  test('uses HTTP RPC, real IndexedDB queue, refresh, retry and revoke-safe reads', async ({ browser }) => {
    test.setTimeout(180_000);
    const status = localStatus();
    const db = new Client({ connectionString: status.DB_URL });
    const runId = `p263g_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const heatId = `${runId}_open_r1_h1`;
    const userId = crypto.randomUUID();
    const token = authenticatedToken(status.JWT_SECRET, userId);
    let eventId = 0;
    const context = await browser.newContext();
    const admin = await context.newPage();
    await installRuntime(admin, status.API_URL, token);

    const apiHeaders = { apikey: token, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const serviceHeaders = {
      apikey: status.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };

    try {
      await db.connect();
      await db.query(
        `insert into auth.users (id, aud, role, email, encrypted_password)
         values ($1, 'authenticated', 'authenticated', $2, '')`,
        [userId, `${runId}@example.invalid`],
      );
      eventId = Number((await db.query(
        `insert into public.events (name, organizer, start_date, end_date, price, currency, status, paid, user_id)
         values ($1, 'P2.6.3G', current_date, current_date, 0, 'XOF', 'paid', false, $2)
         returning id`,
        [runId, userId],
      )).rows[0].id);
      await db.query(
        `insert into public.heats
          (id, event_id, competition, division, round, heat_number, heat_size, status, color_order)
         values ($1, $2, $3, 'OPEN', 1, 1, 2, 'waiting', array['ROUGE','BLANC'])`,
        [heatId, eventId, runId],
      );

      await admin.goto('/admin');

      // B. Real browser -> repository -> PostgREST RPC: insert, update and refresh.
      await saveConfiguration(admin, heatId, eventId, 12);
      await saveConfiguration(admin, heatId, eventId, 13);
      await admin.reload();
      const initialRead = await admin.evaluate(async ({ apiUrl, headers, targetHeat }) => {
        const response = await fetch(`${apiUrl}/rest/v1/heat_configs?heat_id=eq.${encodeURIComponent(targetHeat)}&select=heat_id,waves`, { headers });
        return { status: response.status, rows: await response.json() };
      }, { apiUrl: status.API_URL, headers: apiHeaders, targetHeat: heatId });
      expect(initialRead).toEqual({ status: 200, rows: [{ heat_id: heatId, waves: 13 }] });

      // C/E. Server commits, every ACK is lost, entry remains in real IndexedDB.
      await admin.route(`${status.API_URL}/rest/v1/rpc/upsert_heat_config_runtime`, async (route) => {
        await route.fetch();
        await route.abort('connectionfailed');
      });
      await saveConfiguration(admin, heatId, eventId, 14);
      const queuedAfterLostAck = await legacyQueue(admin);
      const heatConfigEntries = queuedAfterLostAck.filter((entry) => entry.table === 'heat_configs');
      expect(heatConfigEntries).toHaveLength(1);
      expect(heatConfigEntries[0]).toMatchObject({
        table: 'heat_configs', action: 'upsert',
        payload: { rows: { heat_id: heatId, waves: 14, tournament_type: 'elimination' }, options: { onConflict: 'heat_id' } },
      });

      // Refresh while the legacy queue is still persisted, restore HTTP, replay normally twice.
      await admin.reload();
      expect((await legacyQueue(admin)).filter((entry) => entry.table === 'heat_configs')).toHaveLength(1);
      await admin.unroute(`${status.API_URL}/rest/v1/rpc/upsert_heat_config_runtime`);
      await replayQueue(admin);
      await replayQueue(admin);
      expect(await legacyQueue(admin)).toHaveLength(0);

      // D. Inject the old snake_case shape without changing IndexedDB schema.
      await admin.evaluate(async ({ targetHeat }) => {
        const { legacyAdd } = await import('/src/lib/idbOfflineStore.ts');
        await legacyAdd({
          table: 'heat_configs', action: 'upsert', timestamp: Date.now(),
          payload: {
            rows: { heat_id: targetHeat, judges: [], surfers: ['ROUGE', 'BLANC'], judge_names: {}, waves: 15, tournament_type: 'elimination' },
            options: { onConflict: 'heat_id' },
          },
        });
      }, { targetHeat: heatId });
      await replayQueue(admin);
      expect(await legacyQueue(admin)).toHaveLength(0);

      let rows = (await db.query('select heat_id, waves from public.heat_configs where heat_id = $1', [heatId])).rows;
      expect(rows).toEqual([{ heat_id: heatId, waves: 15 }]);

      // G. A second browser subscribes before the admin RPC update.
      const observer = await context.newPage();
      await installRuntime(observer, status.API_URL, token);
      await observer.goto('/display');
      await observer.evaluate(async ({ targetHeat }) => {
        const { supabase } = await import('/src/lib/supabase.ts');
        (window as typeof window & { p263gRealtime: number }).p263gRealtime = 0;
        const channel = supabase!.channel(`p263g-${targetHeat}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'heat_realtime_config', filter: `heat_id=eq.${targetHeat}` }, () => {
            (window as typeof window & { p263gRealtime: number }).p263gRealtime += 1;
          });
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Realtime subscription timeout')), 10_000);
          channel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              clearTimeout(timeout);
              resolve();
            }
          });
        });
      }, { targetHeat: heatId });
      const realtimeStarted = Date.now();
      await saveConfiguration(admin, heatId, eventId, 16);
      await admin.evaluate(async ({ targetHeat }) => {
        const { upsertHeatRealtimeConfig } = await import('/src/api/modules/heats.api.ts');
        await upsertHeatRealtimeConfig(targetHeat, {
          setConfigData: true,
          configData: { waves: 16, surfers: ['ROUGE', 'BLANC'] },
          updatedBy: 'p263g-admin',
        });
      }, { targetHeat: heatId });
      await expect.poll(() => observer.evaluate(() => (window as typeof window & { p263gRealtime: number }).p263gRealtime), { timeout: 10_000 }).toBeGreaterThan(0);
      const realtimeMs = Date.now() - realtimeStarted;

      // H. Revoke only on the isolated stack and repeat runtime/offline paths.
      await db.query('revoke insert, update on public.heat_configs from authenticated');
      await saveConfiguration(admin, heatId, eventId, 17);

      await admin.route(`${status.API_URL}/**`, (route) => route.abort('internetdisconnected'));
      await saveConfiguration(admin, heatId, eventId, 18);
      expect((await legacyQueue(admin)).some((entry) => entry.table === 'heat_configs')).toBe(true);
      await admin.unroute(`${status.API_URL}/**`);
      await replayQueue(admin);
      expect(await legacyQueue(admin)).toHaveLength(0);

      // FixScores now uses this same RPC boundary; exercise the adapter with the full row.
      await admin.goto('/fix');
      await admin.evaluate(async ({ targetHeat }) => {
        const { supabase } = await import('/src/lib/supabase.ts');
        const { upsertRuntimeHeatConfig } = await import('/src/api/modules/runtimeHeatConfig.api.ts');
        await upsertRuntimeHeatConfig(supabase!, {
          heat_id: targetHeat, judges: [], surfers: ['ROUGE', 'BLANC'], judge_names: {}, waves: 19,
          tournament_type: 'elimination',
        });
      }, { targetHeat: heatId });

      const directInsert = await admin.evaluate(async ({ apiUrl, headers, targetHeat }) => {
        const response = await fetch(`${apiUrl}/rest/v1/heat_configs`, {
          method: 'POST', headers, body: JSON.stringify({ heat_id: `${targetHeat}_direct`, judges: [], surfers: [] }),
        });
        return response.status;
      }, { apiUrl: status.API_URL, headers: apiHeaders, targetHeat: heatId });
      expect([401, 403]).toContain(directInsert);
      const directUpdate = await admin.evaluate(async ({ apiUrl, headers, targetHeat }) => {
        const response = await fetch(`${apiUrl}/rest/v1/heat_configs?heat_id=eq.${encodeURIComponent(targetHeat)}`, {
          method: 'PATCH', headers, body: JSON.stringify({ waves: 99 }),
        });
        return response.status;
      }, { apiUrl: status.API_URL, headers: apiHeaders, targetHeat: heatId });
      expect([401, 403]).toContain(directUpdate);

      const safeV2 = await admin.evaluate(async ({ apiUrl, headers, targetEvent }) => {
        const response = await fetch(`${apiUrl}/rest/v1/rpc/bulk_upsert_heats_safe_v2`, {
          method: 'POST', headers,
          body: JSON.stringify({ p_event_id: targetEvent, p_category: 'UNUSED', p_overwrite: false, p_heats: [], p_entries: [], p_mappings: [], p_participants: [], p_heat_configs: [] }),
        });
        return response.status;
      }, { apiUrl: status.API_URL, headers: serviceHeaders, targetEvent: eventId });
      expect(safeV2).toBe(204);

      // F. Full refresh of every field route, then read using SELECT only.
      for (const route of ['/admin', '/judge', '/display']) {
        await admin.goto(route);
        await admin.reload();
        const read = await admin.evaluate(async ({ apiUrl, headers, targetHeat }) => {
          const response = await fetch(`${apiUrl}/rest/v1/heat_configs?heat_id=eq.${encodeURIComponent(targetHeat)}&select=heat_id,waves`, { headers });
          return { status: response.status, rows: await response.json() };
        }, { apiUrl: status.API_URL, headers: apiHeaders, targetHeat: heatId });
        expect(read).toEqual({ status: 200, rows: [{ heat_id: heatId, waves: 19 }] });
      }

      rows = (await db.query('select heat_id, waves from public.heat_configs where heat_id = $1', [heatId])).rows;
      expect(rows).toEqual([{ heat_id: heatId, waves: 19 }]);
      console.info('P2.6.3G real HTTP/browser verification', JSON.stringify({ heatId, physicalRows: rows.length, finalWaves: rows[0].waves, realtimeMs }));
    } finally {
      await context.close();
      if (eventId) await db.query('delete from public.events where id = $1', [eventId]);
      await db.query('delete from auth.users where id = $1', [userId]);
      await db.end();
    }
  });
});
