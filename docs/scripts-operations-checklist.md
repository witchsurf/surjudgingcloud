# Checklist Des Scripts Operationnels

Ce memo resume les scripts utiles pour exploiter et maintenir `surjudgingcloud`.

Regle simple : pour les operations HP/Event Box du quotidien, utiliser d'abord `./scripts/hp-ops.sh` ou les menus `./event-box` / `./beach`. Les scripts plus bas niveau restent disponibles, mais ils sont surtout la pour les cas precis.

Pour une Event Box Mac locale, le point d'entree operateur est
`./scripts/start-surfjudging-field-mac.sh`. Le runbook de reference reste
`docs/hp-operations-runbook.md`.

## Entrees Operateur

- [ ] `./event-box`
  - Menu maison / maintenance.
  - Force le profil `home`.
  - A utiliser avant evenement, quand le HP est sur le reseau maison.

- [ ] `./beach`
  - Menu terrain / plage.
  - Lance le menu terrain avec le profil par defaut.
  - A utiliser sur le reseau D-LINK / plage.

- [ ] `./scripts/start-surfjudging-field-mac.sh`
  - Point d'entree operateur pour une Event Box Mac locale.
  - Demarre ou redemarre le frontend Field local et les services Supabase utiles.
  - Verifie `RELEASE_ID`, le mode DB `field` et affiche les URL LAN.
  - Variante : `./scripts/start-surfjudging-field-mac.sh --no-caffeinate`.

- [ ] `scripts/field-menu.sh`
  - Menu interactif commun aux profils maison et plage.
  - Permet : upgrade, healthcheck, deploy frontend, refresh stack, sync Cloud -> HP, sync HP -> Cloud, live sync.

- [ ] `scripts/hp-ops.sh`
  - Point d'entree recommande pour les operations HP/Event Box.
  - Commandes principales :
    - `upgrade` : refresh stack/migrations, deploy frontend, healthcheck.
    - `refresh` : refresh stack/migrations uniquement.
    - `deploy` : build et deploy frontend uniquement.
    - `healthcheck` : audit reseau, Docker, API, frontend.
    - `cloud-to-local` : copie Cloud Supabase vers HP local.
    - `local-to-cloud` : pousse un evenement HP local vers Cloud.
    - `live-start` / `live-stop` : demarre ou stoppe la sync live HP -> Cloud.
    - `urls` : affiche les URLs utiles.

## Preparation Et Sync Terrain

- [ ] `scripts/hp-sync-cloud-to-local.sh`
  - Copie la base Supabase Cloud vers la base Supabase locale du HP avant evenement.
  - Ne fait pas de build frontend.
  - Ne fait pas de refresh Docker.
  - Lance un audit des qualifiees/qualifies par defaut, sans reparation automatique.

- [ ] `frontend/scripts/hp-photocopy-db.mjs`
  - Script Node appele par `hp-sync-cloud-to-local.sh`.
  - Effectue la copie reelle Cloud -> HP.
  - Preserve la parite des IDs entre Cloud et local.

- [ ] `frontend/scripts/hp-push-db-to-cloud.mjs`
  - Pousse les donnees d'un evenement depuis le HP local vers Supabase Cloud.
  - Utilise par `./scripts/hp-ops.sh local-to-cloud --event-id <ID>`.
  - A lancer seulement apres avoir decide que le HP local est la source de verite.

- [ ] `scripts/hp-live-sync.sh`
  - Lance une boucle de sync HP -> Cloud pour le display public.
  - Usage typique : live via 4G pendant un evenement.
  - Ecrit un log et un statut dans `infra/.live-sync.*`.

## Maintenance HP

- [ ] `scripts/hp-healthcheck.sh`
  - Verifie le reseau, les ports `22`, `8080`, `8000`, les services Docker, l'API locale, le schema runtime et le bundle frontend.
  - A lancer apres une sync ou une operation importante.

- [ ] `scripts/hp-refresh-stack.sh`
  - Synchronise les fichiers infra/scripts/migrations vers le HP.
  - Demarre ou rafraichit la stack Docker locale.
  - Applique les migrations locales et verifie le suivi des migrations.
  - A eviter le jour terrain si la stack repond deja.

- [ ] `scripts/hp-deploy-frontend.sh`
  - Build le frontend HP localement.
  - Envoie l'artefact de deploiement vers le HP.
  - Recharge nginx dans le conteneur web.
  - Verifie que le bundle servi par le HP correspond au bundle build.

- [ ] `scripts/field-ops.sh`
  - Ancien raccourci compatible.
  - Redirige vers `./scripts/hp-ops.sh upgrade`.
  - Preferer `hp-ops.sh` pour les nouvelles habitudes.

## Supabase Cloud Et Fonctions

- [ ] `scripts/deploy-supabase-functions.sh`
  - Deploie les Edge Functions Supabase depuis `backend/supabase/functions`.
  - Fonctions deployees : `payments`, `heat-sync`, `kiosk-bootstrap`, `stripe-webhook`, `health-check`.

- [ ] `scripts/sync-supabase-functions.sh`
  - Synchronise les fonctions depuis la source canonique `backend/supabase/functions` vers le miroir legacy `supabase/functions`.
  - Sync non destructive par defaut.

- [ ] `scripts/check-supabase-drift.sh`
  - Compare `backend/supabase/functions` et `supabase/functions`.
  - Signale les fichiers manquants, differents ou extra dans le miroir.

## Tests Et Secours

- [ ] `scripts/hp-field-smoke-test.mjs`
  - Test Playwright de fumee terrain.
  - Verifie que l'app HP locale fonctionne sans appels Cloud indesirables.
  - Controle aussi le schema runtime et les pages principales.

- [ ] `scripts/hp-field-mutation-test.mjs`
  - Test terrain plus invasif.
  - Cree ou modifie des donnees de test dans le Supabase local HP.
  - A utiliser seulement en contexte de test, pas sur des donnees terrain reelles sans precaution.

- [ ] `frontend/scripts/repair-broken-qualifiers.mjs`
  - Audit ou reparation des qualifiees/qualifies mal hydrates.
  - Par defaut, `cloud-to-local` l'appelle en `--dry-run`.
  - La reparation est un secours, pas le chemin normal.

## Commandes A Retenir

Preparation avant evenement, Cloud -> HP :

```bash
./scripts/hp-ops.sh cloud-to-local --home
```

Audit rapide :

```bash
./scripts/hp-ops.sh healthcheck --home
```

Menu maison :

```bash
./event-box
```

Menu plage :

```bash
./beach
```

Lancer une Event Box Mac locale :

```bash
./scripts/start-surfjudging-field-mac.sh
```

Pousser un evenement HP local vers Cloud :

```bash
./scripts/hp-ops.sh local-to-cloud --field --event-id <ID>
```

Live sync HP -> Cloud :

```bash
./scripts/hp-ops.sh live-start --field --event-id <ID> --interval 10
```
