-- Supabase Infrastructure Initialization Script
-- This script creates all required schemas, roles, and permissions for Supabase services
-- Must run before other migrations

-- ===========================================
-- 1. CREATE ROLES
-- ===========================================

-- Create service roles if they don't exist
DO $$
BEGIN
    -- Authenticator role (used by PostgREST)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
        CREATE ROLE authenticator LOGIN PASSWORD 'your-super-secret-password';
    END IF;

    -- Anonymous role (for unauthenticated users)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;

    -- Authenticated role (for authenticated users)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;

    -- Service role (for admin operations)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;

    -- Supabase admin role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
        CREATE ROLE supabase_admin LOGIN PASSWORD 'your-super-secret-password';
    END IF;

    -- Auth admin role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        CREATE ROLE supabase_auth_admin LOGIN PASSWORD 'your-super-secret-password' CREATEROLE;
    END IF;

    -- Storage admin role
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
        CREATE ROLE supabase_storage_admin LOGIN PASSWORD 'your-super-secret-password';
    END IF;
END
$$;

-- Grant role memberships
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
GRANT supabase_admin TO postgres;
GRANT supabase_auth_admin TO postgres;
GRANT supabase_storage_admin TO postgres;

-- ===========================================
-- 2. GRANT PUBLIC SCHEMA PERMISSIONS
-- ===========================================

-- Fix public schema permissions
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role, supabase_admin, supabase_auth_admin, supabase_storage_admin;
GRANT CREATE ON SCHEMA public TO postgres, supabase_admin, supabase_auth_admin, supabase_storage_admin;
GRANT ALL ON SCHEMA public TO postgres;

-- Allow creating tables in public schema
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role, supabase_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role, supabase_admin;

-- ===========================================
-- 3. CREATE AUTH SCHEMA
-- ===========================================

CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;

-- Grant permissions on auth schema
GRANT USAGE ON SCHEMA auth TO postgres, supabase_admin, authenticator;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Set search path for auth admin
ALTER ROLE supabase_auth_admin SET search_path TO auth, public;

-- Grant permissions for future tables in auth schema
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO supabase_auth_admin, postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO supabase_auth_admin, postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO supabase_auth_admin, postgres;

-- ===========================================
-- 4. CREATE STORAGE SCHEMA
-- ===========================================

CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;

-- Grant permissions on storage schema
GRANT USAGE, CREATE ON SCHEMA storage TO supabase_storage_admin, postgres;
GRANT USAGE ON SCHEMA storage TO authenticator, service_role, anon, authenticated;

-- Set search path for storage admin
ALTER ROLE supabase_storage_admin SET search_path TO storage, public;

-- Grant permissions for future tables in storage schema
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON TABLES TO supabase_storage_admin, postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON SEQUENCES TO supabase_storage_admin, postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage GRANT ALL ON FUNCTIONS TO supabase_storage_admin, postgres;

-- ===========================================
-- 5. CREATE REALTIME SCHEMA
-- ===========================================

CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;

-- Grant permissions on realtime schema
GRANT USAGE ON SCHEMA _realtime TO postgres, supabase_admin;
GRANT ALL ON SCHEMA _realtime TO supabase_admin;

-- Set search path for supabase admin
ALTER ROLE supabase_admin SET search_path TO _realtime, public;

-- Grant permissions for future tables in _realtime schema
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA _realtime GRANT ALL ON TABLES TO supabase_admin, postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA _realtime GRANT ALL ON SEQUENCES TO supabase_admin, postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA _realtime GRANT ALL ON FUNCTIONS TO supabase_admin, postgres;

-- ===========================================
-- 6. CREATE ADDITIONAL HELPER SCHEMAS
-- ===========================================

-- Extensions schema (if needed)
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA extensions TO postgres, authenticator, service_role;

-- GraphQL schema (for PostgREST GraphQL support)
CREATE SCHEMA IF NOT EXISTS graphql_public AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA graphql_public TO postgres, anon, authenticated, service_role;

-- ===========================================
-- 7. ENABLE REQUIRED EXTENSIONS
-- ===========================================

-- UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- ===========================================
-- 8. FINAL PERMISSIONS
-- ===========================================

-- Grant execute permissions on extensions functions
GRANT ALL ON ALL FUNCTIONS IN SCHEMA extensions TO postgres, anon, authenticated, service_role, supabase_admin;

-- Ensure postgres can access everything
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO postgres;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Supabase infrastructure initialization completed successfully';
END
$$;
