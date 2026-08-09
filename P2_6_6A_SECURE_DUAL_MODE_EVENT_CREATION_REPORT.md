# P2.6.6A — Secure dual-mode event creation RPC

Date: 2026-08-09
Conclusion: **DUAL_MODE_EVENT_CREATE_BLOCKED**

La frontière de création `UI -> EventRepository -> api/modules -> create_event_secure` est implémentée et validée en modes Field et Cloud. Aucune release n'est produite : la validation Cloud post-paiement complète et la reconstruction vierge PostgreSQL 15 restent à faire.

## Contrat `public.events` observé

| Colonne / propriété | Cloud réel (PostgreSQL 17) | Field isolé | Divergence |
|---|---|---|---|
| `id` | `bigint`, séquence/default serveur, NOT NULL | `bigint`, séquence/default serveur, NOT NULL | aucune pour le contrat canonique |
| `name`, `organizer` | `text`, NOT NULL | `text`, NOT NULL | aucune |
| `start_date`, `end_date` | `date`, NOT NULL | `date`, NOT NULL | aucune |
| `price` | `integer`, NOT NULL | `integer`, NOT NULL | aucune |
| `currency` | `text`, défaut `XOF`, NOT NULL | identique | aucune |
| `method` | nullable | nullable | aucune |
| `status` | défaut `pending` | défaut `pending` | aucune |
| `paid` | défaut `false` | défaut `false` | aucune |
| `paid_at`, `payment_ref` | nullable | nullable | aucune |
| `categories`, `judges` | `jsonb`, défaut `[]` | `jsonb`, défaut `[]` | aucune |
| `user_id` | `uuid`, nullable, FK auth | `uuid`, nullable | Field conserve `NULL` |
| `owner_id` | `uuid`, nullable, défaut `auth.uid()` | absent | géré dynamiquement par la RPC |
| `created_at` | timestamptz, défaut serveur | timestamptz, défaut serveur | aucune |
| `updated_at` | absent dans le dump Cloud | présent en Field | non exposé par le contrat de création |
| triggers | aucun trigger event identifié | `set_updated_at_trigger`, `trg_update_events_updated_at` | sans impact sur le retour étroit |
| RLS | activée, policies owner/paid | activée, policies auth/user | policy locale additive nécessaire |

### ACL/RLS

- La migration ne donne aucun droit direct `INSERT` ou `UPDATE` à Field.
- Les droits historiques Cloud sur `events` existaient avant P2.6.6A et n'ont pas été élargis par ce lot.
- `SELECT` est accordé à `anon`/`authenticated`, puis borné par RLS.
- `events_read_local_field` rend les événements visibles uniquement lorsque le détecteur identifie une requête Field.
- La jointure `event_last_config` reste interdite à `anon`. MyEvents omet donc cette jointure en Field au lieu d'élargir son ACL.

## RPC et sécurité

Migrations additives:

- `20260808190000_create_event_secure.sql`
- `20260808191000_fix_event_creation_field_proxy_detection.sql`

La seconde migration est devenue nécessaire après observation réelle de Kong/PostgREST : le header `host` peut être un nom Docker interne. Le contrat final est celui déjà utilisé historiquement sur le terrain : un host Supabase `*.supabase.co`/`*.supabase.net` est Cloud ; un autre host HTTP non vide appartient à l'installation Field contrôlée. Header absent ou invalide : refus fermé.

`create_event_secure`:

- `SECURITY DEFINER`, owner `postgres`, `search_path = public, pg_temp`;
- `PUBLIC EXECUTE` révoqué;
- `EXECUTE` accordé à `anon` et `authenticated`;
- Cloud anon refusé dans la fonction malgré son droit EXECUTE;
- Cloud exige `auth.uid()` non anonyme et force `user_id = owner_id = auth.uid()`;
- Field autorise l'anon key locale et conserve les identités Cloud à `NULL`;
- force `status='pending'`, `paid=false`, `method/paid_at/payment_ref=NULL`;
- n'accepte ni ID, ni owner/user, ni état paid fourni par le client;
- retourne l'ID PostgreSQL `bigint` et les seuls champs nécessaires au workflow.

## Frontière frontend

Créés/adaptés:

