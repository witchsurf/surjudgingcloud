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
- IP typique du HP : `10.0.0.14`.
- C’est le profil recommandé pour préparer la box avant l’événement.

`field`

- Plage / routeur D-LINK.
- IP attendue du HP : `192.168.1.2`.
- C’est le profil recommandé pendant l’exploitation live.

## Commandes À Retenir

Préparer la box depuis le cloud, sans toucher au code :

```bash
./scripts/hp-ops.sh cloud-to-local --home
```

En profil maison, `hp-ops.sh` demande l’IP actuelle du HP dès le départ, car le routeur Home peut la réassigner après redémarrage. Le profil D-LINK/plage reste verrouillé sur `192.168.1.2`. On peut aussi forcer l’IP :

```bash
./scripts/hp-ops.sh upgrade --home --host 10.0.0.23
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
./scripts/hp-ops.sh healthcheck --home
```

## Accès SSH Depuis Un Nouveau Mac

Le HP utilise l’utilisateur SSH :

```text
admin-surfjudging
```

Le chemin recommandé est une connexion par clé SSH, sans dépendre du mot de passe Ubuntu.

### Option recommandée : ajouter la clé du nouveau Mac

Sur le nouveau Mac :

```bash
ssh-keygen -t ed25519 -C "surfjudging-new-mac"
cat ~/.ssh/id_ed25519.pub
```

Copier la ligne affichée, puis depuis un Mac qui a déjà accès au HP :

```bash
ssh admin-surfjudging@10.0.0.20 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
echo '<COLLER_LA_CLE_PUBLIQUE_DU_NOUVEAU_MAC>' | ssh admin-surfjudging@10.0.0.20 'cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Tester depuis le nouveau Mac :

```bash
ssh admin-surfjudging@10.0.0.20
```

En plage, remplacer l’IP par :

```bash
ssh admin-surfjudging@192.168.1.2
```

### Option rapide : transférer la clé existante

Si l’on veut que le nouveau Mac reprenne exactement l’accès actuel, copier depuis l’ancien Mac :

```text
~/.ssh/id_ed25519
~/.ssh/id_ed25519.pub
```

Puis sur le nouveau Mac :

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
ssh admin-surfjudging@10.0.0.20
```

Ne jamais envoyer la clé privée `id_ed25519` par email ou messagerie. Préférer AirDrop local, clé USB, ou migration macOS.

### Récupération Sudo Si Le Mot De Passe Est Perdu

Si SSH fonctionne encore et que `admin-surfjudging` est membre du groupe `docker`, on peut créer une exception sudo temporaire via Docker pour réinitialiser le mot de passe.

État temporaire installé le 2026-07-11 :

```text
/etc/sudoers.d/90-admin-surfjudging-temp
admin-surfjudging ALL=(ALL) NOPASSWD:ALL
```

Après avoir défini un nouveau mot de passe avec :

```bash
sudo passwd admin-surfjudging
```

retirer l’exception temporaire :

```bash
sudo rm /etc/sudoers.d/90-admin-surfjudging-temp
sudo visudo -c
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
./scripts/hp-ops.sh cloud-to-local --home
```

Ce script :

- vérifie que le HP répond sur `10.0.0.14:8000`
- charge les variables Supabase
- copie les tables cloud utiles vers la base locale HP
- nettoie/remplace localement les données de ces événements pour garder la parité des IDs
- audite les hydratations de qualifiés en lecture seule
- lance un healthcheck final

Ce script ne fait pas :

- pas de build frontend
- pas de déploiement frontend
- pas de refresh Docker
- pas de migration stack sauf si elle existe déjà dans la base

### 3. Vérifier La Box

Après la sync :

```bash
./scripts/hp-ops.sh healthcheck --home
```

Puis ouvrir :

```text
http://10.0.0.14:8080
```

Vérifier dans `Mes événements` que l’événement est présent et que les heats sont chargés.

### 4. Exploitation Plage (Réseau D-LINK)

Sur la plage, le routeur D-LINK crée un réseau local sans internet. La box HP devient le serveur central (IP `192.168.1.2`).

#### A. Démarrer la stack logicielle
Allumer la box HP, puis dans le terminal :
```bash
./beach
```

URLs terrain (à distribuer aux juges et écrans) :
```text
Tablettes Juges : http://192.168.1.2:8080
Écran Public    : http://192.168.1.2:8080/display
```

Pendant l’événement, le HP local est l'unique source de vérité.

### 5. Choisir La Source De Vérité Avant Une Sync

Avant toute sync sur un événement déjà manipulé des deux côtés, décider explicitement quel côté est vrai.

#### Cas normal avant événement : Cloud -> HP

À utiliser quand le cloud contient la préparation officielle et que le HP ne contient pas encore de faits terrain à préserver.

```bash
./scripts/hp-ops.sh cloud-to-local --home --event-id <EVENT_ID>
```

Effet important : cette sync est un remplacement local pour l’événement ciblé. Le script supprime les lignes locales concernées puis réinsère les données Cloud pour garder la parité des IDs.

