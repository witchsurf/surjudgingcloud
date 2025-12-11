// Supabase Edge Function - Stripe Webhook Handler
// Handles Stripe payment confirmations and triggers n8n workflows

// @ts-ignore
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// @ts-ignore
import Stripe from 'https://esm.sh/stripe@14.0.0'
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Initialize Stripe
// @ts-ignore
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
})

// Initialize Supabase client
// @ts-ignore
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
// @ts-ignore
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
)

// @ts-ignore
serve(async (req: Request) => {
    try {
        const signature = req.headers.get('stripe-signature')

        if (!signature) {
            return new Response('Missing signature', { status: 400 })
        }

        // @ts-ignore
        const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
        console.log(`Debug: Using secret starting with ${STRIPE_WEBHOOK_SECRET.substring(0, 8)}...`)

        // Get raw body for signature verification
        const body = await req.text()

        // Verify webhook signature
        let event: Stripe.Event
        try {
            event = await stripe.webhooks.constructEventAsync(
                body,
                signature,
                STRIPE_WEBHOOK_SECRET
            )
        } catch (err) {
            console.error('Webhook signature verification failed:', err)
            return new Response(`Webhook Error: ${(err as any).message}`, { status: 400 })
        }

        console.log(`Received event: ${event.type}`)

        // Handle checkout.session.completed
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object as Stripe.Checkout.Session

            console.log('Processing checkout session:', session.id)

            // Update payment status in database
            const { data: payment, error: paymentError } = await supabase
                .from('payments')
                .update({
                    status: 'completed',
                    paid_at: new Date().toISOString(),
                })
                .eq('transaction_ref', session.id)
                .select()
                .maybeSingle()

            if (paymentError) {
                console.error('Error updating payment:', paymentError)
                throw paymentError
            }

            if (!payment) {
                console.log(`Payment not found for session ID: ${session.id}`)
                return new Response('Payment not found', { status: 200 })
            }

            // @ts-ignore
            console.log('Payment processed:', payment.id);

            // Update event status
            if (payment?.event_id) {
                const { error: eventError } = await supabase
                    .from('events')
                    .update({
                        paid: true,
                        status: 'active',
                    })
                    .eq('id', payment.event_id)

                if (eventError) {
                    console.error('Error updating event:', eventError)
                    // Don't throw - payment is already confirmed
                }
            }

            // Trigger n8n workflow for post-payment actions (email, notifications, etc.)
            // @ts-ignore
            const N8N_WEBHOOK_URL = Deno.env.get('N8N_PAYMENT_CONFIRMED_WEBHOOK') ?? '';
            if (N8N_WEBHOOK_URL) {
                try {
                    // @ts-ignore
                    const N8N_API_KEY = Deno.env.get('N8N_API_KEY') ?? '';
                    await fetch(N8N_WEBHOOK_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-api-key': N8N_API_KEY,
                        },
                        body: JSON.stringify({
                            event_type: 'payment_confirmed',
                            session_id: session.id,
                            event_id: payment?.event_id,
                            amount: session.amount_total,
                            currency: session.currency,
                            customer_email: session.customer_details?.email,
                        }),
                    })
                    console.log('n8n workflow triggered successfully')
                } catch (error) {
                    // @ts-ignore
                    console.error('Error triggering n8n workflow:', error);
                    // Don't throw - payment is already confirmed
                }
            }
        }

        // Handle payment_intent.succeeded
        if (event.type === 'payment_intent.succeeded') {
            const paymentIntent = event.data.object as Stripe.PaymentIntent
            console.log('Payment intent succeeded:', paymentIntent.id)

            // Additional handling if needed
        }

        // Handle payment_intent.payment_failed
        if (event.type === 'payment_intent.payment_failed') {
            const paymentIntent = event.data.object as Stripe.PaymentIntent
            console.log('Payment intent failed:', paymentIntent.id)

            // Update payment status to failed
            await supabase
                .from('payments')
                .update({
                    status: 'failed',
                })
                .eq('transaction_ref', paymentIntent.id)
        }

        // Return success response
        return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })

    } catch (error) {
        console.error('Error processing webhook:', error)
        return new Response(
            JSON.stringify({ error: (error as any).message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
    }
})
