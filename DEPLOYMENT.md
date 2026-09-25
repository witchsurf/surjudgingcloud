# Deployment

Ce dépôt a deux cibles principales :

- **Cloud public** `surfjudging.cloud`
- **App terrain Electron** `.dmg` (Mac) et `.exe` (Windows)

---

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

---

## App Terrain Electron (.dmg / .exe)

Depuis la v0.6.23, le déploiement terrain est **exclusivement Electron packagé**.
Le HP Docker externe est archivé dans `legacy/`.

### Architecture

```
[Mac/PC opérateur]  ──  SurfJudging Field.dmg / .exe
                         └─ Supabase runtime embarqué (bundled)
                         └─ Frontend React (field build)
                         └─ LAN WiFi → tablettes juges + écran display
```

### Construire le frontend field

```bash
npm --prefix frontend run build field <runtime-name>
```

Le build utilise `VITE_DEPLOYMENT_MODE=field`. La sortie est dans `frontend/dist-field/`.

### Packager le .dmg / .exe

```bash
# Mac (Intel + Apple Silicon)
npm --prefix desktop run package:mac

# Windows
npm --prefix desktop run package:win
```

Les installateurs sont dans `desktop/dist-installers/`.

La commande `verify:package-input` s'exécute automatiquement avant le packaging et bloque si l'identité est incohérente.

### Provisioning runtime

Voir `docs/field-deployment-mode-provisioning.md`.

### Configuration field

Voir `docs/admin-field-save-workflow.md`.

---

## Edge Functions

Voir `DEPLOY_EDGE_FUNCTIONS.md`.
