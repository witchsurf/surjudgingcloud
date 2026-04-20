#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

function resolveLocalSupabaseUrl() {
  const explicitHost = String(process.env.SURF_HP_HOST || '').trim();
  if (explicitHost) return `http://${explicitHost}:8000`;

  const profile = String(process.env.SURF_HP_PROFILE || '').trim().toLowerCase();
  if (profile === 'field') return 'http://192.168.1.2:8000';
  if (profile === 'home') return 'http://10.0.0.28:8000';

  return process.env.VITE_SUPABASE_URL_LAN;
}

const normalizeColor = (value = '') => {
  const raw = String(value || '').trim().toUpperCase();
  const mapping = {
    RED: 'RED',
    ROUGE: 'RED',
    WHITE: 'WHITE',
    BLANC: 'WHITE',
    YELLOW: 'YELLOW',
    JAUNE: 'YELLOW',
    BLUE: 'BLUE',
    BLEU: 'BLUE',
    GREEN: 'GREEN',
    VERT: 'GREEN',
    BLACK: 'BLACK',
    NOIR: 'BLACK',
  };
  return mapping[raw] || raw;
};

const normalizeJudgeId = (value = '') => {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'KIOSK-J1') return 'J1';
  if (upper === 'KIOSK-J2') return 'J2';
  if (upper === 'KIOSK-J3') return 'J3';
  return upper || value || '';
};

const getJudgeStation = (score) => normalizeJudgeId(score?.judge_station || score?.judge_id);

