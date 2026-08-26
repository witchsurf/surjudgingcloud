#!/usr/bin/env node

// Disposable chaos helper: forwards one signed request to the real relay, then
// deliberately drops the client connection before its ACK can be received.
import http from 'node:http';

const target = process.env.LIVE_RELAY_URL;
const port = Number(process.env.LIVE_ACK_LOSS_PROXY_PORT || 18590);
if (!target) throw new Error('LIVE_RELAY_URL is required');

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  try {
    await fetch(target, { method: request.method, headers: request.headers, body });
    // The relay has completed, but the Field sees a lost response.
    response.socket?.destroy();
  } finally {
    server.close();
  }
});

server.listen(port, '127.0.0.1', () => console.log(`ACK-loss proxy listening on ${port}`));
