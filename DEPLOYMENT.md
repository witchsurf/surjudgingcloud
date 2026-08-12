# Deployment

Ce dépôt a deux cibles principales :

- Cloud public `surfjudging.cloud`.
- HP Event Box local pour le terrain.

## Cloud Public

Le workflow GitHub Actions principal est `.github/workflows/deploy.yml`.

Il se déclenche sur `main` quand `frontend/`, `backend/`, `infra/`, `scripts/` ou `deploy.sh` changent. Le workflow SSH sur le VPS puis exécute :

```bash
cd /opt/judging
chmod +x deploy.sh
./deploy.sh
```

`deploy.sh` :

- pull `origin/main`
- build le frontend
- rebuild/restart la stack Docker de production

### Realtime vs Polling (affichage public)

Si le cloud héberge beaucoup de pages `/display` (public / écran partagé), le websocket Realtime sur `scores` peut devenir coûteux côté Postgres (`realtime.list_changes(...)`).

Option hybride recommandée pour `/display` (polling scores, realtime timer/config) :

```bash
VITE_DISPLAY_SCORE_MODE=polling
VITE_DISPLAY_SCORE_POLL_MS=5000
```

Coupe-circuit global (debug/urgence) :

```bash
VITE_HEAT_SIGNAL_MODE=polling
```

## HP Event Box

Le HP ne doit pas être redéployé pour chaque événement si le code est déjà bon.

Le runbook opérateur de référence est
[`docs/hp-operations-runbook.md`](docs/hp-operations-runbook.md). Cette page
garde uniquement les commandes de déploiement et de release.

Préparation normale :

```bash
./scripts/hp-sync-cloud-to-local.sh --home
```

Déployer seulement le frontend HP :

```bash
SURF_HP_PROFILE=home ./scripts/hp-deploy-frontend.sh
```

Refresh complet stack + migrations HP :

```bash
SURF_HP_PROFILE=home ./scripts/hp-refresh-stack.sh
```

Audit :

```bash
SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh
```

## Event Box Mac locale

L'exploitation terrain Mac est décrite dans le runbook :
[`docs/hp-operations-runbook.md`](docs/hp-operations-runbook.md).

Commande opérateur :

```bash
./scripts/start-surfjudging-field-mac.sh
```

Variante sans `caffeinate` :

```bash
./scripts/start-surfjudging-field-mac.sh --no-caffeinate
```

### Construire et déployer une nouvelle release

Le Mac Field utilise le build dédié, pas un `npm run build` générique :

```bash
SURFJUDGING_RELEASE_ID=<RELEASE_ID> npm --prefix frontend run build:field
```

Le contenu de `frontend/dist-field/` est déployé dans le répertoire servi par le runtime Mac :

```bash
mkdir -p releases/mac-runtime/backups/<BACKUP_ID>
rsync -a releases/mac-runtime/current/dist/ releases/mac-runtime/backups/<BACKUP_ID>/
rsync -a --delete frontend/dist-field/ releases/mac-runtime/current/dist/
docker restart surfjudging
```

Conserver une copie du bundle précédent. Après redémarrage, vérifier depuis
l'URL LAN `deployment-manifest.json`, `RELEASE_ID` et le hash du script chargé.
Ce déploiement frontend ne lance ni migration ni nettoyage de la base terrain.

La configuration d'un heat depuis Admin suit
[`docs/admin-field-save-workflow.md`](docs/admin-field-save-workflow.md).

## Edge Functions

Voir `DEPLOY_EDGE_FUNCTIONS.md`.

## Runbook Opérationnel

Voir `docs/hp-operations-runbook.md`.
