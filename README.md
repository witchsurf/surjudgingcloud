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

## Module Paiement d’accès SurfJudging

Une section dédiée à l’onboarding payant des organisateurs est disponible sur `/events`.

### Prérequis
- Supabase lié au projet (voir `supabase status` et `supabase link status`).
- Variables d’environnement front :
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Secrets Supabase (Edge Function `payments`) :
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `STRIPE_SECRET_KEY` (clé secrète Stripe, requise pour la CB)
  - Facultatif : clés/API pour Orange Money & Wave si vous disposez d’un agrégateur.

Définissez les secrets en local puis poussez-les vers Supabase :

```bash
supabase secrets set --env-file ./supabase/.secrets/payments.env
```

Exemple de contenu `supabase/.secrets/payments.env` :

```
SUPABASE_SERVICE_ROLE_KEY=xxx
STRIPE_SECRET_KEY=sk_live_xxx
ORANGE_MONEY_API_URL=https://api.orange.com/...
ORANGE_MONEY_API_KEY=...
WAVE_API_URL=https://wave.example.com/...
WAVE_API_KEY=...
```

### Lancer le module

```bash
# Supabase local (DB + Edge Functions)
supabase start
supabase functions serve payments

# Frontend
npm run dev
```

Accédez ensuite à `http://localhost:5173/events` :
1. Identifiez-vous (magic link Supabase Auth).
2. Renseignez les informations de votre organisation.
3. Réglez votre licence SurfJudging (Stripe, Orange Money, Wave).
4. À réception, l’accès complet au scoring est débloqué et une trace du paiement est conservée (`public.payments`).

### Déploiement

1. Publiez la migration (`supabase db push`).
2. Déployez la fonction :
   ```bash
   supabase functions deploy payments
   ```
3. Synchronisez les secrets sur l’environnement distant :
   ```bash
   supabase secrets set --project-ref <project-ref> --env-file ./supabase/.secrets/payments.env
   ```
4. Rebuild du front et publication (Vite).

### Récapitulatif commandes utiles

```bash
supabase db reset
supabase functions serve payments
supabase functions deploy payments
npm run lint
npm run test -- --run
npm run dev
```

## Participants & Structure d’Événement

Une nouvelle page `/events/participants` permet de gérer l’inscription des athlètes et de générer automatiquement les rounds/heats.

### Formats d’import

- **Google Sheets** : rendez votre sheet publique (“Partager &gt; Restreint → Toute personne disposant du lien”) puis collez l’URL d’édition dans l’onglet dédié.
  - La page la convertit automatiquement en export CSV (`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=GID`).
- **CSV** : utilisez un fichier UTF-8 avec en-têtes `seed,name,category,country,license`. Les colonnes `country` et `license` sont optionnelles.
- `seed` doit être un entier unique par catégorie et par événement, `category` est une chaîne (OPEN, JUNIOR, ONDINE, ...).

### Snake seeding

Le premier tour répartit les seeds selon un aller/retour : on remplit les heats H1..HK, puis on repart dans l’autre sens HK..H1. Pour 12 surfeurs (3 heats de 4), on obtient :

- H1 : 1, 6, 7, 12
- H2 : 2, 5, 8, 11
- H3 : 3, 4, 9, 10

Les meilleurs seeds héritent automatiquement des byes lorsque le nombre de participants ne remplit pas complètement les heats.

### Génération & export

- Choisissez le format (élimination directe / repêchage), la taille de série, et la variante R2 (2x3 ou 3x2 man-on-man).
- Le bouton “Générer la prévisualisation” affiche les rounds principaux et, selon le format, les repêchages (R1, R2…).
- “Confirmer et écrire dans la base” crée les heats `planned` + les affectations (`heat_entries`) dans Supabase. Option “Écraser” pour nettoyer les heats planifiés existants de la catégorie.
- Exports disponibles : PDF ou CSV style ISA.

### Helpers Supabase

- `participants` : `event_id`, `category`, `seed`, `name`, `country`, `license`.
- `heat_entries` : `heat_id` (texte, aligné sur `heats.id`), `participant_id`, `position`, `seed`.
- `heats` reçoit une colonne `heat_size` (ajoutée via migration) et conserve `status='planned'` tant que la série n’est pas lancée.
