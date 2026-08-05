# P1 — plan d’implémentation

P1 stabilise le serveur LAN existant sans Electron, SQLite, remplacement de Supabase ni modification métier.

1. Embarquer l’illustration surf et formaliser les routes/URLs terrain.
2. Tester l’allowlist réseau et les routes `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display`.
3. Auditer statiquement les assets puis intercepter les requêtes du build dans un navigateur.
4. Étendre le panneau opérateur : HP, port, URLs, frontend, schéma, base, Realtime et ESP32 optionnel.
5. Rendre les health-checks terrain strictement LAN et compléter les scripts opérateur.
6. Vérifier build, tests, syntaxe shell et audit réseau, puis documenter les résultats.

Fichiers applicatifs concernés : `frontend/public/surf-event-local.svg`, `frontend/src/events/EventsApp.tsx`, `frontend/src/pages/Home.tsx`, `frontend/src/lib/fieldNetwork.ts`, `frontend/src/lib/offlineOperations.ts`, `frontend/src/hooks/useOfflineDiagnostics.ts`, `frontend/src/components/FieldDiagnosticsPanel.tsx`.

Fichiers serveur/opérateur : `backend/supabase/functions/health-check/index.ts` et son miroir, `scripts/hp-healthcheck.sh`, `scripts/hp-ops.sh`, `scripts/hp-field-smoke-test.mjs`, `scripts/p1-field-build-audit.mjs`.

`event-box`, `beach`, la WAL, le timer, le scoring et la synchronisation Cloud ↔ HP restent inchangés.
