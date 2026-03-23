-- Re-sync production with the intended security model for payments.
-- The repo already defines payments RLS policies; this only re-enables RLS
-- when the table drifted into a disabled state.

ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;
