# Field Live Outbox Worker (foundation)

This worker is intentionally **not enabled by the Field menus or installer**.
It is the safe transport companion for `live_outbox`: it only reads the local
Field database and sends signed, ordered batches to a future relay endpoint.

Required environment values are provisioned outside the frontend bundle:

- `LIVE_FIELD_LOCAL_URL`
- `LIVE_FIELD_SERVICE_ROLE_KEY`
- `LIVE_RELAY_URL`
- `LIVE_FIELD_INSTANCE_ID`
- `LIVE_FIELD_HMAC_SECRET`

Before the worker is enabled, a provisioning operation must set the one row in
`live_field_identity` to the assigned immutable Field ID. The worker refuses
the default `unprovisioned` identity, and future outbox records use this value.

It must run as one supervised local service. Cloud credentials are never used.
The relay must acknowledge the highest contiguous accepted sequence; a timeout
is treated as an unknown delivery and the same events are retried.

No production invocation is supplied until the relay ingestion contract exists.

## Operator status in Admin

The local Admin header now reads only the Field database diagnostic every five
seconds. It never reads a secret and does not contact Cloud.

- **LIVE**: supervised worker heartbeat is recent and the durable outbox is empty.
- **BACKLOG**: Field writes continue normally; one or more publications are retained
  locally for retry.
- **DEGRADED**: the queue is currently empty, but a recent relay error remains visible.
- **OFFLINE**: no recent worker heartbeat was observed (the worker may be stopped).
- **Publication Internet non configurée**: the Field identity has not been provisioned.

The heartbeat is local bookkeeping only. It is emitted before each worker poll
and cannot make a score, timer, or heat transition depend on Internet access.
