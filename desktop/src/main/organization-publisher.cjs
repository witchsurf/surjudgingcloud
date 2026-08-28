const fs = require('node:fs/promises');
const path = require('node:path');

function readEnvValue(text, key) {
  const line = String(text).split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}

function makeOrganizationPublisher({ stateDir, discover, fetchImpl = fetch, timeoutMs = 10000 }) {
  return Object.freeze({
    async publish(profile) {
      if (!profile?.configured) return { status:'NOT_CONFIGURED' };
      const candidates = await discover();
      if (candidates.length !== 1) return { status:'PENDING', reason:'FIELD_RUNTIME_NOT_UNIQUE' };
      const envText = await fs.readFile(path.join(stateDir, 'compose', '.env'), 'utf8');
      const anonKey = readEnvValue(envText, 'ANON_KEY');
      if (!anonKey) return { status:'PENDING', reason:'FIELD_ANON_KEY_UNAVAILABLE' };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          `http://${candidates[0].host}:8000/rest/v1/rpc/upsert_field_organization_profile`,
          {
            method:'POST',
            headers:{
              apikey:anonKey,
              Authorization:`Bearer ${anonKey}`,
              'Content-Type':'application/json',
            },
            body:JSON.stringify({
              p_organization_name:profile.organizationName,
              p_logo_data_url:profile.logoDataUrl,
            }),
            signal:controller.signal,
          }
        );
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 240);
          return { status:'PENDING', reason:`FIELD_PROFILE_HTTP_${response.status}`, detail };
        }
        return { status:'SYNCED', host:candidates[0].host, syncedAt:new Date().toISOString() };
      } catch (error) {
        return { status:'PENDING', reason:error?.name === 'AbortError' ? 'FIELD_PROFILE_TIMEOUT' : 'FIELD_PROFILE_UNREACHABLE' };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

module.exports = { readEnvValue, makeOrganizationPublisher };
