import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ensureHeatId } from '../../utils/heat';

const enabled = process.env.RUN_REAL_WAL_INTEGRATION === '1';
const projectRoot = path.resolve(__dirname, '../../../..');

const localStatus = () => {
  const output = execFileSync('supabase', ['status', '--workdir', path.join(projectRoot, 'backend'), '-o', 'json'], {
    encoding: 'utf8',
  });
  return JSON.parse(output.slice(output.indexOf('{'))) as { DB_URL: string; API_URL: string; ANON_KEY: string };
};

describe.runIf(enabled)('P2.5.2b real frontend WAL identity', () => {
  it('characterizes normal ACK, lost ACK, duplicate coordinator calls, refresh and network return', async () => {
    const status = localStatus();
    localStorage.setItem('supabase_url_override', status.API_URL);
    localStorage.setItem('supabase_anon_override', status.ANON_KEY);
    localStorage.setItem('supabase_mode', 'local');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });

    vi.resetModules();
    const [{ scoreRepository }, { supabase }, { useOfflineStore }, { replayOfflineQueues }, { canonicalizeScores }, { calculateSurferStats }] = await Promise.all([
      import('../ScoreRepository'),
      import('../../lib/supabase'),
      import('../../stores/offlineStore'),
      import('../../lib/offlineSyncCoordinator'),
      import('../../api/modules/scoring.api'),
      import('../../utils/scoring'),
    ]);

    const db = new Client({ connectionString: status.DB_URL });
    const runId = `p252a_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const eventName = `P2.5.2A ${runId}`;
    const heatId = ensureHeatId(`${runId}-OPEN-R1-H1`);
    let eventId = 0;

    const repositoryWithClient = scoreRepository as unknown as { supabase: typeof supabase };
    const originalClient = repositoryWithClient.supabase;
    const wal = useOfflineStore.getState();
    wal.clearMutations();
    wal.setOnline(true);

    const saveRequest = (waveNumber: number, score = 7.5) => ({
      heatId, competition: eventName, division: 'OPEN', round: 1, eventId,
      judgeId: 'judge-real-wal-1', judgeName: 'Juge WAL 1', judgeStation: 'J1',
      judgeIdentityId: 'judge-real-wal-1', surfer: 'ROUGE', waveNumber, score,
    });

    const installLostAckThroughRetryWindow = () => {
      let lostAckCount = 0;
      repositoryWithClient.supabase = new Proxy(originalClient, {
        get(target, property) {
          if (property !== 'rpc') return Reflect.get(target, property);
          return async (functionName: string, args: Record<string, unknown>) => {
            const response = await originalClient.rpc(functionName, args);
            if (lostAckCount < 4 && functionName === 'upsert_score_secure' && !response.error) {
              lostAckCount += 1;
              return { ...response, error: { code: 'NETWORK_ERROR', message: 'Simulated lost ACK after server commit' } };
            }
            return response;
          };
        },
      }) as typeof supabase;
    };

    try {
      await db.connect();
      eventId = Number((await db.query(`
        insert into public.events (name, organizer, start_date, end_date, price, currency, status, paid)
        values ($1, 'P2.5.2a', current_date, current_date, 0, 'XOF', 'paid', true)
        returning id
      `, [eventName])).rows[0].id);
      await db.query(`
        insert into public.heats
          (id, event_id, competition, division, round, heat_number, heat_size, status, color_order)
        values ($1, $2, $3, 'OPEN', 1, 1, 1, 'running', array['ROUGE'])
      `, [heatId, eventId, eventName]);
      await db.query(`
        insert into public.heat_judge_assignments
          (heat_id, event_id, station, judge_id, judge_name, assigned_by)
        values
          ($1, $2, 'J1', 'judge-real-wal-1', 'Juge WAL 1', 'p252a'),
          ($1, $2, 'J2', 'judge-real-wal-2', 'Juge WAL 2', 'p252a'),
          ($1, $2, 'J3', 'judge-real-wal-3', 'Juge WAL 3', 'p252a')
      `, [heatId, eventId]);
      await db.query(`
        insert into public.heat_realtime_config
          (heat_id, status, timer_duration_minutes, config_data, updated_by)
        values ($1, 'running', 20, '{}'::jsonb, 'p252a')
      `, [heatId]);

      // A. Normal ACK: no WAL entry and one physical row.
      const normal = await scoreRepository.saveScore(saveRequest(1));
      const normalRows = Number((await db.query(
        `select count(*)::int as count from public.scores where heat_id = $1 and wave_number = 1 and judge_station = 'J1'`,
        [heatId],
      )).rows[0].count);
      expect(normalRows).toBe(1);
      expect(useOfflineStore.getState().mutations).toHaveLength(0);

      // B. Server commits but the client loses the ACK. BaseRepository executes its real offline fallback.
      installLostAckThroughRetryWindow();
      const lostAckResult = await scoreRepository.saveScore(saveRequest(2));
      repositoryWithClient.supabase = originalClient;
      const walAfterLostAck = structuredClone(useOfflineStore.getState().mutations);
      expect(walAfterLostAck).toHaveLength(1);
      expect(walAfterLostAck[0].payload.id).toBe(lostAckResult.id);

      // Complete the nominal three-judge wave without using ScoreRepository/WAL for J2/J3.
      await db.query(`
        insert into public.scores
          (id, event_id, heat_id, competition, division, round, judge_id, judge_name,
           judge_station, judge_identity_id, surfer, wave_number, score, timestamp, created_at)
        values
          ($1, $2, $3, $4, 'OPEN', 1, 'judge-real-wal-2', 'Juge WAL 2', 'J2', 'judge-real-wal-2', 'ROUGE', 2, 7.5, now(), now()),
          ($5, $2, $3, $4, 'OPEN', 1, 'judge-real-wal-3', 'Juge WAL 3', 'J3', 'judge-real-wal-3', 'ROUGE', 2, 7.5, now(), now())
      `, [crypto.randomUUID(), eventId, heatId, eventName, crypto.randomUUID()]);

      // C. Two real coordinator calls: its in-progress guard permits one WAL replay only.
      await Promise.all([replayOfflineQueues('p252a-double-1'), replayOfflineQueues('p252a-double-2')]);
      const replayRows = (await db.query(`
        select id, heat_id, surfer, wave_number, judge_station, score, timestamp, created_at
        from public.scores
        where heat_id = $1 and surfer = 'ROUGE' and wave_number = 2
        order by created_at, id
      `, [heatId])).rows;
      const j1ReplayRows = replayRows.filter((row) => row.judge_station === 'J1');
      expect(j1ReplayRows).toHaveLength(1);
      expect(j1ReplayRows[0].id).toBe(lostAckResult.id);
      expect(useOfflineStore.getState().mutations).toHaveLength(0);

      const legacyScores = replayRows.map((row) => ({
        id: row.id, event_id: eventId, heat_id: row.heat_id, competition: eventName, division: 'OPEN', round: 1,
        judge_id: row.judge_station, judge_name: row.judge_station, judge_station: row.judge_station,
        surfer: row.surfer, wave_number: row.wave_number, score: Number(row.score),
        timestamp: new Date(row.timestamp).toISOString(), created_at: new Date(row.created_at).toISOString(),
      }));
      const canonical = canonicalizeScores(legacyScores);
      const stats = calculateSurferStats(canonical, ['ROUGE'], 3, 4);
      expect(canonical.filter((score) => score.wave_number === 2)).toHaveLength(3);
      expect(stats[0].waves.find((wave) => wave.wave === 2)?.score).toBe(7.5);

      // D/E. Lost ACK again, serialize/restore the persisted shape, remain offline, then replay on network return.
      installLostAckThroughRetryWindow();
      const refreshResult = await scoreRepository.saveScore(saveRequest(3));
      repositoryWithClient.supabase = originalClient;
      const persistedWalJson = JSON.stringify(useOfflineStore.getState().mutations);
      const persistedMutationId = useOfflineStore.getState().mutations[0].payload.id;
      useOfflineStore.setState({ mutations: [] });
      useOfflineStore.setState({ mutations: JSON.parse(persistedWalJson) });
      expect(useOfflineStore.getState().mutations[0].payload.id).toBe(refreshResult.id);
      expect(persistedMutationId).toBe(refreshResult.id);

      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      useOfflineStore.getState().setOnline(false);
      await replayOfflineQueues('p252a-offline');
      expect(useOfflineStore.getState().mutations).toHaveLength(1);

      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      useOfflineStore.getState().setOnline(true);
      // J. Lose every ACK during the corrected replay: the same UUID is retried and the WAL remains.
      installLostAckThroughRetryWindow();
      await expect(replayOfflineQueues('p252b-replay-lost-ack')).rejects.toThrow();
      repositoryWithClient.supabase = originalClient;
      expect(useOfflineStore.getState().mutations).toHaveLength(1);
      const rowsAfterReplayAckLoss = (await db.query(`
        select id from public.scores
        where heat_id = $1 and surfer = 'ROUGE' and wave_number = 3 and judge_station = 'J1'
      `, [heatId])).rows;
      expect(rowsAfterReplayAckLoss).toHaveLength(1);
      expect(rowsAfterReplayAckLoss[0].id).toBe(refreshResult.id);

      await replayOfflineQueues('p252b-network-return');
      const refreshRows = (await db.query(`
        select id from public.scores
        where heat_id = $1 and surfer = 'ROUGE' and wave_number = 3 and judge_station = 'J1'
        order by created_at, id
      `, [heatId])).rows;
      expect(refreshRows).toHaveLength(1);
      expect(refreshRows[0].id).toBe(refreshResult.id);
      expect(useOfflineStore.getState().mutations).toHaveLength(0);

      // Additional safety proof: a stale lost-ACK mutation can outrank a newer server correction after replay.
      installLostAckThroughRetryWindow();
      const staleLostAck = await scoreRepository.saveScore(saveRequest(4, 6));
      repositoryWithClient.supabase = originalClient;
      expect(useOfflineStore.getState().mutations).toHaveLength(1);
      const externalCorrectionId = crypto.randomUUID();
      await db.query(`
        insert into public.scores
          (id, event_id, heat_id, competition, division, round, judge_id, judge_name,
           judge_station, judge_identity_id, surfer, wave_number, score, timestamp, created_at)
        values ($1, $2, $3, $4, 'OPEN', 1, 'judge-real-wal-1', 'Juge WAL 1', 'J1',
                'judge-real-wal-1', 'ROUGE', 4, 9, now(), now())
      `, [externalCorrectionId, eventId, heatId, eventName]);
      await replayOfflineQueues('p252a-stale-after-external-correction');
      const staleRows = (await db.query(`
        select id, heat_id, surfer, wave_number, judge_station, score, timestamp, created_at
        from public.scores
        where heat_id = $1 and surfer = 'ROUGE' and wave_number = 4 and judge_station = 'J1'
        order by created_at, id
      `, [heatId])).rows;
      const staleCanonical = canonicalizeScores(staleRows.map((row) => ({
        id: row.id, event_id: eventId, heat_id: row.heat_id, competition: eventName, division: 'OPEN', round: 1,
        judge_id: row.judge_station, judge_name: row.judge_station, judge_station: row.judge_station,
        surfer: row.surfer, wave_number: row.wave_number, score: Number(row.score),
        timestamp: new Date(row.timestamp).toISOString(), created_at: new Date(row.created_at).toISOString(),
      })));
      expect(staleRows).toHaveLength(2);
      expect(staleCanonical).toHaveLength(1);
      expect(staleCanonical[0].score).toBe(9);
      expect(staleCanonical[0].id).toBe(externalCorrectionId);

      // I. Invalid legacy payload remains queued and exposes an operator-visible sync error.
      const invalidMutation = {
        id: crypto.randomUUID(), timestamp: new Date().toISOString(), table: 'scores' as const,
        action: 'insert' as const, payload: { heat_id: heatId },
      };
      useOfflineStore.setState({ mutations: [invalidMutation] });
      await expect(replayOfflineQueues('p252b-invalid-payload')).rejects.toThrow();
      expect(useOfflineStore.getState().mutations).toEqual([invalidMutation]);
      expect(useOfflineStore.getState().syncError).toContain('Payload WAL score invalide');
      useOfflineStore.getState().clearMutations();

      const constraintRows = (await db.query(`
        select conname, pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conrelid = 'public.scores'::regclass
        order by conname
      `)).rows;
      const indexRows = (await db.query(`
        select indexname, indexdef
        from pg_indexes
        where schemaname = 'public' and tablename = 'scores'
        order by indexname
      `)).rows;

      console.log('P2.5.2b real WAL identity verification', JSON.stringify({
        normal_ack: {
          first_uuid: normal.id,
          wal_count: 0,
          physical_rows: normalRows,
        },
        lost_ack_double_coordinator: {
          first_uuid: lostAckResult.id,
          wal_payload_uuid: walAfterLostAck[0].payload.id,
          replay_uuid: j1ReplayRows[0].id,
          physical_rows: j1ReplayRows.length,
          business_facts: new Set(j1ReplayRows.map((row) => `${row.heat_id}|${row.surfer}|${row.wave_number}|${row.judge_station}`)).size,
          lww_selected_uuid: canonical.find((score) => score.wave_number === 2 && score.judge_station === 'J1')?.id,
          displayed_wave_average: stats[0].waves.find((wave) => wave.wave === 2)?.score,
          wal_after_replay: useOfflineStore.getState().mutations.length,
        },
        refresh_network_return: {
          first_uuid: refreshResult.id,
          wal_payload_uuid: persistedMutationId,
          uuids_after_replay: refreshRows.map((row) => row.id),
          physical_rows: refreshRows.length,
          physical_rows_after_replay_ack_loss: rowsAfterReplayAckLoss.length,
          wal_after_replay: useOfflineStore.getState().mutations.length,
        },
        stale_replay_after_external_correction: {
          first_uuid: staleLostAck.id,
          external_correction_uuid: externalCorrectionId,
          replayed_original_uuid: staleLostAck.id,
          lww_uuid: staleCanonical[0].id,
          physical_rows: staleRows.length,
          expected_latest_score_before_replay: 9,
          lww_score_after_replay: staleCanonical[0].score,
          wal_after_replay: useOfflineStore.getState().mutations.length,
        },
        constraints: constraintRows,
        indexes: indexRows,
      }, null, 2));
    } finally {
      repositoryWithClient.supabase = originalClient;
      useOfflineStore.getState().clearMutations();
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      if (eventId) await db.query('delete from public.events where id = $1', [eventId]);
      await db.end();
      localStorage.removeItem('supabase_url_override');
      localStorage.removeItem('supabase_anon_override');
      localStorage.removeItem('supabase_mode');
    }
  }, 90_000);
});
