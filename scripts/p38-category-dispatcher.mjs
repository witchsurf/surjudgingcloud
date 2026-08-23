export const CATEGORY_ORDER = ['BENJAMIN','CADET','JUNIOR','MINIME','ONDINE OPEN','ONDINE U16','OPEN'];
export function buildCategoryCalls(artifact, eventId) {
  if (!Number.isInteger(eventId) || eventId < 10000) throw new Error('disposable event id required');
  if (!artifact || artifact.categories?.length !== 7) throw new Error('exactly seven categories required');
  const byName = new Map(artifact.categories.map((c) => [c.category, c]));
  if (byName.size !== 7 || CATEGORY_ORDER.some((name) => !byName.has(name))) throw new Error('category set/order invalid');
  return CATEGORY_ORDER.map((category) => {
    const c = byName.get(category);
    const rewrite = (value) => JSON.parse(JSON.stringify(value).replaceAll('10003', String(eventId)));
    const heats = c.heats.map(h => ({...h,event_id:eventId,competition:`P38-FULL62-${eventId}`,division:category,status:'open',is_active:false,color_order:h.heat_size===2?['ROUGE','BLANC']:h.heat_size===3?['ROUGE','BLANC','JAUNE']:h.heat_size===4?['ROUGE','BLANC','JAUNE','BLEU']:['ROUGE','BLANC','JAUNE','BLEU','VERT']}));
    const payload = { event_id: eventId, category, participants: rewrite(c.participants).map(p=>({...p,event_id:eventId,category})), heats: rewrite(heats), mappings: rewrite(c.mappings), heat_configs: rewrite(heats.map((h) => ({ heat_id: h.id, judges: ['J1','J2','J3'], surfers: h.color_order, judge_names: {}, waves: 15, tournament_type: 'elimination' }))), policy: c.policy };
    const all = JSON.stringify(payload);
    if (all.includes('10001') || all.includes('10002') || !all.includes(String(eventId))) throw new Error(`event scope assertion failed: ${category}`);
    return payload;
  });
}

if (process.argv[1]?.endsWith('p38-category-dispatcher.mjs') && process.argv[2]) {
  const fs = await import('node:fs');
  const artifact = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const calls = buildCategoryCalls(artifact, Number(process.argv[3] ?? 10003));
  fs.writeFileSync('/tmp/p38-category-calls-10003.json', JSON.stringify(calls, null, 2));
  console.log(JSON.stringify(calls.map(c => ({category:c.category,participants:c.participants.length,heats:c.heats.length,mappings:c.mappings.length}))));
}
