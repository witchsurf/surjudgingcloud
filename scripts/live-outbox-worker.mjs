#!/usr/bin/env node

/*
 * Disabled-by-default Field -> relay transport. It deliberately has no Cloud
 * credentials: Field remains the sole author of competition data.
 */
import crypto from 'node:crypto';

const required = ['LIVE_FIELD_LOCAL_URL', 'LIVE_FIELD_SERVICE_ROLE_KEY', 'LIVE_RELAY_URL', 'LIVE_FIELD_INSTANCE_ID', 'LIVE_FIELD_HMAC_SECRET'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment: ${missing.join(', ')}`);
  process.exit(1);
}

const workerId = `${process.env.LIVE_FIELD_INSTANCE_ID}:${process.pid}`;
const rpc = async (name, body) => {
  const response = await fetch(`${process.env.LIVE_FIELD_LOCAL_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: process.env.LIVE_FIELD_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.LIVE_FIELD_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Local RPC ${name} HTTP ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};
const once = process.argv.includes('--once');
const pollMs = Math.max(1_000, Number(process.env.LIVE_OUTBOX_POLL_MS || 2_000));

const delayFor = (attempts) => Math.min(3_600, Math.max(2, 2 ** Math.min(attempts, 10)) + Math.floor(Math.random() * 3));

function sign(body, sentAt) {
  return crypto.createHmac('sha256', process.env.LIVE_FIELD_HMAC_SECRET)
    .update(`${sentAt}.${body}`)
    .digest('hex');
}

async function runOnce() {
  // Heartbeat before each claim. This is deliberately local-only: a loss of
  // Internet is visible as backlog/error, never as a judgement failure.
  await rpc('heartbeat_live_outbox_worker', {
    p_worker_id: workerId,
    p_field_instance_id: process.env.LIVE_FIELD_INSTANCE_ID,
  });
  const rows = await rpc('claim_live_outbox', { p_worker_id: workerId, p_limit: 50 });
  if (!rows?.length) return 0;
  if (rows.some((row) => row.field_instance_id !== process.env.LIVE_FIELD_INSTANCE_ID)) {
    await rpc('fail_live_outbox', {
      p_worker_id: workerId,
      p_field_instance_id: process.env.LIVE_FIELD_INSTANCE_ID,
      p_ids: rows.map((row) => row.id),
      p_error: 'Field identity is not provisioned or does not match the worker',
      p_retry_after_seconds: 300,
    });
    throw new Error('Field identity is not provisioned or does not match the worker');
  }

  const body = JSON.stringify({
    field_instance_id: process.env.LIVE_FIELD_INSTANCE_ID,
    events: rows.map(({ id, event_id, sequence, aggregate_type, aggregate_id, event_type, schema_version, occurred_at, payload }) =>
      ({ id, event_id, sequence, aggregate_type, aggregate_id, event_type, schema_version, occurred_at, payload })),
  });
  const sentAt = new Date().toISOString();

  try {
    const response = await fetch(process.env.LIVE_RELAY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-live-field-id': process.env.LIVE_FIELD_INSTANCE_ID,
        'x-live-sent-at': sentAt,
        'x-live-signature': sign(body, sentAt),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Relay HTTP ${response.status}`);
    const ack = await response.json();
    const expectedIds = rows.map((row) => row.id).sort();
    const receivedIds = Array.isArray(ack.acknowledged_ids) ? [...ack.acknowledged_ids].sort() : [];
    if (JSON.stringify(expectedIds) !== JSON.stringify(receivedIds)) throw new Error('Relay acknowledgement is not a complete batch ACK');
    const lastSequence = Math.max(...rows.map((row) => Number(row.sequence)));
    await rpc('ack_live_outbox', { p_worker_id: workerId, p_field_instance_id: process.env.LIVE_FIELD_INSTANCE_ID, p_ids: expectedIds, p_last_sequence: lastSequence });
    console.log(`LIVE ACK ${rows.length} event(s), sequence ${lastSequence}`);
    return rows.length;
  } catch (error) {
    const retrySeconds = delayFor(Math.max(...rows.map((row) => Number(row.attempts || 1))));
    await rpc('fail_live_outbox', {
      p_worker_id: workerId, p_field_instance_id: process.env.LIVE_FIELD_INSTANCE_ID, p_ids: rows.map((row) => row.id), p_error: error instanceof Error ? error.message : String(error), p_retry_after_seconds: retrySeconds,
    });
    console.warn(`LIVE retry in ${retrySeconds}s: ${error instanceof Error ? error.message : String(error)}`);
    // A supervisor/manual diagnostic must distinguish a successful empty poll
    // from a delivery that was safely retained for retry.
    if (once) process.exitCode = 2;
    return 0;
  }
}

do {
  await runOnce();
  if (!once) await new Promise((resolve) => setTimeout(resolve, pollMs));
} while (!once);
