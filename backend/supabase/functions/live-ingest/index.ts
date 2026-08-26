import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
const constantTimeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
};
async function hmac(secret: string, input: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
}
async function sha256(input: unknown) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input))));
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const fieldId = request.headers.get('x-live-field-id')?.trim() || '';
  const sentAt = request.headers.get('x-live-sent-at') || '';
  const signature = request.headers.get('x-live-signature') || '';
  const secret = Deno.env.get('LIVE_INGEST_HMAC_SECRET') || '';
  const allowed = new Set((Deno.env.get('LIVE_ALLOWED_FIELD_IDS') || '').split(',').map((value) => value.trim()).filter(Boolean));
  if (!fieldId || !sentAt || !signature || !secret || !allowed.has(fieldId)) return json({ error: 'unauthorized' }, 401);
  const sentMs = Date.parse(sentAt);
  if (!Number.isFinite(sentMs) || Math.abs(Date.now() - sentMs) > 5 * 60_000) return json({ error: 'stale_request' }, 401);
  const rawBody = await request.text();
  if (!constantTimeEqual(signature, await hmac(secret, `${sentAt}.${rawBody}`))) return json({ error: 'invalid_signature' }, 401);

  let envelope: { field_instance_id?: string; events?: Array<Record<string, unknown>> };
  try { envelope = JSON.parse(rawBody); } catch { return json({ error: 'invalid_json' }, 400); }
  if (envelope.field_instance_id !== fieldId || !Array.isArray(envelope.events) || envelope.events.length < 1 || envelope.events.length > 50) return json({ error: 'invalid_envelope' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } });
  const { data: cursor, error: cursorError } = await admin.from('live_ingest_cursor').select('last_sequence').eq('field_instance_id', fieldId).maybeSingle();
  if (cursorError) return json({ error: 'cursor_read_failed' }, 500);
  let expected = Number(cursor?.last_sequence || 0) + 1;
  const acknowledged: string[] = [];

  for (const event of envelope.events) {
    const id = typeof event.id === 'string' ? event.id : '';
    const sequence = Number(event.sequence);
    const eventId = Number(event.event_id);
    if (!id || !Number.isSafeInteger(sequence) || !Number.isSafeInteger(eventId)) return json({ error: 'invalid_event' }, 400);
    const digest = await sha256(event);
    const { data: existing, error: existingError } = await admin.from('live_ingest_events').select('payload_sha256').eq('field_instance_id', fieldId).eq('outbox_id', id).maybeSingle();
    if (existingError) return json({ error: 'receipt_read_failed' }, 500);
    if (existing) {
      if (existing.payload_sha256 !== digest) return json({ error: 'idempotency_conflict' }, 409);
      // An ACK can be lost after the relay commit. The exact same Field fact
      // is valid even though its sequence is now behind the Cloud cursor.
      if (sequence >= expected) return json({ error: 'sequence_gap', expected, received: sequence }, 409);
    } else {
      if (sequence !== expected) return json({ error: 'sequence_gap', expected, received: sequence }, 409);
      const row = { field_instance_id: fieldId, outbox_id: id, sequence, event_id: eventId, aggregate_type: event.aggregate_type, aggregate_id: event.aggregate_id, event_type: event.event_type, schema_version: event.schema_version, occurred_at: event.occurred_at, payload: event.payload, payload_sha256: digest };
      const { error } = await admin.from('live_ingest_events').insert(row);
      if (error) return json({ error: 'receipt_write_failed' }, 500);
    }
    // Safe to repeat: this repairs a crash between durable receipt and projection.
    const { error: projectionError } = await admin.from('live_public_projection').upsert({ field_instance_id: fieldId, event_id: eventId, aggregate_type: event.aggregate_type, aggregate_id: event.aggregate_id, sequence, event_type: event.event_type, occurred_at: event.occurred_at, payload: event.payload }, { onConflict: 'field_instance_id,event_id,aggregate_type,aggregate_id' });
    if (projectionError) return json({ error: 'projection_write_failed' }, 500);
    acknowledged.push(id);
    if (!existing) expected += 1;
  }
  const { error: cursorWriteError } = await admin.from('live_ingest_cursor').upsert({ field_instance_id: fieldId, last_sequence: expected - 1, updated_at: new Date().toISOString() });
  if (cursorWriteError) return json({ error: 'cursor_write_failed' }, 500);
  return json({ acknowledged_ids: acknowledged, highest_contiguous_sequence: expected - 1 });
});
