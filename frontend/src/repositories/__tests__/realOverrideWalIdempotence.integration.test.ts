import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ensureHeatId } from '../../utils/heat';

const enabled = process.env.RUN_REAL_OVERRIDE_WAL_INTEGRATION === '1';
const projectRoot = path.resolve(__dirname, '../../../..');
const supabaseTestWorkdir = process.env.SUPABASE_TEST_WORKDIR ?? path.join(projectRoot, 'backend');

const localStatus = () => {
  const output = execFileSync('supabase', ['status', '--workdir', supabaseTestWorkdir, '-o', 'json'], {
    encoding: 'utf8',
  });
  return JSON.parse(output.slice(output.indexOf('{'))) as { DB_URL: string; API_URL: string; ANON_KEY: string };
};

const integrationStatus = () => {
  const explicit = {
    DB_URL: process.env.SURFJUDGING_TEST_DB_URL,
    API_URL: process.env.SURFJUDGING_TEST_API_URL,
    ANON_KEY: process.env.SURFJUDGING_TEST_ANON_KEY,
  };
  return explicit.DB_URL && explicit.API_URL && explicit.ANON_KEY
    ? explicit as { DB_URL: string; API_URL: string; ANON_KEY: string }
    : localStatus();
};

describe.runIf(enabled)('P2.5.2d real override WAL identity', () => {
  it('characterizes nominal, lost ACK, coordinator, refresh, stale replay and partial legacy WAL', async () => {
    const status = integrationStatus();
    vi.stubEnv('VITE_DEPLOYMENT_MODE', 'cloud');
    vi.stubEnv('VITE_SUPABASE_URL_CLOUD', status.API_URL);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY_CLOUD', status.ANON_KEY);
    localStorage.setItem('supabase_url_override', status.API_URL);
    localStorage.setItem('supabase_anon_override', status.ANON_KEY);
    localStorage.setItem('supabase_mode', 'local');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });

    vi.resetModules();
    const [{ scoreRepository }, { useOfflineStore }, { replayOfflineQueues }] = await Promise.all([
      import('../ScoreRepository'),
      import('../../stores/offlineStore'),
      import('../../lib/offlineSyncCoordinator'),
    ]);

    const db = new Client({ connectionString: status.DB_URL });
    const runId = `p252c_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const eventName = `P2.5.2C ${runId}`;
    const heatId = ensureHeatId(`${runId}-OPEN-R1-H1`);
    let eventId = 0;
    const wal = useOfflineStore.getState();
    wal.clearMutations();
    wal.setOnline(true);

    const originalDispatchEvent = window.dispatchEvent.bind(window);
    const installLostOverrideAck = (limit = 4, skipMatchingEvents = 0) => {
      let count = 0;
      window.dispatchEvent = ((event: Event) => {
        if (event.type === 'localScoresUpdated' && skipMatchingEvents > 0) {
          skipMatchingEvents -= 1;
          return originalDispatchEvent(event);
        }
        if (event.type === 'localScoresUpdated' && count < limit) {
          count += 1;
          const error = new Error('Simulated override ACK loss after score and log commit') as Error & { code: string };
          error.code = 'NETWORK_ERROR';
          throw error;
        }
        return originalDispatchEvent(event);
      }) as typeof window.dispatchEvent;
    };
    const restoreAckBoundary = () => { window.dispatchEvent = originalDispatchEvent; };

    const saveRequest = (waveNumber: number, score: number) => ({
      heatId, competition: eventName, division: 'OPEN', round: 1, eventId,
      judgeId: 'judge-override-1', judgeName: 'Juge Override 1', judgeStation: 'J1',
      judgeIdentityId: 'judge-override-1', surfer: 'ROUGE', waveNumber, score,
    });
    const overrideRequest = (waveNumber: number, newScore: number) => ({
      heatId, competition: eventName, division: 'OPEN', round: 1,
      judgeId: 'judge-override-1', judgeName: 'Juge Override 1', judgeStation: 'J1',
      judgeIdentityId: 'judge-override-1', surfer: 'ROUGE', waveNumber, newScore,
      reason: 'correction' as const, comment: `P2.5.2c wave ${waveNumber}`,
    });
    const rowsForWave = async (waveNumber: number) => ({
      scores: (await db.query(`
        select id, score, timestamp, created_at from public.scores
        where heat_id = $1 and surfer = 'ROUGE' and wave_number = $2 and judge_station = 'J1'
        order by timestamp, created_at, id
      `, [heatId, waveNumber])).rows,
      logs: (await db.query(`
        select id, score_id, previous_score, new_score, created_at from public.score_overrides
        where heat_id = $1 and surfer = 'ROUGE' and wave_number = $2 and judge_station = 'J1'
        order by created_at, id
      `, [heatId, waveNumber])).rows,
    });
    const lwwFor = (rows: Array<Record<string, unknown>>) => rows.map((row) => ({
      id: String(row.id), event_id: eventId, heat_id: heatId, competition: eventName, division: 'OPEN', round: 1,
      judge_id: 'judge-override-1', judge_name: 'Juge Override 1', judge_station: 'J1', judge_identity_id: 'judge-override-1',
      surfer: 'ROUGE', wave_number: Number(row.wave_number), score: Number(row.score),
      timestamp: new Date(String(row.timestamp)).toISOString(), created_at: new Date(String(row.created_at)).toISOString(),
    })).sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp)
      || right.created_at.localeCompare(left.created_at)
      || right.id.localeCompare(left.id)
    )[0];

    try {
      await db.connect();
      eventId = Number((await db.query(`
        insert into public.events (name, organizer, start_date, end_date, price, currency, status, paid)
        values ($1, 'P2.5.2c', current_date, current_date, 0, 'XOF', 'paid', true) returning id
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
          ($1, $2, 'J1', 'judge-override-1', 'Juge Override 1', 'p252c'),
          ($1, $2, 'J2', 'judge-override-2', 'Juge Override 2', 'p252c'),
          ($1, $2, 'J3', 'judge-override-3', 'Juge Override 3', 'p252c')
      `, [heatId, eventId]);
      await db.query(`
        insert into public.heat_realtime_config
          (heat_id, status, timer_duration_minutes, config_data, updated_by)
        values ($1, 'running', 20, '{}'::jsonb, 'p252c')
      `, [heatId]);

      // A. Nominal override.
      const baseNominal = await scoreRepository.saveScore(saveRequest(1, 5));
      const nominal = await scoreRepository.overrideScore(overrideRequest(1, 8));
      const nominalRows = await rowsForWave(1);
      expect(nominalRows.scores).toHaveLength(1);
      expect(nominalRows.logs).toHaveLength(1);
      expect(nominalRows.logs[0].id).toBe(nominal.log.id);
      expect(nominalRows.logs[0].score_id).toBe(baseNominal.id);
      expect(useOfflineStore.getState().mutations).toHaveLength(0);

      // B. Both score and log commit, but every log ACK in the retry window is lost.
      const baseLostAck = await scoreRepository.saveScore(saveRequest(2, 5));
      installLostOverrideAck();
      const lostAck = await scoreRepository.overrideScore(overrideRequest(2, 6));
      expect(lostAck.updatedScore.id).toBe(baseLostAck.id);
      restoreAckBoundary();
      const walAfterLostAck = structuredClone(useOfflineStore.getState().mutations);
      const beforeReplay = await rowsForWave(2);
      expect(walAfterLostAck.map((mutation) => mutation.table)).toEqual(['scores', 'score_overrides']);
      expect(beforeReplay.scores).toHaveLength(1);
      expect(beforeReplay.logs).toHaveLength(1);

      // C/G. The real double coordinator replays once and preserves the stable score and log identities.
      await Promise.all([replayOfflineQueues('p252c-double-1'), replayOfflineQueues('p252c-double-2')]);
      const afterReplay = await rowsForWave(2);
      expect(afterReplay.scores).toHaveLength(1);
      expect(afterReplay.logs).toHaveLength(1);
      expect(afterReplay.logs[0].id).toBe(lostAck.log.id);
      expect(afterReplay.logs[0].score_id).toBe(lostAck.log.score_id);
      expect(new Date(afterReplay.logs[0].created_at).toISOString()).toBe(lostAck.log.created_at);
      expect(useOfflineStore.getState().mutations).toHaveLength(0);

      // D. Refresh preserves the legacy payload and identities on network return.
      await scoreRepository.saveScore(saveRequest(3, 5));
      installLostOverrideAck();
      await scoreRepository.overrideScore(overrideRequest(3, 6));
      restoreAckBoundary();
      const persistedWal = JSON.stringify(useOfflineStore.getState().mutations);
      useOfflineStore.setState({ mutations: [] });
      useOfflineStore.setState({ mutations: JSON.parse(persistedWal) });
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      useOfflineStore.getState().setOnline(false);
      await replayOfflineQueues('p252c-refresh-offline');
      expect(useOfflineStore.getState().mutations).toHaveLength(2);
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      useOfflineStore.getState().setOnline(true);
      await replayOfflineQueues('p252c-refresh-online');
      const refreshRows = await rowsForWave(3);
      expect(refreshRows.scores).toHaveLength(1);
      expect(refreshRows.logs).toHaveLength(1);

      // F. A stale override replayed after a newer server correction never creates a newer score.
      await scoreRepository.saveScore(saveRequest(4, 5));
      installLostOverrideAck();
      const staleOverride = await scoreRepository.overrideScore(overrideRequest(4, 6));
      restoreAckBoundary();
      const externalCorrectionId = crypto.randomUUID();
      await db.query(`
        insert into public.scores
          (id, event_id, heat_id, competition, division, round, judge_id, judge_name, judge_station,
           judge_identity_id, surfer, wave_number, score, timestamp, created_at)
        values ($1, $2, $3, $4, 'OPEN', 1, 'judge-override-1', 'Juge Override 1', 'J1',
                'judge-override-1', 'ROUGE', 4, 9, now(), now())
      `, [externalCorrectionId, eventId, heatId, eventName]);
      await replayOfflineQueues('p252c-stale-after-newer');
      const staleRows = await rowsForWave(4);
      const staleLww = lwwFor(staleRows.scores.map((row) => ({ ...row, wave_number: 4 })));
      expect(staleRows.scores).toHaveLength(1);
      expect(staleRows.logs).toHaveLength(1);
      expect(staleLww.score).toBe(9);
      expect(staleLww.id).toBe(staleOverride.updatedScore.id);

      // E. ACK loss during replay retains the original log mutation without creating another pair.
      await scoreRepository.saveScore(saveRequest(5, 5));
      installLostOverrideAck();
      await scoreRepository.overrideScore(overrideRequest(5, 7));
      restoreAckBoundary();
      const replayStartWal = structuredClone(useOfflineStore.getState().mutations);
      expect(replayStartWal.map((mutation) => mutation.table)).toEqual(['scores', 'score_overrides']);
      installLostOverrideAck(4, 1);
      await expect(replayOfflineQueues('p252c-replay-ack-loss')).rejects.toThrow();
      restoreAckBoundary();
      const walAfterReplayAckLoss = structuredClone(useOfflineStore.getState().mutations);
      expect(walAfterReplayAckLoss.map((mutation) => mutation.table)).toEqual(['score_overrides']);
      expect(walAfterReplayAckLoss[0]).toEqual(replayStartWal[1]);
      const ackLossRows = await rowsForWave(5);
      expect(ackLossRows.scores).toHaveLength(1);
      expect(ackLossRows.logs).toHaveLength(1);
      expect(ackLossRows.logs[0].id).toBe(replayStartWal[1].payload.id);
      await replayOfflineQueues('p252d-replay-ack-return');
      expect(useOfflineStore.getState().mutations).toHaveLength(0);

      const legacyPayload = (waveNumber: number) => ({
        heat_id: heatId, score_id: baseNominal.id,
        judge_id: 'judge-override-1', judge_name: 'Juge Override 1', judge_station: 'J1',
        judge_identity_id: 'judge-override-1', surfer: 'ROUGE', wave_number: waveNumber,
        previous_score: 5, new_score: 7, reason: 'correction' as const, comment: 'legacy',
        overridden_by: 'chief_judge', overridden_by_name: 'Chef Judge',
        created_at: '2026-08-05T20:00:00.000Z',
      });
      const replaySingle = async (id: string, timestamp: string, payload: Record<string, unknown>, reason: string) => {
        const entry = { id, timestamp, table: 'score_overrides' as const, action: 'insert' as const, payload };
        useOfflineStore.setState({ mutations: [entry], syncError: null });
        await replayOfflineQueues(reason);
        return entry;
      };

      // H. Legacy WAL with payload.id.
      const payloadLogId = crypto.randomUUID();
      await replaySingle(crypto.randomUUID(), '2026-08-05T20:00:01.000Z', { ...legacyPayload(6), id: payloadLogId }, 'p252d-payload-id');
      const payloadIdRows = await rowsForWave(6);
      expect(payloadIdRows.scores).toHaveLength(0);
      expect(payloadIdRows.logs.map((row) => row.id)).toEqual([payloadLogId]);

      // I. Legacy WAL with mutation.id only.
      const mutationLogId = crypto.randomUUID();
      await replaySingle(mutationLogId, '2026-08-05T20:00:02.000Z', legacyPayload(7), 'p252d-mutation-id');
      const mutationIdRows = await rowsForWave(7);
      expect(mutationIdRows.scores).toHaveLength(0);
      expect(mutationIdRows.logs.map((row) => row.id)).toEqual([mutationLogId]);

      // J. No valid source UUID: deterministic identity remains stable across two replays.
      const deterministicEntry = {
        id: 'legacy-mutation', timestamp: '2026-08-05T20:00:03.000Z',
        table: 'score_overrides' as const, action: 'insert' as const,
        payload: { ...legacyPayload(8), id: 'legacy-log' },
      };
      useOfflineStore.setState({ mutations: [deterministicEntry], syncError: null });
      await replayOfflineQueues('p252d-deterministic-1');
      const deterministicFirst = await rowsForWave(8);
      useOfflineStore.setState({ mutations: [deterministicEntry], syncError: null });
      await replayOfflineQueues('p252d-deterministic-2');
      const deterministicSecond = await rowsForWave(8);
      expect(deterministicFirst.logs).toHaveLength(1);
      expect(deterministicSecond.logs).toHaveLength(1);
      expect(deterministicSecond.logs[0].id).toBe(deterministicFirst.logs[0].id);

      // K. Missing score_id remains queued and creates nothing.
      useOfflineStore.getState().clearMutations();
      const missingScoreIdMutation = {
        id: crypto.randomUUID(), timestamp: new Date().toISOString(), table: 'score_overrides' as const,
        action: 'insert' as const, payload: { ...legacyPayload(9), score_id: undefined },
      };
      useOfflineStore.setState({ mutations: [missingScoreIdMutation], syncError: null });
      await expect(replayOfflineQueues('p252d-missing-score-id')).rejects.toThrow();
      expect(useOfflineStore.getState().mutations).toEqual([missingScoreIdMutation]);
      expect(useOfflineStore.getState().syncError).toContain('score_id WAL override absent ou invalide');
      const missingScoreIdRows = await rowsForWave(9);
      expect(missingScoreIdRows.scores).toHaveLength(0);
      expect(missingScoreIdRows.logs).toHaveLength(0);

      // L. Invalid chronology remains queued and creates nothing.
      const invalidChronologyMutation = {
        id: 'legacy-invalid-id', timestamp: 'invalid', table: 'score_overrides' as const,
        action: 'insert' as const, payload: { ...legacyPayload(10), id: 'legacy-log', created_at: 'invalid' },
      };
      useOfflineStore.setState({ mutations: [invalidChronologyMutation], syncError: null });
      await expect(replayOfflineQueues('p252d-invalid-chronology')).rejects.toThrow();
      expect(useOfflineStore.getState().mutations).toEqual([invalidChronologyMutation]);
      expect(useOfflineStore.getState().syncError).toContain('Chronologie WAL override invalide');
      const invalidChronologyRows = await rowsForWave(10);
      expect(invalidChronologyRows.scores).toHaveLength(0);
      expect(invalidChronologyRows.logs).toHaveLength(0);

      const constraints = (await db.query(`
        select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conrelid in ('public.scores'::regclass, 'public.score_overrides'::regclass)
        order by table_name, conname
      `)).rows;

      console.log('P2.5.2d real override WAL identity verification', JSON.stringify({
        nominal: {
          original_score_uuid: baseNominal.id,
          corrected_score_uuid: nominal.updatedScore.id,
          override_log_uuid: nominal.log.id,
          log_score_id: nominal.log.score_id,
          score_timestamp: nominal.updatedScore.timestamp,
          score_created_at: nominal.updatedScore.created_at,
          log_created_at: nominal.log.created_at,
          physical_scores: nominalRows.scores.length,
          physical_logs: nominalRows.logs.length,
        },
        lost_ack_before_replay: {
          corrected_score_uuid: lostAck.updatedScore.id,
          override_log_uuid: lostAck.log.id,
          log_score_id: lostAck.log.score_id,
          score_timestamp: lostAck.updatedScore.timestamp,
          score_created_at: lostAck.updatedScore.created_at,
          log_created_at: lostAck.log.created_at,
          wal_payloads: walAfterLostAck,
          physical_scores: beforeReplay.scores.length,
          physical_logs: beforeReplay.logs.length,
        },
        lost_ack_after_double_coordinator: {
          score_uuids: afterReplay.scores.map((row) => row.id),
          log_uuids: afterReplay.logs.map((row) => row.id),
          log_score_ids: afterReplay.logs.map((row) => row.score_id),
          physical_scores: afterReplay.scores.length,
          physical_logs: afterReplay.logs.length,
          lww: lwwFor(afterReplay.scores.map((row) => ({ ...row, wave_number: 2 }))),
          wal_after_replay: 0,
        },
        refresh_network_return: {
          physical_scores: refreshRows.scores.length,
          physical_logs: refreshRows.logs.length,
        },
        stale_replay_after_newer_server_correction: {
          original_override_score_uuid: staleOverride.updatedScore.id,
          external_correction_uuid: externalCorrectionId,
          score_uuids: staleRows.scores.map((row) => row.id),
          physical_scores: staleRows.scores.length,
          physical_logs: staleRows.logs.length,
          lww_uuid: staleLww.id,
          lww_score: staleLww.score,
        },
        ack_loss_during_replay: {
          wal_before: replayStartWal,
          wal_after: walAfterReplayAckLoss,
          wal_growth: walAfterReplayAckLoss.length - replayStartWal.length,
        },
        legacy_wal_compatibility: {
          payload_id: payloadIdRows.logs[0]?.id,
          mutation_id: mutationIdRows.logs[0]?.id,
          deterministic_id_first: deterministicFirst.logs[0]?.id,
          deterministic_id_second: deterministicSecond.logs[0]?.id,
          missing_score_id_rows: missingScoreIdRows,
          invalid_chronology_rows: invalidChronologyRows,
          invalid_mutation_retained: useOfflineStore.getState().mutations.length,
        },
        constraints,
      }, null, 2));
    } finally {
      restoreAckBoundary();
      useOfflineStore.getState().clearMutations();
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
      if (eventId) await db.query('delete from public.events where id = $1', [eventId]);
      await db.end();
      localStorage.removeItem('supabase_url_override');
      localStorage.removeItem('supabase_anon_override');
      localStorage.removeItem('supabase_mode');
      vi.unstubAllEnvs();
    }
  }, 180_000);
});
