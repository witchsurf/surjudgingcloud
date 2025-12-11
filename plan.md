# Plan n8n x Surfjudging.cloud

Ce plan est une checklist vivante pour intégrer n8n (self-host Hostinger) et externaliser l’orchestration. Mets à jour les cases au fil de l’eau et réorganise si besoin.

## 0) Pré-requis
- [ ] Confirmer l’instance n8n (self-host Hostinger) et le mode queue (Postgres + Redis managés).
- [ ] Réserver le sous-domaine `automation.surfjudging.cloud` pointant sur l’instance n8n.
- [ ] Disposer des clés service role Supabase + accès Stripe/OM/Wave (tests + prod).
- [ ] Activer `N8N_ENCRYPTION_KEY` et stocker les secrets dans un coffre (Vault/ASM/SSM ou équivalent).

## 1) Déploiement n8n (Hostinger)
- [ ] n8n main + workers en queue mode, reliés à Postgres/Redis managés ou internes sécurisés.
- [ ] Ingress + TLS sur `automation.surfjudging.cloud` avec WAF/ratelimit pour les webhooks.
- [ ] SSO/OIDC pour l’accès admin; firewall/IP allowlist.
- [ ] Export des logs vers ta stack d’observabilité (SIEM + métriques Prometheus/Grafana ou équivalent Hostinger).

## 2) Connexions & secrets
- [ ] Credentials Supabase (service role) pour nodes DB/HTTP.
- [ ] Credentials Stripe + OM + Wave (tests + prod) séparés par environnement.
- [ ] Variables front (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) alignées avec l’environnement n8n.
- [ ] Activer Source Control n8n (Git) et choisir le repo/branche pour versionner les workflows.

## 3) Workflows à construire
### 3.1 Paiement / Onboarding organisateur
- [ ] Webhook `payment_init` : reçoit `{eventId, provider, amount, currency, phoneNumber?, successUrl?, cancelUrl?}`.
- [ ] Branches Stripe/OM/Wave : init transaction, stocker `payments` + `events.status` dans Supabase, retourner l’URL ou les instructions.
- [ ] Webhook `payment_confirm` ou polling Stripe : met à jour `payments` + `events.paid`, notifie (email/SMS/Slack).
- [ ] Post-paiement : préremplir config de l’événement (participants de démo, `heat_configs`, `heat_timers`) si souhaité.

### 3.2 Import participants & génération de heats
- [ ] Webhook `participants_import` : récupère Google Sheet/CSV → validation → upsert `participants`.
- [ ] Node Code (portage de `frontend/src/utils/bracket.ts`) : calcule heats/bracket selon format choisi.
- [ ] Upsert `heats` + `heat_entries` + `heat_configs`; option “overwrite” existants.
- [ ] Génération/export PDF/CSV et envoi aux officiels (email) en sortie de workflow.

### 3.3 Scores & supervision
- [ ] Trigger Supabase (PostgREST webhook) sur `scores`/`score_overrides`/`heats`.
- [ ] Règles : alerte si heat “open” sans score > X min, juge manquant, latence élevée.
- [ ] Calcul agrégats/classements et push vers cache/API publique.
- [ ] DLQ/retry pour éviter la perte d’événements.

### 3.4 Publication & notifications
- [ ] Fin de heat → génération PDF/CSV résultats + publication bucket/URL.
- [ ] Notifications (Slack/Email/SMS) aux officiels et aux organisateurs.
- [ ] Webhook de mise à jour front (optionnel) pour rafraîchir l’affichage public.

## 4) Intégration front/back existants
- [ ] Remplacer les appels direct Supabase/Edge Function par appels webhook n8n :
  - Page paiement (`frontend/src/pages/PaymentPage.tsx`) → `payment_init` (puis redirection Stripe/OM/Wave).
  - Import participants (`frontend/src/pages/ParticipantsStructure.tsx`) → `participants_import`.
- [ ] Garder Supabase pour Realtime scores, mais réduire la logique de retry dans `useSupabaseSync` quand n8n prend le relai supervision.
- [ ] Documenter les contrats JSON (entrée/sortie) des webhooks pour le front.

## 5) Observabilité & runbook
- [ ] Dashboards: taux de succès des workflows, latence des webhooks, retries, files Redis.
- [ ] Alerting: erreurs critiques, échecs paiement, absence de scores, workers n8n KO.
- [ ] Runbook: procédures de rollback/restauration (DB, workflows Git, `N8N_ENCRYPTION_KEY`), et test de restauration régulier.

## 6) Sécurité & conformité
- [ ] IP allowlist/rate limit sur webhooks; signature HMAC ou token par endpoint.
- [ ] Secrets en coffre + rotation; chiffrement repos (volumes) + backups chiffrés.
- [ ] Séparer dev/staging/prod (workflows, creds, URLs) et données anonymisées en non-prod.

## 7) Prochaines étapes courtes
- [ ] Confirmer l’hébergement Hostinger (ressources, accès Postgres/Redis).
- [ ] Créer repo Git pour les workflows (Source Control n8n).
- [ ] Écrire le premier workflow `payment_init` et tester en sandbox (Stripe test/OM sandbox).
- [ ] Brancher la page `PaymentPage.tsx` sur le webhook et valider de bout en bout.
