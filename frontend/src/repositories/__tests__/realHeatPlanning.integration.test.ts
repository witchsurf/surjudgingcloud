import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

const enabled = process.env.RUN_REAL_HEAT_PLANNING_INTEGRATION === '1';
const realWorkbookPath = process.env.REAL_COMPETITION_X_XLSX;
const projectRoot = path.resolve(__dirname, '../../../..');
const supabaseTestWorkdir = process.env.SUPABASE_TEST_WORKDIR ?? path.join(projectRoot, 'backend');

const localStatus = () => {
  const output = execFileSync('supabase', ['status', '--workdir', supabaseTestWorkdir, '-o', 'json'], { encoding: 'utf8' });
  return JSON.parse(output.slice(output.indexOf('{'))) as {
    DB_URL: string;
    API_URL: string;
    JWT_SECRET: string;
  };
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

describe.runIf(enabled)('P2.5.6k real isolated atomic safe heat planning', () => {
  it('creates inactive heats and leaves configs/data intact when safe replacement is blocked', async () => {
    const status = localStatus();
    localStorage.setItem('supabase_url_override', status.API_URL);
    localStorage.setItem('supabase_anon_override', authenticatedLocalToken(status.JWT_SECRET));
    localStorage.setItem('supabase_mode', 'local');
    vi.resetModules();

    const { heatPlanningRepository } = await import('../HeatPlanningRepository');
    const db = new Client({ connectionString: status.DB_URL });
    const runId = `p256f_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const eventName = `P2.5.6F ${runId}`;
    let eventId = 0;

    try {
      await db.connect();
      eventId = Number((await db.query(`
        insert into public.events (name, organizer, start_date, end_date, price, currency, status, paid)
        values ($1, 'P2.5.6f isolated test', current_date, current_date, 0, 'XOF', 'paid', true)
        returning id
      `, [eventName])).rows[0].id);

      const participantsBySeed = new Map([
        [1, { id: 0, eventId, category: 'TEST', seed: 1, name: 'Temporary One', country: 'SN', license: null }],
        [2, { id: 0, eventId, category: 'TEST', seed: 2, name: 'Temporary Two', country: 'FR', license: null }],
        [3, { id: 0, eventId, category: 'TEST', seed: 3, name: 'Temporary Three', country: null, license: null }],
      ]);
      const result = await heatPlanningRepository.createWithEntries({
        eventId, eventName, category: 'TEST', participantsBySeed,
        rounds: [{ name: 'Round 1', roundNumber: 1, heats: [{ heatNumber: 1, slots: [{ seed: 1 }, { seed: 2 }, { seed: 3 }] }] }],
        options: { overwrite: true, defaultJudges: ['J1', 'J2', 'J3'], tournamentType: 'elimination' },
      });

      const heatId = result.heats[0].id;
      const counts = (await db.query(`
        select
          (select count(*)::int from public.heats where event_id = $1) as heats,
          (select count(*)::int from public.heat_entries where heat_id = $2) as entries,
          (select count(*)::int from public.heat_configs where heat_id = $2) as configs,
          (select count(*)::int from public.scores where heat_id = $2) as scores,
          (select is_active from public.heats where id = $2) as is_active
      `, [eventId, heatId])).rows[0];
      expect(counts).toEqual({ heats: 1, entries: 3, configs: 1, scores: 0, is_active: false });

      await db.query("update public.heat_realtime_config set status='open' where heat_id=$1", [heatId]);
      await db.query(`
        insert into public.scores (
          id, heat_id, competition, division, round, judge_id, judge_name,
          surfer, wave_number, score, timestamp, event_id, judge_station
        ) values ($1, $2, $3, 'TEST', 1, 'J1', 'Judge', 'ROUGE', 1, 8, now(), $4, 'J1')
      `, [`${runId}_score`, heatId, eventName, eventId]);

      await expect(heatPlanningRepository.createWithEntries({
        eventId, eventName, category: 'TEST', participantsBySeed,
        rounds: [{ name: 'Round 1', roundNumber: 1, heats: [{ heatNumber: 1, slots: [{ seed: 1 }, { seed: 2 }, { seed: 3 }] }] }],
        options: { overwrite: true, defaultJudges: ['J1', 'J2', 'J3'], tournamentType: 'elimination' },
      })).rejects.toBeTruthy();

      const preserved = (await db.query(`
        select
          (select count(*)::int from public.heats where id = $1) as heats,
          (select count(*)::int from public.scores where heat_id = $1) as scores,
          (select count(*)::int from public.heat_configs where heat_id = $1) as configs
      `, [heatId])).rows[0];
      expect(preserved).toEqual({ heats: 1, scores: 1, configs: 1 });
    } finally {
      if (eventId > 0) {
        await db.query('delete from public.heats where event_id = $1', [eventId]);
        await db.query('delete from public.events where id = $1', [eventId]);
      }
      await db.end().catch(() => undefined);
      localStorage.removeItem('supabase_url_override');
      localStorage.removeItem('supabase_anon_override');
      localStorage.removeItem('supabase_mode');
    }
  }, 30_000);

  (realWorkbookPath ? it : it.skip)('persists one real Competition X category through the atomic RPC', async () => {
    const status = localStatus();
    localStorage.setItem('supabase_url_override', status.API_URL);
    localStorage.setItem('supabase_anon_override', authenticatedLocalToken(status.JWT_SECRET));
    localStorage.setItem('supabase_mode', 'local');
    vi.resetModules();

    const [{ parsePlanningXlsx }, { computeHeats }, { persistPlanningImportSafely }] = await Promise.all([
      import('../../adapters/planningImport/xlsxParser'),
      import('../../utils/bracket'),
      import('../../services/persistPlanningImportSafely'),
    ]);
    const bytes = readFileSync(realWorkbookPath!);
    const inputBytes = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(inputBytes).set(bytes);
    const parsed = await parsePlanningXlsx(inputBytes, { workbookName: 'Competition X.xlsx' });
    if (!parsed.input) throw new Error('Competition X canonical input missing');
    const category = parsed.input.participants[0]?.category;
    if (!category) throw new Error('Competition X category missing');
    const categoryParticipants = parsed.input.participants.filter((participant) => participant.category === category);
    const preview = computeHeats(categoryParticipants, { format: 'single-elim', preferredHeatSize: 'auto', variant: 'V1' });

    const db = new Client({ connectionString: status.DB_URL });
    const runId = `p256k_xlsx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    let eventId = 0;
    try {
      await db.connect();
      eventId = Number((await db.query(`
        insert into public.events (name, organizer, start_date, end_date, price, currency, status, paid)
        values ($1, 'P2.5.6k Competition X test', current_date, current_date, 0, 'XOF', 'paid', true)
        returning id
      `, [runId])).rows[0].id);

      await persistPlanningImportSafely({
        input: parsed.input,
        preview,
        eventId,
        eventName: runId,
        category,
        format: 'single-elim',
        overwrite: true,
      });

      const inventory = (await db.query(`
        select
          count(*)::int as heats,
          count(*) filter (where h.is_active)::int as active_heats,
          count(hc.heat_id)::int as configs
        from public.heats h
        left join public.heat_configs hc on hc.heat_id = h.id
        where h.event_id = $1 and h.division = $2
      `, [eventId, category])).rows[0];
      expect(inventory.heats).toBeGreaterThan(0);
      expect(inventory).toEqual({ heats: inventory.heats, active_heats: 0, configs: inventory.heats });
      expect(parsed.validRows).toHaveLength(62);
      expect(new Set(parsed.validRows.map((participant) => participant.category)).size).toBe(7);
    } finally {
      if (eventId > 0) {
        await db.query('delete from public.heats where event_id = $1', [eventId]);
        await db.query('delete from public.events where id = $1', [eventId]);
      }
      await db.end().catch(() => undefined);
      localStorage.removeItem('supabase_url_override');
      localStorage.removeItem('supabase_anon_override');
      localStorage.removeItem('supabase_mode');
    }
  }, 30_000);
});
