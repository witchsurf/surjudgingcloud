# Rapport des tests d'intégration P0

Date d'exécution : 5 août 2026.

## Conclusion

Les cinq scénarios ont été exécutés contre une stack Supabase CLI locale isolée, créée sur `127.0.0.1:54321`/`54322` avec le `project_id` `backend`. Les migrations de `backend/supabase/migrations` ont été appliquées depuis une base vide. Aucun hôte HP, aucune adresse terrain, aucune base cloud et aucune donnée de compétition réelle n'ont été utilisés.

- Quatre scénarios passent sans réserve fonctionnelle.
- Le dump restaure les cinq compteurs métier à l'identique, mais `pg_restore` termine avec des avertissements sur des policies qui référencent le schéma Supabase `auth`, absent de la base PostgreSQL cible nue.
- Toutes les fixtures P0, la base de restauration, les fichiers temporaires, les conteneurs Supabase et leurs volumes ont été supprimés après exécution.
- Aucun code métier, règle de scoring, migration, configuration Electron ou composant SQLite n'a été modifié.

Harness reproductible : `scripts/p0-integration-tests.mjs`.

## Environnement

- Supabase CLI 2.111.0.
- Supabase PostgreSQL 17.6.1.037 en conteneur Colima/Docker.
- Client PostgreSQL/`pg_dump`/`pg_restore` 17.10.
- Docker CLI 29.7.1, moteur Docker 29.5.2, Compose 5.4.0, Colima 0.10.3.
- Stack réduite : base, API/PostgREST, Auth, Realtime, Storage, Kong et Meta ; Studio et services non nécessaires exclus.

Commande d'exécution, une fois la stack locale démarrée :

```bash
node scripts/p0-integration-tests.mjs
```

Le harness génère un suffixe aléatoire, écrit ses fichiers dans un dossier `mkdtemp`, crée une base `p0_restore_*`, et limite son nettoyage aux identifiants qu'il vient de créer.

## Scénario 1 — perte d'accusé réseau

### Méthode

1. Création d'un événement, d'un heat démarré, de son `heat_realtime_config` et de trois affectations de juges.
2. Envoi d'une note ROUGE/J1/vague 1 avec un UUID de mutation stable via `upsert_score_secure`, donc commit serveur réel.
3. Simulation de la perte d'accusé : le client conserve exactement la même mutation dans la WAL.
4. Rejeu de la mutation avec le même UUID par la même RPC.
5. Comptage physique et comptage de la clé métier heat/lycra/vague/station.

### Résultat

**PASS** — une ligne physique et une ligne métier après rejeu.

Le mécanisme est idempotent parce que `upsert_score_secure` fait `ON CONFLICT (id) DO UPDATE` et que la WAL conserve l'UUID original.

### Limite

Une nouvelle mutation représentant la même intention mais possédant un **nouvel UUID** ne serait pas arrêtée par une contrainte métier : `scores` n'a pas de contrainte unique sur heat/lycra/vague/station. L'idempotence dépend donc du maintien de l'identifiant de mutation lors des retries.

## Scénario 2 — refresh avec WAL en attente

### Méthode

1. Sérialisation d'une mutation J2 dans un stockage persistant temporaire représentant le contenu IndexedDB de la tablette.
2. Abandon de l'instance cliente initiale.
3. Relecture de la mutation par une nouvelle instance simulée.
4. Rejeu vers la vraie RPC Supabase, acquittement, puis vidage du stockage.

### Résultat

**PASS** — une ligne serveur et zéro opération en attente après acquittement.

### Limite

Le redémarrage de processus est simulé par une nouvelle lecture du payload sérialisé. Les tests unitaires couvrent séparément le coordinateur et son verrou ; ce scénario ne lance pas Safari/Chrome avec le véritable moteur IndexedDB ni une mise en veille physique de tablette.

## Scénario 3 — override de lineup et invariant lycra

### Méthode

1. Une note J1 et une note J2 existent pour `surfer='ROUGE'`.
2. La position 1/ROUGE référence initialement le premier participant.
3. Appel réel de `admin_override_heat_entry` pour remplacer ce participant par un second participant.
4. Relecture de `heat_entries`, `participants` et `scores`.

### Résultat

**PASS** — la position ROUGE référence le participant remplaçant ; les deux scores restent `ROUGE` et aucun score n'est déplacé vers un autre lycra.

L'invariant documenté dans `AGENTS.md` est respecté par la RPC actuelle.

## Scénario 4 — reprise du timer après refresh

### Méthode

