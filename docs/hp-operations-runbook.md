# HP Operations Runbook

Ce mémo décrit les points d’entrée pour exploiter le HP ProDesk, appelé ici `Event Box`.

## Idée Directrice

Le test grandeur nature a validé que le code local servi par le HP est solide. Pour le prochain événement, le flux normal ne doit donc plus toucher au code ni à la stack Docker sauf besoin explicite.

Le workflow recommandé devient :

1. Préparer l’événement dans le cloud.
2. Copier la base Cloud Supabase vers la base Supabase locale du HP.
3. Partir à la plage avec le HP autonome.
4. Après l’événement, pousser les faits terrain locaux vers le cloud.

En clair : si le code n’a pas changé, on ne déploie pas le frontend. Si la stack HP répond, on ne refresh pas Docker.

## Profils Réseau

`home`

- Maison / maintenance.
- IP typique du HP : `10.0.0.28`.
- C’est le profil recommandé pour préparer la box avant l’événement.

`field`

- Plage / routeur D-LINK.
- IP attendue du HP : `192.168.1.2`.
- C’est le profil recommandé pendant l’exploitation live.

## Commandes À Retenir

Préparer la box depuis le cloud, sans toucher au code :

```bash
./scripts/hp-sync-cloud-to-local.sh --home
```

Menu maison :

```bash
./event-box
```

Menu plage :

```bash
./beach
```

Audit rapide :

```bash
SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh
```

## Workflow Recommandé Prochain Événement

### 1. Préparer Dans Le Cloud

Dans l’app cloud :

- créer l’événement
- ajouter les participants
- générer les heats
- vérifier les divisions, rounds, heat sizes et couleurs
- vérifier que l’événement est propre côté admin

### 2. Photocopier Cloud Vers HP

Depuis le Mac, connecté à Internet et au réseau où le HP répond :

```bash
./scripts/hp-sync-cloud-to-local.sh --home
```

Ce script :

- vérifie que le HP répond sur `10.0.0.28:8000`
- charge les variables Supabase
- copie les tables cloud utiles vers la base locale HP
- nettoie/remplace localement les données de ces événements pour garder la parité des IDs
- répare les hydratations de qualifiés si nécessaire
- lance un healthcheck final

Ce script ne fait pas :

- pas de build frontend
- pas de déploiement frontend
- pas de refresh Docker
- pas de migration stack sauf si elle existe déjà dans la base

### 3. Vérifier La Box

Après la sync :

```bash
SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh
```

Puis ouvrir :

```text
http://10.0.0.28:8080
```

Vérifier dans `Mes événements` que l’événement est présent et que les heats sont chargés.

### 4. Exploitation Plage

Sur le réseau D-LINK :

```bash
./beach
```

URLs terrain :

```text
http://192.168.1.2:8080
http://192.168.1.2:8080/display
http://192.168.1.2:8000/rest/v1/events?select=id&limit=1
```

Pendant l’événement, le HP local est la source de vérité.

### 5. Retour Cloud Après Événement

Quand on veut remonter les données terrain :

```bash
./event-box
```

Puis choisir :

```text
Sync Field Box DB to Cloud
```

Ce flux pousse les faits terrain :

- scores
- interférences
- statut/timer/config live des heats
- active heat pointer

Puis le cloud rejoue les fonctions métier de propagation des qualifiés.

## Définition Des Points D’entrée

### `./scripts/hp-sync-cloud-to-local.sh`

Point d’entrée recommandé pour préparer le prochain événement.

Action :

- Cloud Supabase -> HP Supabase local.
- Répare les qualifiés cassés si besoin.
- Healthcheck final.

Options :

```bash
./scripts/hp-sync-cloud-to-local.sh --home
./scripts/hp-sync-cloud-to-local.sh --field
./scripts/hp-sync-cloud-to-local.sh --home --skip-repair
./scripts/hp-sync-cloud-to-local.sh --home --skip-healthcheck
```

