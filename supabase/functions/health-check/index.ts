/**
 * Health Check Edge Function
 * 
 * Monitors the health of all system dependencies:
 * - Database connectivity
 * - Realtime service
 * - N8N automation service
 * - Stripe payment service
 * 
 * Returns:
 * - 200 OK if all checks pass
 * - 503 Service Unavailable if any check fails
 * 
 * Usage:
 *   curl https://xwaymumbkmwxqifihuvn.supabase.co/functions/v1/health-check
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface HealthCheck {
    status: 'ok' | 'error';
    latency?: string;
    error?: string;
}

interface HealthResponse {
    status: 'healthy' | 'degraded';
    checks: {
        database: HealthCheck;
        realtime: HealthCheck;
        n8n: HealthCheck;
        stripe: HealthCheck;
    };
    timestamp: string;
}

// Check database connectivity
async function checkDatabase(supabase: any): Promise<HealthCheck> {
    const start = Date.now();

    try {
        const { data, error } = await supabase
            .from('events')
            .select('id')
            .limit(1);

        if (error) {
            return { status: 'error', error: error.message };
        }

        const latency = Date.now() - start;
        return {
            status: 'ok',
            latency: `${latency}ms`
        };
    } catch (err) {
        return {
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown database error'
        };
    }
}

// Check Realtime service
async function checkRealtime(supabase: any): Promise<HealthCheck> {
    try {
        // Try to get realtime connection info
        // This is a basic check - just verify the client is initialized
        if (supabase.realtime) {
            return { status: 'ok' };
        } else {
            return { status: 'error', error: 'Realtime not available' };
        }
    } catch (err) {
        return {
            status: 'error',
            error: err instanceof Error ? err.message : 'Unknown realtime error'
        };
    }
}

// Check N8N automation service
async function checkN8N(): Promise<HealthCheck> {
    const start = Date.now();

    try {
        const n8nUrl = Deno.env.get('N8N_URL') || 'https://automation.surfjudging.cloud';

        const response = await fetch(n8nUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(5000), // 5 second timeout
        });

        const latency = Date.now() - start;

        if (response.ok || response.status === 404) {
            // 404 is ok - means n8n is responding, just no route at root
            return {
                status: 'ok',
                latency: `${latency}ms`
            };
        } else {
            return {
                status: 'error',
                error: `HTTP ${response.status}`
            };
        }
    } catch (err) {
        return {
            status: 'error',
            error: err instanceof Error ? err.message : 'N8N unreachable'
        };
    }
}

// Check Stripe service
async function checkStripe(): Promise<HealthCheck> {
    try {
        const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');

        if (!stripeKey) {
            return { status: 'error', error: 'Stripe key not configured' };
        }

        const start = Date.now();

        // Simple API call to verify connectivity (list balance transactions with limit 1)
        const response = await fetch('https://api.stripe.com/v1/balance', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${stripeKey}`,
            },
            signal: AbortSignal.timeout(5000), // 5 second timeout
        });

        const latency = Date.now() - start;

        if (response.ok) {
            return {
                status: 'ok',
                latency: `${latency}ms`
            };
        } else {
            return {
                status: 'error',
                error: `HTTP ${response.status}`
            };
        }
    } catch (err) {
        return {
            status: 'error',
            error: err instanceof Error ? err.message : 'Stripe unreachable'
        };
    }
}

Deno.serve(async (req: Request) => {
    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Run all health checks in parallel
        const [database, realtime, n8n, stripe] = await Promise.all([
            checkDatabase(supabase),
            checkRealtime(supabase),
            checkN8N(),
            checkStripe(),
        ]);

        const checks = { database, realtime, n8n, stripe };

        // Determine overall health status
        const allHealthy = Object.values(checks).every(check => check.status === 'ok');

        const response: HealthResponse = {
            status: allHealthy ? 'healthy' : 'degraded',
            checks,
            timestamp: new Date().toISOString(),
        };

        return new Response(
            JSON.stringify(response, null, 2),
            {
                status: allHealthy ? 200 : 503,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                },
            }
        );
    } catch (error) {
        console.error('Health check error:', error);

        return new Response(
            JSON.stringify({
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            }),
            {
                status: 500,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                },
            }
        );
    }
});
