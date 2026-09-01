import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type {
  CreateEventRequest,
  CreatedEventRecord,
  EventTestActivationRecord,
} from '../../repositories/contracts';

type CreatedEventRpcRow = {
  id: number | string;
  name: string;
  organizer: string;
  start_date: string;
  end_date: string;
  price: number;
  currency: string;
  method: string | null;
  status: string;
  paid: boolean;
  paid_at: string | null;
  payment_ref: string | null;
  categories: unknown[];
  judges: unknown[];
  user_id: string | null;
  created_at: string;
};

const mapCreatedEvent = (row: CreatedEventRpcRow): CreatedEventRecord => ({
  id: Number(row.id),
  name: row.name,
  organizer: row.organizer,
  startDate: row.start_date,
  endDate: row.end_date,
  price: Number(row.price),
  currency: row.currency,
  method: row.method,
  status: row.status,
  paid: row.paid,
  paidAt: row.paid_at,
  paymentRef: row.payment_ref,
  categories: Array.isArray(row.categories) ? row.categories : [],
  judges: Array.isArray(row.judges) ? row.judges : [],
  userId: row.user_id,
  createdAt: row.created_at,
});

export async function createEventSecure(request: CreateEventRequest): Promise<CreatedEventRecord> {
  if (!supabase || !isSupabaseConfigured()) throw new Error('Supabase est indisponible.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.startDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(request.endDate)) {
    throw new Error('Les dates de début et de fin sont requises.');
  }
  if (request.endDate < request.startDate) {
    throw new Error('La date de fin doit être postérieure ou égale à la date de début.');
  }
  const rpcBody = {
    p_name: request.name,
    p_organizer: request.organizer,
    p_start_date: request.startDate,
    p_end_date: request.endDate,
    p_price: request.price,
    p_currency: request.currency,
    p_categories: [...request.categories],
    p_judges: [...request.judges],
    ...(request.idempotencyKey ? { p_idempotency_key: request.idempotencyKey } : {}),
  };
  let data;
  let error;
  try {
    ({ data, error } = await supabase.rpc('create_event_secure', rpcBody));
  } catch (caught) {
    throw caught;
  }
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("La création n’a retourné aucun événement.");
  const created = mapCreatedEvent(row as CreatedEventRpcRow);
  if (!Number.isSafeInteger(created.id) || created.id <= 0) {
    throw new Error("La base n’a pas retourné d’ID d’événement canonique.");
  }
  return created;
}

export async function canActivateEventForTest(eventId: number): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured()) return false;
  const { data, error } = await supabase.rpc('get_event_test_activation_capability', {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function activateEventForTest(eventId: number): Promise<EventTestActivationRecord> {
  if (!supabase || !isSupabaseConfigured()) throw new Error('Supabase est indisponible.');
  const { data, error } = await supabase.rpc('activate_event_for_test', {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error("L’activation test n’a retourné aucun état.");
  const value = row as {
    event_id?: unknown;
    test_activated_at?: unknown;
    test_activated_by?: unknown;
  };
  const activatedId = Number(value.event_id);
  if (!Number.isSafeInteger(activatedId) || activatedId !== eventId
      || typeof value.test_activated_at !== 'string'
      || typeof value.test_activated_by !== 'string') {
    throw new Error("L’activation test retournée par la base est invalide.");
  }
  return {
    eventId: activatedId,
    testActivatedAt: value.test_activated_at,
    testActivatedBy: value.test_activated_by,
  };
}
