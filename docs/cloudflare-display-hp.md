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
│        (toutes les 30s)          │                      │
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
3. Le script `hp-live-sync.sh` tourne en arrière-plan et **pousse les scores vers le Cloud** toutes les 30 secondes.
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

# Avec un intervalle personnalisé (60 secondes)
./scripts/hp-live-sync.sh --event-id 17 --interval 60 &

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
```

## Prérequis

1. Le HP doit pouvoir atteindre internet (via hotspot 4G relié au DLINK ou en USB).
2. Les variables `SUPABASE_SERVICE_ROLE_KEY_CLOUD` et `VITE_SUPABASE_URL_CLOUD` doivent être définies dans `frontend/.env.local`.
3. Le script `hp-push-db-to-cloud.mjs` doit pouvoir joindre le HP local ET le Cloud simultanément.

## Robustesse

- **Erreurs réseau :** Si le Cloud est inaccessible (coupure 4G), le script retente au cycle suivant. Après 5 erreurs consécutives, il fait une pause de 2 minutes puis reprend.
- **Arrêt propre :** Le script intercepte SIGTERM/SIGINT pour se fermer proprement. L'option 0 (Quit) du menu arrête aussi le sync s'il tourne.
- **Diff intelligent :** Seules les lignes modifiées sont poussées vers le Cloud (pas de full-sync inutile).
- **Pas d'impact sur le HP :** Le sync est en lecture seule côté local. Aucune donnée terrain n'est modifiée.

## Sans 4G (fallback)

Si aucun hotspot 4G n'est disponible pendant l'événement :

1. L'événement se déroule normalement en LAN pur.
2. Après l'événement, connecter le HP à internet.
3. Utiliser l'**option 7** du menu (Sync one-shot) pour pousser toutes les données terrain vers le Cloud en une seule fois.
