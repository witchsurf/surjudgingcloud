import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { EventRecord, PaymentRecord, PaymentProvider } from '../types';

export interface NewEventInput {
  name: string;
  organizer: string;
  start_date: string;
  end_date: string;
  price: number;
  currency: string;
  categories: string[];
  judges: string[];
}

export interface PaymentInitiationRequest {
  eventId: number;
  provider: PaymentProvider;
  amount: number;
  currency: string;
  phoneNumber?: string;
  email?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentInitiationResponse {
  paymentId: number;
  provider: PaymentProvider;
  status: 'pending' | 'success' | 'failed';
  checkoutUrl?: string;
  instructions?: string;
  transactionRef?: string | null;
}

export interface PaymentConfirmationRequest {
  paymentId: number;
  provider: PaymentProvider;
  sessionId?: string;
  transactionRef?: string;
  status?: 'success' | 'failed' | 'pending';
}

export const requireSupabase = () => {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Supabase est mal configuré. Vérifiez les variables VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY.');
  }
};

export async function fetchOrganizerEvents(userId: string) {
  requireSupabase();

  const { data: eventsData, error: eventsError } = await supabase!
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (eventsError) {
    throw new Error(eventsError.message);
  }

  const eventIds = (eventsData ?? []).map((event) => Number(event.id));

  let paymentsByEvent: Record<number, PaymentRecord[]> = {};
  if (eventIds.length > 0) {
    const { data: paymentsData, error: paymentsError } = await supabase!
      .from('payments')
      .select('*')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false });

    if (paymentsError) {
      throw new Error(paymentsError.message);
    }

    paymentsByEvent = (paymentsData ?? []).reduce<Record<number, PaymentRecord[]>>((acc, payment) => {
      const eventId = payment.event_id ? Number(payment.event_id) : 0;
      if (!acc[eventId]) {
        acc[eventId] = [];
      }
      acc[eventId].push({
        ...payment,
        id: Number(payment.id),
        event_id: payment.event_id ? Number(payment.event_id) : null,
        amount: Number(payment.amount),
      });
      return acc;
    }, {});
  }

  const events: (EventRecord & { payments: PaymentRecord[] })[] = (eventsData ?? []).map((event) => ({
    ...(event as unknown as EventRecord),
    id: Number(event.id),
    price: Number(event.price),
    categories: Array.isArray(event.categories) ? event.categories : [],
    judges: Array.isArray(event.judges) ? event.judges : [],
    payments: paymentsByEvent[Number(event.id)] ?? [],
  }));

  return events;
}

export async function createEventRecord(userId: string, payload: NewEventInput) {
  requireSupabase();

  const insertPayload = {
    name: payload.name,
    organizer: payload.organizer,
    start_date: payload.start_date,
    end_date: payload.end_date,
    price: payload.price,
    currency: payload.currency,
    categories: payload.categories,
    judges: payload.judges,
    method: null,
    status: 'pending',
    paid: false,
    user_id: userId,
  };

  const { data, error } = await supabase!
    .from('events')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Impossible de créer l’événement');
  }

  return {
    ...(data as unknown as EventRecord),
    id: Number(data.id),
    price: Number(data.price),
    categories: Array.isArray(data.categories) ? data.categories : [],
    judges: Array.isArray(data.judges) ? data.judges : [],
  };
}

export async function initiatePayment(request: PaymentInitiationRequest): Promise<PaymentInitiationResponse> {
  requireSupabase();

  const { data, error } = await supabase!.functions.invoke('payments', {
    body: {
      action: 'initiate',
      eventId: request.eventId,
      provider: request.provider,
      amount: request.amount,
      currency: request.currency,
      phoneNumber: request.phoneNumber,
      email: request.email,
      successUrl: request.successUrl,
      cancelUrl: request.cancelUrl,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as PaymentInitiationResponse;
}

export async function confirmPayment(request: PaymentConfirmationRequest) {
  requireSupabase();

  const { data, error } = await supabase!.functions.invoke('payments', {
    body: {
      action: 'confirm',
      provider: request.provider,
      paymentId: request.paymentId,
      sessionId: request.sessionId,
      transactionRef: request.transactionRef,
      status: request.status,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as { status: 'success' | 'pending' | 'failed'; event?: EventRecord };
}
