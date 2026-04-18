# HP Operations Runbook

Ce document décrit le workflow complet autour du HP ProDesk, appelé ici `Event Box`.

Objectif :
- préparer l’événement à la maison quand Internet est disponible
- partir à la plage avec un HP autonome en LAN
- éviter les manipulations ambiguës entre réseau maison et réseau D-LINK

## Réseaux

Il y a 2 contextes réseau différents pour le même HP :

- `home`
  - réseau maison
  - IP typique : `10.0.0.28`
  - usage : préparation, maintenance, debug, déploiement

- `field`
  - réseau D-LINK sur la plage
  - IP fixée dans le routeur : `192.168.1.2`
  - usage : exploitation live sans Internet

Règle importante :
- `field` est le profil par défaut pour les opérations terrain
- `home` doit être choisi explicitement

## Commandes à retenir

Entrées simples au root du repo :

```bash
./event-box
./beach
./home
```

Signification :
- `./event-box`
  - ouvre le menu de préparation maison
  - profil `home`

- `./beach`
  - ouvre le menu d’exploitation plage
  - profil `field`

- `./home`
  - équivalent menu `home`
  - utile si tu veux garder la logique “home” explicite

Commandes directes utiles :

```bash
./scripts/field-ops.sh
./scripts/field-ops.sh --home
./scripts/hp-healthcheck.sh
./scripts/hp-deploy-frontend.sh
./scripts/hp-refresh-stack.sh
```

## Workflow standard

### 1. À la maison : préparer l’Event Box

Flux recommandé :

1. Travailler dans le cloud
   - créer l’event
   - ajouter les participants
   - générer les heats
   - vérifier les configs

2. Ouvrir le menu maison :

```bash
./event-box
```

3. Lancer la préparation de la box
   - healthcheck si besoin
   - déploiement frontend HP
   - refresh stack locale si nécessaire

4. Ouvrir le HP en mode local et vérifier `Mes événements`
   - la base locale doit être remplie
   - en mode local, l’app tente maintenant une synchro cloud -> local automatiquement
   - condition : une session cloud valide existe déjà

Résultat attendu :
- le HP contient déjà tout ce qu’il faut avant de partir
- sur la plage, on n’a pas besoin de “dépendre du cloud” pour démarrer

### 1 bis. Remonter la production terrain vers le cloud

Quand des scores ont été saisis localement sur la box et qu’on veut réaligner le cloud :

1. ouvrir le menu :

```bash
./event-box
```

2. lancer :
- `Sync Field Box DB to Cloud`

Ce bouton pousse depuis la base locale vers le cloud :
- `scores`
- `interference_calls`
- `heat_realtime_config`
- `active_heat_pointer`

Puis il déclenche côté cloud :
- propagation des qualifiés sur les heats fermés
- rebuild par division pour sécuriser les rounds suivants

Règle métier importante :
- on ne considère pas `heat_entries` qualifiés comme une vérité brute à copier
- on pousse les faits source terrain
- puis on recalcule les qualifiés côté cloud

### 2. Sur la plage : exploitation live

Commande recommandée :

```bash
./beach
```

Ce mode vise `192.168.1.2`.

Usage attendu :
- admin, juges, display, kiosques pointent vers le HP
- le HP devient la source de vérité terrain
- pas besoin d’Internet pour opérer

URLs typiques sur place :

- app locale :
```text
http://192.168.1.2:8080
```

- display local :
```text
http://192.168.1.2:8080/display
```

- API locale :
```text
http://192.168.1.2:8000/rest/v1/events?select=id&limit=1
```

### 3. Retour maison / maintenance

Commande recommandée :

```bash
./home
```

ou directement :

```bash
./scripts/field-ops.sh --home
```

Usage :
- vérifier que le HP répond bien sur `10.0.0.28`
- redéployer le frontend
- auditer la stack
- faire du debug sans toucher au réseau plage

## Ce que fait chaque outil

### `./scripts/hp-healthcheck.sh`

Audit rapide du HP :
- ping
- SSH
- ports `8080` et `8000`
- état Docker
- réponse web locale
- réponse API locale
- alignement du bundle local/public

Utilisation :

```bash
./scripts/hp-healthcheck.sh
SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh
```

### `./scripts/hp-deploy-frontend.sh`

Déploie uniquement le frontend sur le HP :
- build local
- rsync de `frontend/dist/`
- injection dans le conteneur `surfjudging`
- reload `nginx`
- vérification du bundle servi

Utilisation :

```bash
./scripts/hp-deploy-frontend.sh
SURF_HP_PROFILE=home ./scripts/hp-deploy-frontend.sh
```

