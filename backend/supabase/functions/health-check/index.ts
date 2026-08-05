import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

type CheckStatus = 'ok' | 'error' | 'absent' | 'skipped';
interface HealthCheck { status: CheckStatus; required: boolean; latency?: string; error?: string; }

const localHost = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return true;
    const p = host.split('.').map(Number);
    return p.length === 4 && (p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31));
  } catch { return false; }
};

async function timedFetch(url: string, required: boolean): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1800) });
    return response.ok || response.status === 404
      ? { status: 'ok', required, latency: `${Date.now() - start}ms` }
      : { status: 'error', required, error: `HTTP ${response.status}` };
  } catch (error) {
    return { status: required ? 'error' : 'absent', required, error: error instanceof Error ? error.message : 'Inaccessible' };
  }
}

async function checkDatabase(supabase: ReturnType<typeof createClient>): Promise<HealthCheck> {
  const start = Date.now();
  const { error } = await supabase.from('events').select('id').limit(1);
  return error
    ? { status: 'error', required: true, error: error.message }
    : { status: 'ok', required: true, latency: `${Date.now() - start}ms` };
}

async function checkRealtime(supabase: ReturnType<typeof createClient>): Promise<HealthCheck> {
  const channel = supabase.channel(`health-${crypto.randomUUID()}`);
  try {
    const status = await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve('TIMED_OUT'), 2500);
      channel.subscribe((next) => {
        if (next === 'SUBSCRIBED' || next === 'CHANNEL_ERROR' || next === 'TIMED_OUT' || next === 'CLOSED') {
          clearTimeout(timeout);
          resolve(next);
        }
      });
    });
    return status === 'SUBSCRIBED'
      ? { status: 'ok', required: true }
      : { status: 'error', required: true, error: status };
  } finally {
    await supabase.removeChannel(channel);
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const fieldMode = (Deno.env.get('FIELD_MODE') ?? '').toLowerCase() === 'true' || localHost(supabaseUrl);
    const supabase = createClient(supabaseUrl, supabaseKey);
    const [database, realtime] = await Promise.all([checkDatabase(supabase), checkRealtime(supabase)]);

    const frontendUrl = Deno.env.get('FRONTEND_HEALTH_URL');
    const esp32Url = Deno.env.get('ESP32_HEALTH_URL') || 'http://priority.local';
    const frontend = frontendUrl && (!fieldMode || localHost(frontendUrl))
      ? await timedFetch(frontendUrl, true)
      : { status: 'skipped', required: false, error: frontendUrl ? 'URL non locale refusée en mode terrain' : 'FRONTEND_HEALTH_URL non configurée' } as HealthCheck;
    const esp32 = fieldMode
      ? await timedFetch(esp32Url, false)
      : { status: 'skipped', required: false } as HealthCheck;

    // In field mode these checks are intentionally not executed: the health
    // endpoint must remain useful with no Internet connection.
    const cloud = fieldMode
      ? { status: 'skipped', required: false, error: 'désactivé en mode terrain' } as HealthCheck
      : { status: 'skipped', required: false, error: 'hors périmètre du diagnostic terrain' } as HealthCheck;
    const checks = { frontend, database, realtime, esp32, n8n: cloud, stripe: cloud };
    const healthy = Object.values(checks).every((check) => !check.required || check.status === 'ok');

    return new Response(JSON.stringify({
      status: healthy ? 'healthy' : 'degraded',
      mode: fieldMode ? 'field' : 'cloud',
      scoringAvailable: database.status === 'ok',
      checks,
      timestamp: new Date().toISOString(),
    }, null, 2), {
      status: healthy ? 200 : 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