À utiliser quand :

- l’événement a été préparé dans le cloud
- le code HP est déjà bon
- on veut juste mettre à jour la base locale

À ne pas utiliser quand :

- le HP local ne répond plus sur `:8000`
- le frontend HP doit être mis à jour
- une migration ou un patch SQL local doit être appliqué

### `frontend/scripts/hp-photocopy-db.mjs`

Moteur bas niveau utilisé par `hp-sync-cloud-to-local.sh`.

Action :

- lit cloud et local Supabase
- récupère événements, participants, heats, entries, mappings, configs, timers, juges, scores et interférences
- supprime localement les lignes concernées
- réinsère les données cloud dans le HP

À lancer directement seulement pour debug.

### `frontend/scripts/repair-broken-qualifiers.mjs`

Répare uniquement la base Supabase.

Action :

- détecte des heats qui ont une structure/mapping cassé
- reconstruit l’hydratation des qualifiés
- gère la logique de snaking et meilleur deuxième

À utiliser après une sync si des heats suivants affichent `BYE` ou des slots vides alors que les scores existent.

### `./scripts/hp-healthcheck.sh`

Audit rapide, sans modification majeure.

Action :

- ping HP
- ports SSH, web `8080`, API `8000`
- état Docker
- réponse web locale
- réponse API locale
- comparaison bundle display local/public

À utiliser dès qu’on veut savoir si le HP est vivant.

### `./scripts/hp-deploy-frontend.sh`

Déploie le code frontend sur le HP.

Action :

- build local Vite
- rsync de `frontend/dist`
- copie dans le conteneur nginx `surfjudging`
- reload nginx
- vérifie que le bundle servi correspond au bundle buildé

À utiliser seulement quand le code frontend a changé et doit aller sur le HP.

### `./scripts/hp-refresh-stack.sh`

Opération lourde de maintenance.

Action :

- synchronise fichiers `infra/` et SQL
- relance les services Supabase locaux utiles
- applique les patchs SQL locaux
- redémarre `rest` et `kong`

À utiliser seulement si :

- l’API locale ne répond plus
- une migration/patch SQL local doit être appliqué
- la stack Docker du HP est suspecte

Ce script n’est pas le workflow normal de préparation d’un événement.

### `./scripts/field-ops.sh`

Ancien “one-click” plus large.

Action :

- préflight réseau
- refresh stack si nécessaire
- déploiement frontend
- réparation qualifiés
- healthcheck

À utiliser surtout pour une remise en état ou un déploiement complet, pas pour une simple préparation d’événement.

### `./scripts/field-menu.sh`

Menu interactif.

Options importantes :

- `Prepare Event Box` en profil `home` utilise maintenant le flux DB-only `hp-sync-cloud-to-local.sh --home`.
- `Photocopy Cloud DB to Field Box` utilise aussi le flux DB-only.
- `Deploy frontend only` reste disponible quand le code change.
- `Refresh local stack` reste disponible pour maintenance.

## Règle De Décision Simple

Si l’événement est prêt dans le cloud et que le code HP est bon :

```bash
./scripts/hp-sync-cloud-to-local.sh --home
```

Si le frontend a changé :

```bash
SURF_HP_PROFILE=home ./scripts/hp-deploy-frontend.sh
```

Si l’API HP est cassée :

```bash
SURF_HP_PROFILE=home ./scripts/hp-refresh-stack.sh
```

Si on ne sait pas :

```bash
SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh
```

## Résumé Ultra Court

- Préparer prochain event : `./scripts/hp-sync-cloud-to-local.sh --home`
- Menu maison : `./event-box`
- Menu plage : `./beach`
- Audit : `SURF_HP_PROFILE=home ./scripts/hp-healthcheck.sh`
- Code frontend HP : `SURF_HP_PROFILE=home ./scripts/hp-deploy-frontend.sh`
- Stack HP : `SURF_HP_PROFILE=home ./scripts/hp-refresh-stack.sh`
