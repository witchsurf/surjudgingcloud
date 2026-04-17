# HP Operations Runbook

Ce mémo donne la procédure la plus sûre pour garder le HP aligné avec `main` et vérifier rapidement la stack plage.

## Profils réseau HP

- `field` -> `192.168.1.2`
  - réseau D-LINK sur la plage
  - IP fixée dans le routeur
- `home` -> `10.0.0.28`
  - réseau maison avec Internet

Les scripts ci-dessous utilisent désormais le profil `field` par défaut.
Tu peux surcharger avec:

```bash
SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh
SURF_HP_HOST=10.0.0.42 ./scripts/hp-healthcheck.sh
```

## 1. Vérifier l’état du HP

```bash
./scripts/hp-healthcheck.sh
```

Ce script contrôle:
- ping/ports SSH, web, API
- conteneurs Docker critiques
- réponse de `http://HP:8080`
- réponse de `http://HP:8000/rest/v1/events`
- alignement du bundle servi localement et publiquement sur `display.surfjudging.cloud`

## 1bis. One-click ops

Commande recommandée:

```bash
./scripts/field-ops.sh
./scripts/field-menu.sh
```

Comportement:
- profil `field` par défaut (`192.168.1.2`)
- préflight réseau
- déploiement frontend sur le HP
- healthcheck final

Exemples:

```bash
./scripts/field-ops.sh
./scripts/field-ops.sh --home
./scripts/field-ops.sh --field --full-stack
./scripts/field-menu.sh
```

## 2. Déployer le frontend sur le HP

```bash
./scripts/hp-deploy-frontend.sh
```

Ce script:
- build le frontend localement
- rsync la `dist/` vers le HP
- injecte la `dist/` dans le conteneur `surfjudging`
- recharge `nginx`
- vérifie que le bundle servi sur le HP correspond bien au bundle local

## 3. Refresh stack locale HP

```bash
./scripts/hp-refresh-stack.sh
SURF_HP_PROFILE=home ./scripts/hp-refresh-stack.sh
```

Par défaut, le profil utilisé est `field`, donc `192.168.1.2`.

## 4. Sync cloud -> base locale

Le comportement a été simplifié côté UI:
- en mode local, `MyEvents` tente maintenant une synchronisation automatique cloud -> base locale
- condition: une session cloud valide existe déjà
- déclenchement: base locale vide ou sync jugée périmée

Ce que ça évite:
- oublier de cliquer sur `Sync depuis Cloud`
- démarrer la régie avec une base locale vide alors que la session cloud est déjà là

## 5. Réalité actuelle à retenir

- Le HP ne contient pas un repo Git exploité comme un poste de dev.
- Le frontend du HP est un artefact (`dist`) injecté dans le conteneur `surfjudging`.
- Pour le rendre fiable, il faut traiter le HP comme une cible de déploiement d’artefacts.

Donc:
- pour mettre à jour le HP, préférer `./scripts/hp-deploy-frontend.sh`
- pour auditer, préférer `./scripts/hp-healthcheck.sh`
- ne pas supposer qu’un `git status` sur le HP est une source de vérité

## 6. Si quelque chose sent mauvais

Ordre conseillé:

1. `./scripts/hp-healthcheck.sh`
2. `./scripts/hp-deploy-frontend.sh`
3. Re-test UI
4. Si la stack locale HP semble bancale: `./scripts/hp-refresh-stack.sh`
