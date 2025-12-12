// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// @ts-ignore
const N8N_WEBHOOK_URL = Deno.env.get('N8N_PAYMENT_INIT_WEBHOOK') || 'https://automation.surfjudging.cloud/webhook/payment_init'
// @ts-ignore
const N8N_API_KEY = Deno.env.get('N8N_API_KEY')

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { action, ...payload } = await req.json()

        // Normalize and enforce eventId before forwarding to n8n
        const eventId =
            payload.eventId ??
            payload.event_id ??
            payload.eventid ??
            payload.event ??
            null

        if (!eventId) {
            return new Response(JSON.stringify({ error: 'Missing eventId' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        payload.eventId = Number(eventId)

        if (action === 'initiate') {
            console.log('Initiating payment via n8n:', payload)

            // Call n8n webhook
            const response = await fetch(N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-api-key': N8N_API_KEY || '',
                },
                body: JSON.stringify(payload),
            })

            if (!response.ok) {
                const errorText = await response.text()
                console.error('n8n error:', errorText)
                throw new Error(`n8n returned ${response.status}: ${errorText}`)
            }

            const data = await response.json()
            console.log('n8n response:', data)

            // Return the response to the frontend
            return new Response(JSON.stringify(data), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        return new Response(JSON.stringify({ error: 'Unknown action' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })

    } catch (error: any) {
        console.error('Error:', error)
        return new Response(JSON.stringify({ error: error.message || 'Unknown error' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
