\set ON_ERROR_STOP on

-- The stock image demotes postgres and reserves its service roles through
-- supautils. Run this file as the image-owned supabase_admin superuser and
-- suppress failed-statement logging so a bootstrap error cannot disclose the
-- generated password in PostgreSQL logs.
SET log_min_error_statement = PANIC;

-- A fresh Supabase PostgreSQL image creates these service roles with image
-- defaults. The Field runtime generates its own POSTGRES_PASSWORD, so every
-- database client role must be aligned during first boot.
ALTER ROLE authenticator WITH PASSWORD :'field_postgres_password';
ALTER ROLE supabase_auth_admin WITH PASSWORD :'field_postgres_password';
ALTER ROLE supabase_storage_admin WITH PASSWORD :'field_postgres_password';
ALTER ROLE supabase_admin WITH PASSWORD :'field_postgres_password';
ALTER ROLE postgres WITH PASSWORD :'field_postgres_password';

-- Realtime runs its migrations with this schema selected. It must exist before
-- the Realtime container starts; otherwise Ecto cannot create schema_migrations.
CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
ALTER SCHEMA _realtime OWNER TO supabase_admin;
GRANT ALL ON SCHEMA _realtime TO supabase_admin;
GRANT USAGE ON SCHEMA _realtime TO postgres, anon, authenticated, service_role;