Ne pas utiliser sur un event déjà jugé sur le HP, sauf si l’on accepte d’écraser l’avancement local.

#### Cas normal après événement : HP -> Cloud

À utiliser quand le HP contient les faits terrain les plus vrais : scores, heats fermés, lineups corrigés, active heat, overrides.

```bash
./scripts/hp-ops.sh local-to-cloud --home --event-id <EVENT_ID>
```

Effet important : cette sync pousse un diff local vers le Cloud par upsert. Elle ne doit pas relancer la propagation des qualifiés, car les `heat_entries` terrain sont la source de vérité.

Avant d’écrire, faire un dry-run bas niveau si l’historique Cloud/HP est suspect :

```bash
cd frontend
node scripts/hp-push-db-to-cloud.mjs --event-id <EVENT_ID> --dry-run
```

#### Cas ambigu : les deux côtés ont divergé

Ne pas lancer une sync à l’aveugle. Comparer d’abord :

- nombre de scores par côté
- dernier `active_heat_pointer.updated_at`
- dernier `event_last_config.updated_at`
- statuts des heats (`open`, `running`, `closed`)
- lignes présentes seulement d’un côté (`scores`, `heat_slot_mappings`, `heat_judge_assignments`)

Règle pratique :

- Si le HP a plus de scores, plus de heats fermés, ou un round actif plus avancé : HP -> Cloud.
- Si le Cloud a la préparation officielle et le HP n’a pas encore servi au jugement : Cloud -> HP.
- Si le Cloud contient des tests récents mais peu de scores, et que le HP contient l’historique terrain complet : considérer le Cloud comme bruit de test et pousser le HP.

#### B. Installation Hardware (Panneaux Priorité & Horn)
Le module ESP32 a été rendu **100% autonome et Plug & Play**. 

**1. Connexion WiFi Automatique :**
Dès qu'il est allumé, l'ESP32 va chercher le réseau `DLINK`.
- S'il le trouve, il bascule **automatiquement** en mode local et va interroger la base Supabase de la box HP (`http://192.168.1.2:8000`) avec la clé locale.
- *Aucune reconfiguration de code n'est nécessaire entre la maison et la plage !*

**2. Checklist Électrique 24V :**
- **Câbles de Puissance :** Utiliser UNIQUEMENT du gros câble électrique (1.5mm² ou 2.5mm²) pour tout le circuit 24V (Batterie -> Relais -> Compresseur). *Les petits fils Arduino sont strictement interdits pour le klaxon sous peine de chute de tension (compresseur qui ronronne).*
- **Relais du Klaxon :** Le relais bleu Songle de l'ESP32 est un relais de "commande". S'il manque de puissance pour lancer le compresseur sec, il est recommandé d'utiliser un **Relais Automobile 24V 40A** (piloté par le petit relais bleu).
- **LEDs :** Les fils bleus et blancs vont sur les canaux IN3/IN4 des MOSFET. S'assurer que les shunts des puces L817 ne créent pas de court-circuit avec la masse.

#### C. Display Public (Live Sync 4G)

Le display public (`surfjudging.cloud/display`) est alimenté par le **Cloud Supabase**, pas par le HP local. Pour que les spectateurs distants voient les scores en temps réel, il faut un hotspot 4G.

1. Brancher un **hotspot 4G** (téléphone en partage de connexion) sur le réseau.
2. Dans le menu terrain, choisir **option 8 : 📡 Live Score Sync via 4G**.
3. Entrer l'`event_id` de la compétition en cours.
4. Le script synchronise le paquet live display vers le Cloud **toutes les 10 secondes** par défaut.
5. Pour arrêter : **option 9** du menu.

Chemin validé aujourd'hui : lancer le sync depuis le Mac opérateur, qui voit à
la fois le HP local et internet. Pour lancer directement depuis le HP en mode
USB/4G autonome, Node.js doit être installé sur le HP.

```bash
# Ou en ligne de commande directe :
./scripts/hp-live-sync.sh --event-id 17 &
```

Logs disponibles dans `infra/.live-sync.log`.
Statut live disponible dans `infra/.live-sync.status.json`.

Si pas de 4G disponible : les scores seront poussés en une seule fois après l'événement (option 7 du menu).

Voir `docs/cloudflare-display-hp.md` pour la documentation complète de l'architecture live sync.

### Mode hybride Realtime (anti-ralentissements)

Quand beaucoup d’écrans/clients ouvrent des websockets Realtime sur `scores`, Postgres peut passer beaucoup de temps dans `realtime.list_changes(...)` (symptôme: latence, CPU, “ralentissements Supabase”).

Stratégie recommandée :

- **Timer/config/active heat**: rester en Realtime (faible volume, critique pour l’UX).
- **Scores sur `/display`**: passer en **polling** (hybride) si charge/latence.
- **Listes de heats / lineups**: éviter les subscriptions Realtime non filtrées; préférer un stream `heats` (filtré `event_id`) et des triggers DB qui “touch” `heats.updated_at` quand `heat_entries` / `heat_slot_mappings` changent.

Variables (build frontend) :