- `frontend/src/repositories/contracts/events.ts`: DTO de création et retour canonique;
- `frontend/src/api/modules/eventCreation.api.ts`: seul appel RPC;
- `frontend/src/repositories/EventRepository.ts`: `create()` explicite;
- `frontend/src/components/CreateEvent.tsx`: aucune écriture PostgREST directe;
- `frontend/src/events/api.ts`: façade legacy déléguée au repository;
- `frontend/src/pages/MyEvents.tsx`: lecture Field sans jointure ACL-incompatible;
- `frontend/src/types/supabase.generated.ts`: types régénérés depuis la stack isolée.

Le chemin nominal ne contient plus `supabase.from('events').insert(...)`. Une erreur RPC n'écrit aucun faux événement actif en localStorage et ne navigue ni vers paiement ni vers participants.

## Résultats Field

- reconstruction vierge Supabase locale PostgreSQL 17: PASS;
- tests SQL Cloud-like + Field: PASS;
- création UI avec anon key locale: PASS;
- ID bigint canonique: PASS;
- `/participants` direct, aucun `/payment`: PASS;
- événement visible dans MyEvents: PASS;
- refresh: PASS;
- `/admin`: PASS;
- requêtes WAN: 0; LAN diagnostique neutralisé dans le test: PASS;
- redémarrage stack sans `-v`: la ligne temporaire ID 13 a été retrouvée dans le volume après redémarrage, puis supprimée;
- cleanup Field: PASS.

Le fichier terrain inchangé `Competition X.xlsx` a été rejoué séparément:

- 62 participants / 7 catégories: PASS;
- preview: PASS;
- preflight SAFE et RPC safe-v2: PASS;
- heats inactifs et `heat_configs` complets: PASS;
- remplacement concurrent contenant un score bloqué sans perte: PASS;
- 5 tests opt-in réels passés, fixtures nettoyées.

## Résultats Cloud

- stamps Cloud `20260808190000` et `20260808191000`: appliqués;
- appel HTTP avec anon key: HTTP 401 / `CLOUD_AUTH_REQUIRED`: PASS;
- vraie auth via utilisateur temporaire: PASS;
- création UI -> repository -> RPC: PASS;
- ID bigint, `user_id` et `owner_id` égaux à l'utilisateur: PASS;
- `paid=false`, `status=pending`, `method=NULL`: PASS;
- navigation `/payment`: PASS;
- événement et utilisateur temporaires supprimés: PASS; inventaire final 0/0.

Non validé et donc bloquant pour une release:

- callback/provider de paiement de test;
- confirmation `paid` en DB par le workflow de paiement réel;
- suite Cloud après paiement: participants, heats, safe-v2, `/admin`, reload.

## Compatibilité et non-régression

- PostgreSQL 17, reconstruction vierge: PASS.
- PostgreSQL 15, reconstruction vierge incluant 190000/191000: NON EXÉCUTÉE. La syntaxe utilisée est compatible PG15, mais cela ne remplace pas la preuve demandée.
- typecheck `tsc --noEmit`: PASS.
- suite complète: 392 tests PASS, 7 opt-in SKIP.
- dual-mode: 19/19 PASS.
- tests adaptateur RPC: 3/3 PASS.
- tests Competition X réels: 5/5 PASS.
- E2E Field final: PASS.
- E2E Cloud auth/create/payment-entry: PASS.
- builds Cloud et Field: PASS.
- audit réseau P1 Field: PASS, aucune violation; routes `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display` HTTP 200.
- `bash -n scripts/hp-refresh-stack.sh`: PASS.

## Incidents caractérisés

1. Le premier push Cloud a été intégralement rollback car Cloud ne possédait pas `is_local_database()`. La migration a été rendue autonome avant application réussie.
2. Le premier détecteur autonome ne reconnaissait pas le hostname Docker transmis par Kong. La corrective additive 191000 conserve l'historique immuable et restaure le contrat Field.
3. MyEvents Field échouait à cause du droit manquant sur la relation imbriquée `event_last_config`; la requête Field a été réduite, sans élargir l'ACL.

## Impact release

**Aucun commit release, RELEASE_ID, artefact final ou déploiement frontend n'est autorisé à ce checkpoint.**

Critères restant pour passer à `DUAL_MODE_EVENT_CREATE_READY`:

1. reconstruction vierge PostgreSQL 15 avec les migrations 190000/191000 et tests SQL;
2. E2E Cloud isolé du callback/provider jusqu'à `paid=true`, participants, safe-v2, `/admin` et reload;
3. cleanup Cloud final vérifié après cette chaîne.