function calculateScoreAverage(scores, judgeCount) {
  if (!scores.length) return 0;
  const values = [...scores];
  if (judgeCount >= 5 && values.length >= judgeCount) {
    values.sort((a, b) => a - b);
    const trimmed = values.slice(1, -1);
    if (trimmed.length) {
      return Math.round((trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length) * 100) / 100;
    }
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function computeEffectiveInterferences(calls, judgeCount) {
  if (!calls.length || judgeCount <= 0) return [];
  const threshold = Math.floor(judgeCount / 2) + 1;
  const byTarget = new Map();

  for (const call of calls) {
    const key = `${normalizeColor(call.surfer)}::${Number(call.wave_number)}`;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(call);
  }

  const effective = [];
  for (const targetCalls of byTarget.values()) {
    const sorted = [...targetCalls].sort((a, b) => {
      const left = String(b.updated_at || b.created_at || '');
      const right = String(a.updated_at || a.created_at || '');
      return left.localeCompare(right);
    });

    const override = sorted.find((call) => call.is_head_judge_override);
    if (override) {
      effective.push({
        surfer: normalizeColor(override.surfer),
        wave_number: Number(override.wave_number),
        type: override.call_type,
      });
      continue;
    }

    const latestByJudge = new Map();
    for (const call of sorted) {
      const judgeKey = String(call.judge_id || '').trim().toUpperCase();
      if (judgeKey && !latestByJudge.has(judgeKey)) {
        latestByJudge.set(judgeKey, call);
      }
    }

    const int1 = [...latestByJudge.values()].filter((call) => call.call_type === 'INT1').length;
    const int2 = [...latestByJudge.values()].filter((call) => call.call_type === 'INT2').length;

    if (int2 >= threshold) {
      const ref = sorted.find((call) => call.call_type === 'INT2') || sorted[0];
      effective.push({ surfer: normalizeColor(ref.surfer), wave_number: Number(ref.wave_number), type: 'INT2' });
    } else if (int1 >= threshold) {
      const ref = sorted.find((call) => call.call_type === 'INT1') || sorted[0];
      effective.push({ surfer: normalizeColor(ref.surfer), wave_number: Number(ref.wave_number), type: 'INT1' });
    }
  }

  return effective;
}

function summarizeInterferenceBySurfer(effective) {
  const summary = new Map();
  for (const item of effective) {
    const key = normalizeColor(item.surfer);
    const current = summary.get(key) || { count: 0, type: null, isDisqualified: false };
    const count = current.count + 1;
    summary.set(key, {
      count,
      type: current.type || item.type,
      isDisqualified: count >= 2,
    });
  }
  return summary;
}

function maxAdvancersForHeatSize(heatSize) {
  if (heatSize <= 0) return 0;
  if (heatSize <= 2) return 1;
  return 2;
}

function makePlaceholder(ref) {
  return `R${ref.source_round}-H${ref.source_heat}-P${ref.source_position}`;
}

function moveSnakeCursor(index, direction, heatCount) {
  if (heatCount <= 1) return [0, 1];
  if (direction === 1) {
    if (index === heatCount - 1) return [index, -1];
    return [index + 1, direction];
  }
  if (index === 0) return [index, 1];
  return [index - 1, direction];
}

function distributeRefsSnakeVariable(refs, targetHeats) {
  const assignments = targetHeats.map((heat) => ({
    heat_id: heat.id,
    capacity: Math.max(0, Number(heat.heat_size || 0)),
    refs: [],
  }));

  if (!assignments.length || !refs.length) return assignments;

  let index = 0;
  let direction = 1;
  for (const ref of refs) {
    let fallback = null;
    let chosen = null;
    let candidateIndex = index;
    let candidateDirection = direction;

    for (let guard = 0; guard < assignments.length * 2; guard += 1) {
      const assignment = assignments[candidateIndex];
      const hasCapacity = assignment.refs.length < assignment.capacity;

      if (hasCapacity) {
        fallback ??= { index: candidateIndex, direction: candidateDirection };
        const hasCollision = assignment.refs.some(
          (existing) =>
            existing.source_heat != null &&
            ref.source_heat != null &&
            existing.source_round === ref.source_round &&
            existing.source_heat === ref.source_heat
        );

        if (!hasCollision) {
          chosen = { index: candidateIndex, direction: candidateDirection };
          break;
        }
      }

      [candidateIndex, candidateDirection] = moveSnakeCursor(
        candidateIndex,
        candidateDirection,
        assignments.length
      );
    }

    chosen ??= fallback;
    if (!chosen) continue;

    assignments[chosen.index].refs.push(ref);
    [index, direction] = moveSnakeCursor(chosen.index, chosen.direction, assignments.length);
  }

  return assignments;
}

function buildLayeredRefs(previousRoundHeats, requestedAdvancersPerHeat, totalCurrentSlots) {
  const refs = [];
  for (let position = 1; position <= requestedAdvancersPerHeat; position += 1) {
    for (const heat of previousRoundHeats) {
      const heatSize = Math.max(0, Number(heat.heat_size || 0));
      const advancers = Math.min(maxAdvancersForHeatSize(heatSize), requestedAdvancersPerHeat);
      if (position > advancers) continue;

      refs.push({
        source_round: Number(heat.round),
        source_heat: Number(heat.heat_number),
        source_position: position,
      });
    }
  }
  if (refs.length < totalCurrentSlots && previousRoundHeats.length > 1) {
    refs.push({
      source_round: Number(previousRoundHeats[0].round),
      source_heat: null,
      source_position: null,
      best_second_round: Number(previousRoundHeats[0].round),
    });
  }
  return refs;
}

function inferMappings(sequence, targetHeatId) {
  const ordered = [...sequence].sort((a, b) => Number(a.round) - Number(b.round) || Number(a.heat_number) - Number(b.heat_number));
  const target = ordered.find((heat) => heat.id === targetHeatId);
  if (!target || Number(target.round) <= 1) return [];

  const previousRound = Number(target.round) - 1;
  const previousRoundHeats = ordered.filter((heat) => Number(heat.round) === previousRound);
  const currentRoundHeats = ordered.filter((heat) => Number(heat.round) === Number(target.round));
  if (!previousRoundHeats.length || !currentRoundHeats.length) return [];

  const totalCurrentSlots = currentRoundHeats.reduce((sum, heat) => sum + Math.max(0, Number(heat.heat_size || 0)), 0);
  if (totalCurrentSlots <= 0) return [];

  const requestedAdvancersPerHeat = Math.max(1, Math.ceil(totalCurrentSlots / previousRoundHeats.length));
  const refs = buildLayeredRefs(previousRoundHeats, requestedAdvancersPerHeat, totalCurrentSlots);

  const assignments = distributeRefsSnakeVariable(refs, currentRoundHeats);
  const targetAssignment = assignments.find((assignment) => assignment.heat_id === targetHeatId);
  if (!targetAssignment) return [];

  return targetAssignment.refs.map((ref, index) => ({
    heat_id: targetHeatId,
    position: index + 1,
    placeholder: ref.best_second_round ? `Meilleur 2e R${ref.best_second_round}` : makePlaceholder(ref),
    source_round: ref.best_second_round ? null : ref.source_round,
    source_heat: ref.best_second_round ? null : ref.source_heat,
    source_position: ref.best_second_round ? null : ref.source_position,
  }));
}

function rankSurfers(entries, scores, interferenceCalls) {
  const entryByColor = new Map();
  for (const entry of entries) {
    const color = normalizeColor(entry.color);
    if (!color) continue;
    entryByColor.set(color, entry);
  }

  const grouped = new Map();
  const judgeKeys = new Set();

  for (const score of scores) {
    const numericScore = Number(score.score || 0);
    if (numericScore <= 0) continue;
    const surfer = normalizeColor(score.surfer);
    if (!entryByColor.has(surfer)) continue;
    const waveNumber = Number(score.wave_number);
    const judgeKey = getJudgeStation(score);
    if (!judgeKey) continue;
    judgeKeys.add(judgeKey);

    if (!grouped.has(surfer)) grouped.set(surfer, new Map());
    const byWave = grouped.get(surfer);
    if (!byWave.has(waveNumber)) byWave.set(waveNumber, new Map());
    const byJudge = byWave.get(waveNumber);
    const createdKey = score.created_at || score.timestamp || '';
    const existing = byJudge.get(judgeKey);
    if (!existing || createdKey >= existing.createdKey) {
      byJudge.set(judgeKey, { score: numericScore, createdKey });
    }
  }

  const judgeCount = Math.max(judgeKeys.size, 1);
  const interferenceBySurfer = summarizeInterferenceBySurfer(computeEffectiveInterferences(interferenceCalls, judgeCount));

  const stats = [];
  for (const [surfer, waves] of grouped.entries()) {
    const averages = [...waves.entries()]
      .map(([waveNumber, byJudge]) => ({
        waveNumber,
        score: calculateScoreAverage([...byJudge.values()].map((payload) => payload.score), judgeCount),
      }))
      .sort((a, b) => b.score - a.score);

    const waveA = averages[0]?.score ?? 0;
    const waveB = averages[1]?.score ?? 0;
    const summary = interferenceBySurfer.get(surfer) || { count: 0, type: null, isDisqualified: false };
    let bestTwo = Math.round((waveA + waveB) * 100) / 100;

    if (summary.isDisqualified) {
      bestTwo = 0;
    } else if (summary.type === 'INT1') {
      bestTwo = Math.round((waveA + waveB / 2) * 100) / 100;
    } else if (summary.type === 'INT2') {
      bestTwo = Math.round(waveA * 100) / 100;
    }

    stats.push({
      surfer,
      bestTwo,
      participant_id: entryByColor.get(surfer)?.participant_id ?? null,
      seed: entryByColor.get(surfer)?.seed ?? null,
      isDisqualified: summary.isDisqualified,
    });
  }

  const eligible = stats
    .filter((item) => !item.isDisqualified)
    .sort((a, b) => b.bestTwo - a.bestTwo || a.surfer.localeCompare(b.surfer));

  let currentRank = 0;
  let lastScore = null;
  for (let index = 0; index < eligible.length; index += 1) {
    const item = eligible[index];
    if (lastScore === null || item.bestTwo !== lastScore) {
      currentRank = index + 1;
      lastScore = item.bestTwo;
    }
    item.rank = currentRank;
  }

  return new Map(eligible.map((item) => [item.rank, item]));
}

async function fetchAll(client, table, select, filterBuilder) {
  const rows = [];
  let from = 0;
  while (true) {
    const query = filterBuilder(client.from(table).select(select)).range(from, from + 999);
    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function fetchBrokenHeats(client, eventFilter, divisionFilter, rewriteMappings) {
  let heatQuery = client
    .from('heats')
    .select('id,event_id,division,round,heat_number,heat_size,color_order')
    .gt('round', 1)
    .order('event_id')
    .order('division')
    .order('round')
    .order('heat_number');

  if (eventFilter) {
    if (/^\d+$/.test(String(eventFilter))) {
      heatQuery = heatQuery.eq('event_id', Number(eventFilter));
    } else {
      heatQuery = heatQuery.eq('division', eventFilter);
    }
  }
  if (divisionFilter) {
    heatQuery = heatQuery.ilike('division', divisionFilter);
  }

  const { data: heats, error } = await heatQuery;
  if (error) throw error;

  const broken = [];
  for (const heat of heats || []) {
    const { data: entries, error: entriesError } = await client
      .from('heat_entries')
      .select('position,participant_id,seed,color')
      .eq('heat_id', heat.id)
      .order('position');
    if (entriesError) throw entriesError;
    if (!(entries || []).length) continue;
    const assigned = (entries || []).filter((entry) => entry.participant_id !== null);
    if (!rewriteMappings && assigned.length > 0) continue;

    const { data: sourceScores, error: scoreError } = await client
      .from('scores')
      .select('id')
      .eq('event_id', heat.event_id)
      .eq('division', heat.division)
      .lt('round', heat.round)
      .gt('score', 0)
      .limit(1);
    if (scoreError) throw scoreError;
    if (!(sourceScores || []).length) continue;

    broken.push(heat);
  }

  return broken;
}

async function repairTargetHeat(client, targetHeat, options = {}) {
  const { data: sequence, error: seqError } = await client
    .from('heats')
    .select('id,round,heat_number,heat_size,color_order')
    .eq('event_id', targetHeat.event_id)
    .ilike('division', targetHeat.division)
    .order('round')
    .order('heat_number');
  if (seqError) throw seqError;

  let { data: mappings, error: mappingError } = await client
    .from('heat_slot_mappings')
    .select('heat_id,position,placeholder,source_round,source_heat,source_position')
    .eq('heat_id', targetHeat.id)
    .order('position');
  if (mappingError) throw mappingError;

  let usedInferredMappings = false;
  if (options.rewriteMappings || !(mappings || []).length) {
    const inferred = inferMappings(sequence || [], targetHeat.id);
    if (inferred.length) {
      usedInferredMappings = true;
      mappings = inferred;
      const { error: upsertError } = await client
        .from('heat_slot_mappings')
        .upsert(inferred, { onConflict: 'heat_id,position' });
      if (upsertError) {
        console.warn(`    ⚠️ ${targetHeat.id}: mapping upsert skipped (${upsertError.message})`);
      }
    }
  }

  if (!(mappings || []).length) {
    return { repaired: false, reason: 'no-mappings' };
  }

  const updates = [];
  for (const mapping of mappings) {
    const bestSecondRound = String(mapping.placeholder || '').trim().toUpperCase().match(/MEILLEUR\s*2E\s*R(\d+)/)?.[1];
    if (bestSecondRound) {
      const candidates = [];
      for (const heat of sequence || []) {
        if (Number(heat.round) !== Number(bestSecondRound)) continue;
        const [{ data: entries, error: entryError }, { data: scores, error: scoreError }, { data: calls, error: callError }] = await Promise.all([
          client.from('heat_entries').select('participant_id,seed,color').eq('heat_id', heat.id).order('position'),
          client.from('scores').select('surfer,wave_number,score,judge_id,judge_station,created_at,timestamp').eq('heat_id', heat.id).gt('score', 0).order('created_at'),
          client.from('interference_calls').select('judge_id,surfer,wave_number,call_type,is_head_judge_override,created_at,updated_at').eq('heat_id', heat.id),
        ]);
        if (entryError || scoreError || callError) throw entryError || scoreError || callError;
        const second = rankSurfers(entries || [], scores || [], calls || []).get(2);
        if (second) candidates.push({ ...second, sourceHeat: Number(heat.heat_number) });
      }

      const bestSecond = candidates.sort((a, b) => b.bestTwo - a.bestTwo || a.sourceHeat - b.sourceHeat || (a.seed ?? 9999) - (b.seed ?? 9999))[0];
      updates.push({
        heat_id: targetHeat.id,
        position: Number(mapping.position),
        participant_id: bestSecond?.participant_id ?? null,
        seed: bestSecond?.seed ?? Number(mapping.position),
        color: targetHeat.color_order?.[Number(mapping.position) - 1] || null,
      });
      continue;
    }

    const sourceHeat = (sequence || []).find(
      (heat) =>
        Number(heat.round) === Number(mapping.source_round)
        && Number(heat.heat_number) === Number(mapping.source_heat)
    );
    if (!sourceHeat) continue;

    const [{ data: entries, error: entryError }, { data: scores, error: scoreError }, { data: calls, error: callError }] = await Promise.all([
      client.from('heat_entries').select('participant_id,seed,color').eq('heat_id', sourceHeat.id).order('position'),
      client.from('scores').select('surfer,wave_number,score,judge_id,judge_station,created_at,timestamp').eq('heat_id', sourceHeat.id).gt('score', 0).order('created_at'),
      client.from('interference_calls').select('judge_id,surfer,wave_number,call_type,is_head_judge_override,created_at,updated_at').eq('heat_id', sourceHeat.id),
    ]);
    if (entryError || scoreError || callError) {
      throw entryError || scoreError || callError;
    }

    const qualifier = rankSurfers(entries || [], scores || [], calls || []).get(Number(mapping.source_position));
    updates.push({
      heat_id: targetHeat.id,
      position: Number(mapping.position),
      participant_id: qualifier?.participant_id ?? null,
      seed: qualifier?.seed ?? Number(mapping.position),
      color: targetHeat.color_order?.[Number(mapping.position) - 1] || null,
    });
  }

  if (!updates.length) {
    return { repaired: false, reason: 'no-updates' };
  }

  const { error: updateError } = await client
    .from('heat_entries')
    .upsert(updates, { onConflict: 'heat_id,position' });
  if (updateError) throw updateError;

  return {
    repaired: true,
    updatedSlots: updates.filter((row) => row.participant_id !== null).length,
    mappingCount: mappings.length,
    usedInferredMappings,
  };
}

function clientForTarget(target) {
  if (target === 'cloud') {
    return createClient(process.env.VITE_SUPABASE_URL_CLOUD, process.env.VITE_SUPABASE_ANON_KEY_CLOUD, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  if (target === 'local') {
    return createClient(resolveLocalSupabaseUrl(), process.env.VITE_SUPABASE_ANON_KEY_LAN, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  throw new Error(`Unknown target ${target}`);
}

async function main() {
  const targetArg = process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1] || 'both';
  const eventArg = process.argv.find((arg) => arg.startsWith('--event='))?.split('=')[1] || null;
  const divisionArg = process.argv.find((arg) => arg.startsWith('--division='))?.split('=')[1] || null;
  const dryRun = process.argv.includes('--dry-run');
  const rewriteMappings = process.argv.includes('--rewrite-mappings');
  const targets = targetArg === 'both' ? ['cloud', 'local'] : [targetArg];

  for (const target of targets) {
    const client = clientForTarget(target);
    const broken = await fetchBrokenHeats(client, eventArg, divisionArg, rewriteMappings);
    console.log(`\\n[${target}] target heats: ${broken.length}${rewriteMappings ? ' (mapping rewrite mode)' : ''}`);

    let repairedCount = 0;
    for (const heat of broken) {
      console.log(`  - ${heat.id} (${heat.division} R${heat.round}H${heat.heat_number})`);
      if (dryRun) continue;
      const result = await repairTargetHeat(client, heat, { rewriteMappings });
      console.log(`    repaired=${result.repaired} slots=${result.updatedSlots || 0} mappings=${result.mappingCount || 0}${result.reason ? ` reason=${result.reason}` : ''}`);
      if (result.repaired) repairedCount += 1;
    }

    if (!dryRun) {
      const remaining = await fetchBrokenHeats(client, eventArg, divisionArg, false);
      console.log(`[${target}] repaired heats=${repairedCount}, remaining=${remaining.length}`);
    }
  }
}

main().catch((error) => {
  console.error('❌ repair-broken-qualifiers failed:', error.message || error);
  process.exit(1);
});