1. Écriture réelle via `upsert_heat_realtime_config` d'un timer `running`, durée 20 minutes et timestamp serveur.
2. Création d'un état local obsolète : arrêté, durée 4 minutes.
3. Simulation du reload : lecture de `heat_realtime_config` via PostgREST avec la clé anon réellement utilisée par le client terrain.
4. Comparaison de l'état REST avec l'état local obsolète.

### Résultat

**PASS** — PostgREST restitue `running`, 20 minutes, le timestamp serveur et `updated_by=p0_integration`. L'état local à 4 minutes ne remplace pas l'état serveur.

### Observation de privilèges

La première tentative du harness utilisait la clé `service_role` et recevait HTTP 403. L'audit des grants montre :

- `anon` : `SELECT` autorisé ;
- `authenticated` : `SELECT` autorisé ;
- `service_role` : aucun grant explicite sur `heat_realtime_config`.

Ce n'est pas bloquant pour le frontend actuel, qui lit avec la clé anon, mais un futur outil serveur utilisant `service_role` devrait soit bénéficier d'un grant explicite, soit utiliser une connexion PostgreSQL privilégiée. Aucun grant n'a été ajouté pendant P0.

## Scénario 5 — dump, checksum et restauration

### Méthode

1. Fixture contrôlée : 1 événement, 1 heat, 2 scores, 1 correction et 3 lignes `heat_judge_assignments`.
2. `pg_dump --format=custom --schema=public --no-owner --no-privileges`.
3. Création d'un SHA-256, puis vérification par `shasum -a 256 -c`.
4. Création d'une seconde base PostgreSQL locale `p0_restore_*`.
5. `pg_restore`, puis comparaison SQL des cinq compteurs.
6. Suppression de la base restaurée et du dump temporaire.

Le schéma courant ne contient pas de table `public.judges`. Le compteur « juges » demandé est donc celui des affectations effectivement utilisées par le runtime : `public.heat_judge_assignments`.

### Résultat données

**PASS avec avertissements** — compteurs strictement identiques :

| Table/mesure | Source | Restaurée |
|---|---:|---:|
| `events` | 1 | 1 |
| `heats` | 1 | 1 |
| `scores` | 2 | 2 |
| `score_overrides` | 1 | 1 |
| `heat_judge_assignments` | 3 | 3 |

SHA-256 de la campagne finale : `a0c730d9d3b923a6cf2f15227f71d76cfbf558a7a1ca591f8c00a6876411a9eb`.

### Avertissement de restauration

`pg_restore` retourne le code 1 avec 18 erreurs de création de policies faisant référence à `auth.uid()` parce que la base cible est une base PostgreSQL nue du même cluster et ne possède pas le schéma plateforme `auth`. Les tables et données `public` nécessaires aux cinq vérifications sont néanmoins restaurées et leurs compteurs sont identiques.

Une tentative préalable de dump global avait aussi rencontré des objets internes `realtime` et `vault` non restaurables par le rôle local `postgres` (`log_min_messages`, `vault.secrets`). Elle a été abandonnée et nettoyée.

### Modification nécessaire avant de déclarer la restauration terrain complète

Le dump actuel est suffisant pour valider les données métier contrôlées, mais pas encore pour certifier une reconstruction complète de toute la plateforme Supabase. Il faut choisir et tester une procédure opérateur parmi :

1. provisionner d'abord une stack Supabase vierge de version compatible, appliquer les migrations, puis restaurer uniquement les données métier ; option recommandée ;
2. ou définir un dump/restore complet exécuté avec les rôles internes et privilèges exacts de la stack HP.

La procédure devra échouer si `pg_restore` retourne un code non nul, puis vérifier davantage que des compteurs : clés étrangères, RPC essentielles, RLS, Realtime et ouverture effective de l'application. Aucune modification de sauvegarde n'est faite dans cette phase.

## Nettoyage vérifié

Avant l'arrêt de la stack, les requêtes de contrôle ont retourné zéro pour :

- événements `P0 INTEGRATION p0_%` ;
- heats `P0-p0_%` ;
- scores liés à ces heats ;
- timers liés à ces heats ;
- bases `p0_restore_%`.

`supabase stop --workdir backend --no-backup` a ensuite supprimé les conteneurs et volumes de développement du projet `backend`. Colima reste installé et démarré, mais ne contient plus la stack Supabase P0.

## Décision P0 proposée

Les comportements WAL, refresh, invariant lycra et reprise timer sont suffisamment caractérisés pour clôturer leur partie P0. La restauration doit rester un point ouvert du registre de risques tant qu'une restauration sans avertissement dans une stack Supabase fraîche et fonctionnelle n'a pas été démontrée.
