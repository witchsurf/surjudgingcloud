import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });
  if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405);
  const url = new URL(request.url);
  const fieldId = url.searchParams.get('field_id')?.trim() || '';
  const podiumId = url.searchParams.get('podium')?.trim() || 'A';
  const expectedToken = Deno.env.get('LIVE_OVERLAY_ACCESS_TOKEN') || '';
  if (!fieldId || !expectedToken || url.searchParams.get('token') !== expectedToken) return reply({ error: 'unauthorized' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } });
  const { data: projections, error } = await admin.from('live_public_projection').select('event_id,aggregate_type,aggregate_id,sequence,event_type,occurred_at,payload,updated_at').eq('field_instance_id', fieldId);
  if (error) return reply({ error: 'projection_read_failed' }, 500);
  const all = projections || [];
  const pointer = all.find((row) => { const p = row.payload as Record<string, any>; return row.aggregate_type === 'event' && String(p.active_heat_pointer?.podium_id || 'A') === podiumId; });
  const activeHeatId = String((pointer?.payload as Record<string, any>)?.active_heat_pointer?.active_heat_id || '');
  if (!activeHeatId) return reply({ version:1, field_id:fieldId, podium_id:podiumId, active_heat_id:null, generated_at:new Date().toISOString() });
  const heat = all.find((row) => row.aggregate_type === 'heat' && row.aggregate_id === activeHeatId);
  const payload = (heat?.payload || {}) as Record<string, any>;
  const scores = all.filter((row) => row.aggregate_type === 'score' && String((row.payload as Record<string, any>).score?.heat_id || '') === activeHeatId).map((row) => (row.payload as Record<string, any>).score);
  const interference_calls = all.filter((row) => row.aggregate_type === 'interference' && String((row.payload as Record<string, any>).interference_call?.heat_id || '') === activeHeatId && !(row.payload as Record<string, any>).deleted).map((row) => (row.payload as Record<string, any>).interference_call);
  return reply({ version:1, field_id:fieldId, podium_id:podiumId, active_heat_id:activeHeatId, sequence:heat?.sequence || pointer?.sequence || 0, heat:payload.heat || null, heat_config:payload.heat_config || null, heat_realtime_config:payload.heat_realtime_config || null, entries:payload.entries || [], scores, interference_calls, generated_at:new Date().toISOString() });
});
