// Simple test script to verify division inference and heat formatting
// Run with: node scripts/test-format-heats.mjs

const participants = [
  { seed: 1, name: 'Aly', country: 'GABON', category: 'junior' },
  { seed: 2, name: 'Moise', country: 'SENEGAL', category: 'junior' },
  { seed: 3, name: 'Simon', country: 'SIERALEONE', category: 'junior' },
  { seed: 4, name: 'Noah', country: 'CAP VERT', category: 'junior' },
  { seed: 5, name: 'Paul', country: 'GABON', category: 'senior' },
];

// small heat generation: group participants into heats of size seriesSize
function generatePreviewHeats(participants, seriesSize) {
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

const rounds = generatePreviewHeats(participants, 4);
const heats = rounds.flatMap(r => r.heats.map(h => ({ round: h.round, heatNumber: h.heat_number, surfers: h.surfers })));

// Format heats like saveHeatsToDatabase would, but using provided participants rather than localStorage
function formatHeatsForInsert(heatsRounds, competitionId, participants) {
  const formatted = heatsRounds.map(r => r.heats.map(heat => {
    // infer division from participants most common category
    let inferred = 'OPEN';
    try {
      if (Array.isArray(participants) && participants.length > 0) {
        const counts = {};
        participants.forEach(p => { if (p.category) counts[p.category] = (counts[p.category] || 0) + 1; });
        const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
        inferred = sorted.length ? sorted[0][0] : 'OPEN';
      }
    } catch (e) {}

    return {
      id: `${competitionId}_${heat.round}_H${heat.heat_number || heat.heatNumber}`,
      competition: competitionId,
      division: inferred,
      round: heat.round,
      heat_number: heat.heat_number || heat.heatNumber,
      status: 'open',
      event_id: null,
      created_at: new Date().toISOString()
    };
  })).flat();
  return formatted;
}

const competitionId = 'EVENT_1762305402445_tme3su71u';
const formatted = formatHeatsForInsert(rounds, competitionId, participants);
console.log(JSON.stringify(formatted, null, 2));
