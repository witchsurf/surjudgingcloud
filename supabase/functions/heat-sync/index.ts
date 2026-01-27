import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

interface HeatSyncRequest {
    heat_id: string;
    status?: "waiting" | "running" | "paused" | "finished";
    timer_start_time?: string;
    timer_duration_minutes?: number;
    config_data?: any;
}

serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Parse request body
        const payload: HeatSyncRequest = await req.json();

        // Validate input
        if (!payload.heat_id) {
            return new Response(
                JSON.stringify({
                    error: "Missing required field: heat_id",
                }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        console.log(`🔄 Heat sync request for heat ${payload.heat_id}`);

        // Get N8N webhook URL and secret from environment
        const n8nWebhookUrl = Deno.env.get("N8N_HEAT_SYNC_URL") ||
            `${Deno.env.get("WEBHOOK_URL")}/webhook/heat/sync`;
        const heatSyncSecret = Deno.env.get("HEAT_SYNC_SECRET");

        if (!n8nWebhookUrl) {
            throw new Error("N8N webhook URL not configured");
        }

        if (!heatSyncSecret) {
            console.warn("⚠️ HEAT_SYNC_SECRET not configured - webhook may fail");
        }

        // Call N8N workflow
        const n8nResponse = await fetch(n8nWebhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-heat-sync-secret": heatSyncSecret || "",
            },
            body: JSON.stringify(payload),
        });

        if (!n8nResponse.ok) {
            const errorText = await n8nResponse.text();
            console.error("❌ N8N heat sync error:", errorText);
            throw new Error(`N8N workflow failed: ${n8nResponse.status} - ${errorText}`);
        }

        const result = await n8nResponse.json();

        console.log("✅ Heat sync completed successfully");

        // Return the result
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("❌ Error in heat-sync:", error);

        return new Response(
            JSON.stringify({
                error: error.message || "Internal server error",
            }),
            {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
        );
    }
});
