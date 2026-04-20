# Surf Judging Cloud

Application de jugement surf pour événement en mode cloud + terrain local HP.

## Points D’entrée

- `./event-box` : menu maison / maintenance HP (`10.0.0.28`).
- `./beach` : menu plage / D-LINK (`192.168.1.2`).
- `docs/hp-operations-runbook.md` : runbook opérationnel principal.
- `DEPLOYMENT.md` : déploiement cloud et HP.
- `DEPLOY_EDGE_FUNCTIONS.md` : Edge Functions Supabase.

## Workflow Terrain Recommandé

1. Préparer l’événement dans le cloud.
2. Copier Cloud Supabase vers HP local :

```bash
./scripts/hp-sync-cloud-to-local.sh --home
```

3. Vérifier le HP :

```bash
SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh
```

4. Exploiter l’événement en LAN via `./beach`.
5. Après l’événement, pousser les faits terrain vers le cloud via `./event-box`.

## Développement

Frontend :

```bash
cd frontend
npm install
npm run dev
npm run build
```

Scripts utiles :

- `scripts/hp-deploy-frontend.sh` : build + déploiement du frontend sur le HP.
- `scripts/hp-refresh-stack.sh` : refresh stack Docker + migrations locales HP.
- `frontend/scripts/hp-photocopy-db.mjs` : moteur Cloud -> HP.
- `frontend/scripts/hp-push-db-to-cloud.mjs` : moteur HP -> Cloud.
- `frontend/scripts/repair-broken-qualifiers.mjs` : secours qualifiés, à utiliser seulement si l’audit le demande.

## Supabase

- Migrations : `backend/supabase/migrations`.
- SQL local HP historique encore utilisé par le refresh stack : `backend/sql`.
- Edge Functions source de vérité : `backend/supabase/functions`.

Pour synchroniser le miroir legacy des fonctions :

```bash
./scripts/sync-supabase-functions.sh
./scripts/check-supabase-drift.sh
```

## Notes

Le HP local est la source de vérité pendant l’événement. Les scores restent attachés aux couleurs de lycra; les corrections de lineup chef juge mettent à jour `participants` et `heat_entries` sans modifier les notes.