### `./scripts/hp-refresh-stack.sh`

Refresh la stack locale HP :
- synchronise les fichiers `infra/` et SQL nécessaires
- relance les services Supabase locaux utiles
- applique les patchs SQL locaux
- redémarre `rest` et `kong`

Utilisation :

```bash
./scripts/hp-refresh-stack.sh
SURF_HP_PROFILE=home ./scripts/hp-refresh-stack.sh
```

### `./scripts/field-ops.sh`

Version non interactive “one-click” :
- préflight réseau
- optionnellement refresh stack
- déploiement frontend
- healthcheck final

Exemples :

```bash
./scripts/field-ops.sh
./scripts/field-ops.sh --home
./scripts/field-ops.sh --field --full-stack
```

### `./scripts/field-menu.sh`

Version interactive du workflow :
- choix du profil
- one-click ops
- healthcheck
- deploy frontend
- refresh stack
- photocopy cloud -> local
- sync local -> cloud

## Sync cloud -> local

La logique cible est :

1. à la maison, tu prépares l’événement dans le cloud
2. le HP récupère ces données dans sa base locale
3. sur la plage, le HP fonctionne en autonomie

Le comportement actuel a été simplifié :
- en mode local, `MyEvents` peut lancer automatiquement la synchro cloud -> local
- cette auto-sync ne tente rien si aucune session cloud valide n’existe
- elle sert de filet de sécurité et de confort

Règle d’exploitation :
- la sync cloud sur la plage ne doit pas être le workflow normal
- le workflow normal est de partir avec une Event Box déjà prête

## Sync local -> cloud

La logique cible est :

1. la box locale produit les données terrain
2. un bouton explicite pousse ces données vers le cloud
3. le cloud rejoue ensuite la logique métier de propagation

Ce flux est volontairement asymétrique :
- `cloud -> local` pour la structure et la préparation
- `local -> cloud` pour les faits terrain les plus récents

Cela évite une “fusion magique” fragile entre bases.

## Ce qu’il faut retenir techniquement

- Le HP n’est pas traité comme un poste de dev Git.
- La vérité de déploiement frontend sur le HP est un artefact `dist`.
- Pour savoir si le HP est “à jour”, on regarde ce qu’il sert, pas `git status`.

Donc :
- mise à jour HP -> `hp-deploy-frontend.sh`
- audit HP -> `hp-healthcheck.sh`
- réparation stack -> `hp-refresh-stack.sh`

## Procédure de récupération

Si quelque chose sent mauvais :

1. lancer :

```bash
./scripts/hp-healthcheck.sh
```

2. si le frontend semble en retard :

## Checklist HP serveur

Le HP est un serveur local. Son écran branché n’est pas un indicateur fiable de santé applicative.

Ce qu’on accepte comme normal sur l’écran du HP :
- console Ubuntu
- logs Docker
- prompt `login:`

Cela ne veut pas dire que le HP est en panne.

### HP serveur OK

Depuis un poste du réseau maison :

```bash
ping 10.0.0.28
curl -I http://10.0.0.28:8080
curl "http://10.0.0.28:8000/rest/v1/events?select=id&limit=1"
```

Le HP est considéré `OK` si :
- le ping répond
- `:8080` renvoie `200 OK`
- `:8000` renvoie du JSON

### HP serveur KO

Le HP est considéré `KO` si :
- pas de ping
- ou le frontend local ne répond pas sur `:8080`
- ou l’API locale ne répond pas sur `:8000`

### Règle d’exploitation

- écran console sur le HP : acceptable
- pas de réseau / pas de web / pas d’API : incident réel

### Test complet recommandé

```bash
ping 10.0.0.28
curl -I http://10.0.0.28:8080
curl "http://10.0.0.28:8000/rest/v1/events?select=id&limit=1"
curl "http://10.0.0.28:8000/rest/v1/heats?select=id&limit=1"
```

### Si un test échoue

1. vérifier que le HP est allumé
2. vérifier qu’il est bien connecté au bon réseau
3. lancer :

```bash
SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh
```

```bash
./scripts/hp-deploy-frontend.sh
```

3. si la stack locale semble cassée :

```bash
./scripts/hp-refresh-stack.sh
```

4. relancer un healthcheck

## Résumé ultra court

- maison : `./event-box`
- plage : `./beach`
- audit : `./scripts/hp-healthcheck.sh`
- frontend HP : `./scripts/hp-deploy-frontend.sh`
- stack HP : `./scripts/hp-refresh-stack.sh`
