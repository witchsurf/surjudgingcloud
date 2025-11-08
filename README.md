# wave-sync-senegal Agents

This repository includes an **AGENTS.md** file and predefined agent stubs in the `agents/` folder.

## Contents
- `AGENTS.md`: Documentation of all agents and their roles in the project.
- `agents/`: Folder containing YAML definitions for each agent:
  - `project_setup.yaml`
  - `data_sync.yaml`
  - `localization.yaml`
  - `notification.yaml`
  - `analytics_reporting.yaml`

## Setup Instructions

1. Place `AGENTS.md` in the root of your repository.
2. Copy the `agents/` folder into your project root.
3. Review each YAML file in `agents/` and adjust:
   - Frameworks (e.g., React Native, Node.js, Django).
   - Input/output formats (JSON, CSV, etc.).
   - Constraints specific to your deployment environment.

## Usage
- Use these YAML files as **blueprints** for building your Codex agents.
- Extend or customize as needed by editing definitions.
- Keep `AGENTS.md` updated as a reference for contributors.

## Supabase setup for the judging app

1. Create a local `.env` (or `.env.local`) in the project root with these vars (see `.env.example`):

```
VITE_SUPABASE_URL="https://xwaymumbkmwxqifihuvn.supabase.co"
VITE_SUPABASE_ANON_KEY="<your-anon-key>"
```

2. To create the database schema, open the Supabase project SQL editor and paste the SQL from `supabase/migrations/20251104120000_init_judging.sql` and run it. The migration is idempotent and safe to re-run.

3. If you prefer CLI-driven migrations, install the Supabase CLI and run the SQL file against your DB. You'll need a service role key or psql access. For example (optional):

```
# with psql (if you have a DB connection string)
# psql "postgresql://<user>:<password>@<host>:5432/postgres" -f supabase/migrations/20251104120000_init_judging.sql

# or use the Supabase SQL editor copy/paste
```

4. After applying the SQL, start the app locally and it will connect using the `VITE_*` variables exposed to Vite. For dev server:

```
npm install
npm run dev -- --host
```

Security note: the migration creates permissive policies so the anon key can read/write for judging convenience; review and tighten policies before production.


## Best Practice
- One agent = one responsibility.
- Communicate between agents using JSON schemas.
- Keep agents stateless unless state is explicitly required.
- Log all agent actions for traceability.

---
⚡ With these stubs, you can bootstrap development quickly and adapt as your app evolves.
