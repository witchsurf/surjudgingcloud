# Audit des dépendances — P0

## Classification

| Dépendance | Usage actuel | Critique pendant un heat | Fonctionne sans Internet | État P0 |
|---|---|---:|---:|---|
| Supabase local HP | Base, REST, RPC, Realtime, Auth/RLS | Oui | Oui | Dépendance locale centrale à conserver jusqu'à migration validée |
| Supabase Cloud | Préparation, comptes, paiement, publication/sync | Non si la copie HP est complète | Non | Doit rester hors du chemin critique terrain |
| Google Sheets | Import participants via URL d'export CSV publique | Non | Non pour l'URL | Option d'entrée seulement ; upload CSV local existe |
| Apps Script | Aucun appel, endpoint ou manifeste trouvé | Non | N/A | Pas de dépendance de code identifiée |
| Stripe | Checkout/webhook et tables de paiement cloud | Non | Non | À isoler du runtime terrain ; déjà non requis pour scorer |
| Internet/CDN | Sync cloud, auth email, paiement, image Unsplash, éventuels services de déploiement | Non en théorie | Partiellement | Supprimer/embarquer les ressources visuelles distantes avant certification hors ligne |
| Réseau LAN | Tablettes ↔ HP, ESP32 ↔ HP | Oui | Oui | Critique ; routeur et adressage doivent être testés |
| Navigateur/IndexedDB | UI, cache et files d'écritures | Oui par poste | Oui | Résilience utile, mais double file à auditer |
| Docker + stack Supabase | Backend HP actuel | Oui | Oui | Complexité opérationnelle et point de panne local |

## Google Sheets et Apps Script

`frontend/src/components/ImportParticipants.tsx` accepte une URL Google Sheet. `frontend/src/utils/csv.ts::buildGoogleSheetCsvUrl` extrait l'identifiant et le `gid`, puis appelle `https://docs.google.com/spreadsheets/d/.../export?format=csv`. Cela exige Internet et que la feuille soit publiquement accessible. Le même écran accepte un fichier CSV local : aucune fonction de jugement ne dépend donc de Sheets.

Aucune référence exécutable à `script.google.com`, Apps Script, `google.script.run` ou un déploiement Apps Script n'a été trouvée. Apps Script n'est pas une dépendance actuelle du dépôt audité.

## Supabase

### Chemin critique terrain

Le frontend importe `@supabase/supabase-js` et utilise directement tables, RPC, Auth et channels Realtime. Les domaines principaux sont :

- événements, participants, heats, slots et qualifiés ;
- scores, corrections, suppressions et interférences ;
- panel et identité des juges ;
- pointeur du heat actif par podium ;
- configuration live, timer et priorité ;
- audit et diagnostics de version.

Les modules concernés incluent `lib/supabase.ts`, `api/supabaseClient.ts`, `api/modules/*`, `repositories/*`, `hooks/useRealtimeSync.ts`, `hooks/useSupabaseSync.ts`, `stores/configStore.ts` et la majorité des pages opérationnelles.

### Résilience existante

- Realtime avec fallback polling local de 30 s.
- WAL scores/overrides dans IndexedDB et file legacy heats/config/timer.
- RPC PostgreSQL pour les opérations sensibles et transactionnelles.
- Test terrain qui échoue si une page HP appelle l'hôte cloud.
- Comparaison version frontend/version schéma HP.

### Risques

Le client contient plusieurs couches d'accès concurrentes et des replis qui écrivent parfois directement dans les tables quand une RPC manque. Les types Supabase sont volontairement `any`, ce qui masque les dérives de schéma. Une panne du HP, de PostgREST ou de PostgreSQL touche tous les postes malgré l'absence d'Internet.

## Stripe et paiements

Les providers `stripe`, `wave` et `orange_money` sont modélisés. `frontend/src/events/api.ts` invoque l'Edge Function `payments`; `events/components/PaymentOptions.tsx` redirige vers l'URL Checkout Stripe. `backend/supabase/functions/payments/index.ts` crée/consulte les paiements et `stripe-webhook/index.ts` traite les événements webhook avec des secrets serveur. Les migrations contiennent `events.paid` et `payments`.

Stripe nécessite Internet, les Edge Functions cloud et les secrets Stripe. Il n'est pas appelé par l'interface de scoring et ne doit jamais devenir un verrou au démarrage ou pendant un heat. Auth email/OTP et récupération de mot de passe sont également cloud, tandis que le mode terrain possède des mécanismes d'auth hors ligne/local.

## Internet et ressources externes

Fonctions qui exigent actuellement Internet : préparation/synchronisation Cloud ↔ HP, Google Sheet par URL, authentification email cloud, paiement Stripe/autres providers, déploiement et publication. `frontend/src/events/EventsApp.tsx` charge aussi une image Unsplash par URL ; elle est non critique mais prouve que toutes les ressources ne sont pas encore embarquées.

Fonctions censées ne pas l'exiger : activation de heat, scoring, résultats, timer, priorité et affichage sur le LAN. Cette propriété dépend d'un build correctement configuré pour l'URL Supabase locale et doit continuer à être vérifiée par `scripts/hp-field-smoke-test.mjs`.

## Dépendances applicatives notables

- React 18, Vite, TypeScript, Zustand.
- `@supabase/supabase-js` pour toutes les communications backend.
- `idb` pour persistance locale ; localStorage/sessionStorage en repli et pour l'état UI/auth.
- `jspdf`, `jspdf-autotable`, `html2canvas` pour exports.
- Sentry est conditionnel et désactivé en mode Supabase local.
- Docker, PostgreSQL, Kong/PostgREST/Realtime/Auth/Storage composent la box actuelle.

## Décisions P0 proposées

1. Geler et tester le chemin LAN Supabase actuel avant remplacement.
2. Marquer explicitement Sheets, Stripe, auth email et Cloud comme fonctionnalités de préparation/post-événement.
3. Interdire au build terrain les domaines publics par test automatisé et CSP, après validation.
4. Générer les types depuis le schéma Supabase de référence.
5. Documenter le comportement exact des deux files et tester idempotence/ordre/reconnexion.
