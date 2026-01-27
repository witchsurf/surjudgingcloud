import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
};

interface KioskBootstrapRequest {
    eventId: number;
    heat_id: string;
}

interface KioskConfig {
    heat_id: string;
    event_id: number;
    judges: any[];
    surfers: any[];
    timer: {
        isRunning: boolean;
        startTime: string | null;
        duration: number;
    };
    config: any;
    status: string;
}

serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Parse request body
        const { eventId, heat_id }: KioskBootstrapRequest = await req.json();

        // Validate input
        if (!eventId || !heat_id) {
            return new Response(
                JSON.stringify({
                    error: "Missing required fields: eventId and heat_id",
                }),
                {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                }
            );
        }

        console.log(`🎯 Kiosk bootstrap request for event ${eventId}, heat ${heat_id}`);

        // Get N8N webhook URL and API key from environment
        const n8nWebhookUrl = Deno.env.get("N8N_KIOSK_BOOTSTRAP_URL") ||
            `${Deno.env.get("WEBHOOK_URL")}/webhook/kiosk/bootstrap`;
        const n8nApiKey = Deno.env.get("PAYMENT_API_KEY");

        if (!n8nWebhookUrl) {
            throw new Error("N8N webhook URL not configured");
        }

        // Call N8N workflow
        const n8nResponse = await fetch(n8nWebhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": n8nApiKey || "",
            },
            body: JSON.stringify({
                eventId,
                heat_id,
            }),
        });

        if (!n8nResponse.ok) {
            const errorText = await n8nResponse.text();
            console.error("❌ N8N workflow error:", errorText);
            throw new Error(`N8N workflow failed: ${n8nResponse.status} - ${errorText}`);
        }

        const kioskConfig: KioskConfig = await n8nResponse.json();

        console.log("✅ Kiosk configuration retrieved successfully");

        // Return the configuration
        return new Response(JSON.stringify(kioskConfig), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("❌ Error in kiosk-bootstrap:", error);

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
