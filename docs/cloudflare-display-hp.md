# Display Public — Live Sync via 4G

Ce document décrit comment le display public (`surfjudging.cloud/display`) est alimenté en temps réel pendant un événement sur la plage, sans dépendre d'un tunnel Cloudflare.

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│ PLAGE (réseau DLINK)                                    │
│                                                         │
│  HP Box (192.168.1.2)         Hotspot 4G                │
│  ├── Supabase locale (:8000)     │                      │
│  ├── Frontend LAN (:8080)        │                      │
│  └── hp-live-sync.sh ───────────►│                      │
│        (toutes les 10s par défaut)│                      │
│                                  │                      │
│  Tablettes juges                 │                      │
│  http://192.168.1.2:8080         │                      │
│                                  │                      │
│  ESP32 Priorité + Horn           │                      │
│  → API locale via WiFi DLINK     │                      │
└──────────────────────────────────┼──────────────────────┘
                                   │
                              ─────┼───── Internet ──────
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │ Supabase Cloud       │
                        │ (xwaymumbk...)       │
                        │                      │
                        │ scores, heats,       │
                        │ participants, etc.   │
                        └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │ surfjudging.cloud    │
                        │ /display             │
                        │                      │
                        │ 📱 Spectateurs       │
                        └──────────────────────┘
```

## Principe

1. Le HP reste la **source de vérité** pendant l'événement (réseau DLINK local).
2. Un hotspot 4G (téléphone en partage de connexion) est branché au réseau.
3. Le script `hp-live-sync.sh` tourne en arrière-plan et **pousse le paquet live display vers le Cloud** toutes les 10 secondes par défaut.
4. Le display public (`surfjudging.cloud/display`) lit les données depuis le Cloud Supabase et se met à jour automatiquement.

## Utilisation

### Depuis le menu terrain

```bash
./beach
# ou
./event-box
```

Puis choisir :
- **Option 8** : 📡 Live Score Sync via 4G (start)
- **Option 9** : ⏹  Live Score Sync via 4G (stop)

### En ligne de commande directe

```bash
# Démarrer en arrière-plan
./scripts/hp-live-sync.sh --event-id 17 &

# Avec un intervalle personnalisé (30 secondes si la 4G est fragile)
./scripts/hp-live-sync.sh --event-id 17 --interval 30 &

# Arrêter
kill $(pgrep -f hp-live-sync.sh)
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `scripts/hp-live-sync.sh` | Boucle de sync en arrière-plan |
| `frontend/scripts/hp-push-db-to-cloud.mjs` | Moteur de sync (diff + upsert) |
| `frontend/.env.local` | Clés Supabase (Cloud + Local) |

## Logs

Les logs de la sync live sont écrits dans :

```text
infra/.live-sync.log
infra/.live-sync.status.json
```

## Modes De Lancement

- **Mac opérateur recommandé aujourd'hui :** le Mac doit voir le HP local (`10.0.0.14` à la maison ou `192.168.1.2` plage) et internet. C'est le chemin validé.
- **HP autonome USB/4G :** possible si Node.js est installé sur le HP, car `hp-live-sync.sh` lance `frontend/scripts/hp-push-db-to-cloud.mjs`.

## Prérequis

1. Le HP doit pouvoir atteindre internet (via hotspot 4G relié au DLINK ou en USB).
2. Les variables `SUPABASE_SERVICE_ROLE_KEY_CLOUD` et `VITE_SUPABASE_URL_CLOUD` doivent être définies dans `frontend/.env.local`.
3. Le script `hp-push-db-to-cloud.mjs` doit pouvoir joindre le HP local ET le Cloud simultanément.
4. Node.js doit être disponible sur la machine qui lance `hp-live-sync.sh`.

## Robustesse

- **Paquet display complet :** le live sync pousse les tables nécessaires au display cloud: `events`, `heats`, `participants`, `heat_entries`, `heat_slot_mappings`, `event_last_config`, `heat_realtime_config`, `active_heat_pointer`, `scores`, `score_overrides`, `interference_calls` et les overrides de lineup.
- **Erreurs réseau :** Si le Cloud est inaccessible (coupure 4G), le script retente au cycle suivant. Après 5 erreurs consécutives, il fait une pause de 2 minutes puis reprend.
- **Anti double-lancement :** un verrou local empêche de lancer deux live syncs sur le même HP.
- **Observabilité :** `infra/.live-sync.status.json` donne l’état courant (`running`, `degraded`, `backoff`, `stopped`), le PID, le cycle et le dernier résultat.
- **Arrêt propre :** Le script intercepte SIGTERM/SIGINT pour se fermer proprement. L'option 0 (Quit) du menu arrête aussi le sync s'il tourne.
- **Diff intelligent :** Seules les lignes modifiées sont poussées vers le Cloud (pas de full-sync inutile).
- **Pas d'impact sur le HP :** Le sync est en lecture seule côté local. Aucune donnée terrain n'est modifiée.

## Sans 4G (fallback)

Si aucun hotspot 4G n'est disponible pendant l'événement :

1. L'événement se déroule normalement en LAN pur.
2. Après l'événement, connecter le HP à internet.
3. Utiliser l'**option 7** du menu (Sync one-shot) pour pousser toutes les données terrain vers le Cloud en une seule fois.

## Lecture Opérationnelle Simple

Pour éviter toute ambiguïté, la répartition recommandée est la suivante :

- **HP local** : admin, juges, timer, clôture de heat, vérité terrain.
- **Cloud** : display public distant et diffusion pour les spectateurs hors site.
- **Sync 4G** : transport asynchrone des faits terrain vers le cloud.

Le display public ne doit jamais devenir une source de pilotage pour le terrain. Si le cloud ralentit, on dégrade seulement la diffusion distante, pas le jugement local.

Comportement runtime par défaut :

- sur un host LAN / HP, le display garde un comportement plus direct en realtime;
- sur le display public distant, les scores passent par défaut en polling pour réduire la charge et stabiliser l’affichage;
- ces modes restent surchargés par `VITE_DISPLAY_SCORE_MODE` et `VITE_DISPLAY_SCORE_POLL_MS` si l’opérateur veut forcer un autre profil.
