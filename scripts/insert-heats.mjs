#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

function generatePreviewHeats(participants, seriesSize = 4) {
  const colors = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'];
  const round1Heats = [];
  let current = [];
  participants.forEach(p => {
    if (current.length >= seriesSize) {
      round1Heats.push({ round: 1, heat_number: round1Heats.length + 1, surfers: current });
      current = [];
    }
    current.push({ color: colors[current.length], name: p.name, country: p.country });
  });
  if (current.length) round1Heats.push({ round: 1, heat_number: round1Heats.length + 1, surfers: current });
  return [{ round: 1, heats: round1Heats }];
}

function inferDivision(participants) {
  try {
    if (Array.isArray(participants) && participants.length > 0) {
      const counts = {};
      participants.forEach(p => { if (p.category) counts[p.category] = (counts[p.category] || 0) + 1; });
      const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
      return sorted.length ? sorted[0][0] : 'OPEN';
    }
  } catch (e) {}
  return 'OPEN';
}

async function main() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set in environment. Source .env.local first.');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Example participants — replace or extend if needed
  const participants = [
    { seed: 1, name: 'Aly', country: 'GABON', category: 'junior' },
    { seed: 2, name: 'Moise', country: 'SENEGAL', category: 'junior' },
    { seed: 3, name: 'Simon', country: 'SIERALEONE', category: 'junior' },
    { seed: 4, name: 'Noah', country: 'CAP VERT', category: 'junior' }
  ];

  const rounds = generatePreviewHeats(participants, 4);
  const competitionId = process.env.TEST_COMPETITION_ID || `EVENT_${Date.now()}_localtest`;

  const inferredDivision = inferDivision(participants);

  const formatted = rounds.flatMap(r => r.heats.map(heat => ({
    id: `${competitionId}_${heat.round}_H${heat.heat_number}`,
    competition: competitionId,
    division: inferredDivision,
    round: heat.round,
    heat_number: heat.heat_number,
    status: 'open',
    event_id: null,
    created_at: new Date().toISOString()
  })));

  try {
    // check existing ids
    const ids = formatted.map(h => h.id);
    const { data: existing, error: existErr } = await supabase.from('heats').select('id').in('id', ids);
    if (existErr) throw existErr;
    const existingSet = new Set((existing || []).map(r => r.id));
    const toInsert = formatted.filter(h => !existingSet.has(h.id));

    if (toInsert.length === 0) {
      console.log('No new heats to insert. Returning existing records.');
      const { data } = await supabase.from('heats').select('*').in('id', ids);
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const { data, error } = await supabase.from('heats').insert(toInsert).select();
    if (error) throw error;
    console.log('Inserted heats:');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error inserting heats:', err.message || err);
    process.exit(1);
  }
}

main();