```bash
# Désactive le realtime des scores côté Display (hybride)
VITE_DISPLAY_SCORE_MODE=polling

# Intervalle de polling Display en ms (cloud: 5000 recommandé)
VITE_DISPLAY_SCORE_POLL_MS=5000
```

Coupe-circuit (debug/urgence) :

```bash
# Force le polling pour tous les signaux heat (scores/interférences/participants)
VITE_HEAT_SIGNAL_MODE=polling
```

Pendant l’événement (LAN/HP), garder le mode normal sauf si on observe une saturation.

### 5. Retour Cloud Après Événement

Quand on veut remonter les données terrain :

```bash
./event-box
```

Puis choisir :

```text
Sync Field Box DB to Cloud
```

Le menu demande ensuite l'`event_id` à remonter, par exemple `17`. Le sync est volontairement borné à cet événement; il ne doit pas balayer toute la base HP sauf commande explicite `--all-events`.

Ce flux pousse les faits terrain :

- participants créés/corrigés sur le terrain
- lineup officiel des heats (`heat_entries`)
- overrides chef juge du lineup
- scores
- interférences
- statut/timer/config live des heats
- active heat pointer

Puis le cloud rejoue les fonctions métier de propagation des qualifiés.

### 7. Matrice De Source Par Écran

Règle simple d'exploitation:

| Écran / usage | Source principale | Fallback | Rôle |
|---|---|---|---|
| Admin HP | HP local Supabase | reload local / diagnostics | pilotage terrain, vérité métier |
| Tablettes juges | HP local Supabase | polling local si Realtime se dégrade | saisie score et timer |
| Display sur place | HP local Supabase | polling local | retour immédiat pour la salle |
| Display public distant | Cloud Supabase | polling cloud si Realtime est instable | diffusion pour les gens hors site |
| Mode offline total | HP local Supabase uniquement | aucun | continuité du jugement sans internet |

Règles d’or:

- Le HP local décide.
- Le Cloud reflète.
- Le sync 4G diffuse, il ne pilote pas.
- Si le réseau bouge, on dégrade l’affichage public, jamais le terrain.

En pratique:

- le terrain continue même sans 4G;
- le display public garde le dernier état utile si le cloud coupe;
- dès que le lien revient, la synchro rattrape le cloud;
- les tablettes et l’admin ne doivent jamais dépendre du display public pour juger.

Commande directe :

```bash
cd frontend
node scripts/hp-push-db-to-cloud.mjs --event-id 17
```

Audit sans écriture :

```bash
cd frontend
node scripts/hp-push-db-to-cloud.mjs --event-id 17 --dry-run
```

Important : le retour terrain utilise une clé service-role cloud (`SUPABASE_SERVICE_ROLE_KEY_CLOUD`) car l’événement peut appartenir à un autre compte organisateur. Sans cette clé, le cloud bloque correctement les écritures RLS.

### 6. Override Lineup Chef Juge

Dans Admin > Paramètres avancés > Lineup officiel du heat, le chef juge peut remplacer ou ajouter le surfeur officiel d'une couleur.

Cette action :

- met à jour `participants` si le nom n'existe pas encore
- met à jour `heat_entries` pour la position/couleur du heat
- met à jour la config live du heat pour que juges/display reprennent la nouvelle mouture
- journalise l'action dans `heat_entry_overrides`
- ne modifie pas les scores, qui restent attachés à la couleur de lycra

À utiliser pour les corrections terrain type inversion de noms, ajout manuel d'un meilleur deuxième, ou contournement propre d'un bug métier pendant le live.

## Définition Des Points D’entrée

### `./scripts/hp-sync-cloud-to-local.sh`

Point d’entrée recommandé pour préparer le prochain événement.

Action :

- Cloud Supabase -> HP Supabase local.
- Audite les qualifiés cassés en lecture seule par défaut.
- Healthcheck final.

Options :

```bash
./scripts/hp-sync-cloud-to-local.sh --home
./scripts/hp-sync-cloud-to-local.sh --field
./scripts/hp-sync-cloud-to-local.sh --home --repair-qualifiers
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
- récupère événements, participants, heats, entries, overrides lineup, mappings, configs, timers, juges, scores et interférences
- supprime localement les lignes concernées
- réinsère les données cloud dans le HP

À lancer directement seulement pour debug.

### `frontend/scripts/repair-broken-qualifiers.mjs`

Répare uniquement la base Supabase.

Action :

- détecte des heats qui ont une structure/mapping cassé
- reconstruit l’hydratation des qualifiés
- gère la logique de snaking et meilleur deuxième

À utiliser directement seulement en mode secours, si l’audit signale des heats cassés ou si des heats suivants affichent `BYE`/slots vides alors que les scores existent.

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
- audit qualifiés
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

La réparation des qualifiés ne fait pas partie du chemin normal. Si le fix métier est bon, l’audit doit retourner `0` heat cible. On ne lance une réparation qu’en secours explicite :

```bash
./scripts/hp-sync-cloud-to-local.sh --home --repair-qualifiers
```


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
