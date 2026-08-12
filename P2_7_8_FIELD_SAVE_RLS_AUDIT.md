# SURFJUDGING — P2.7.8 — FIELD SAVE RLS BLOCKER AUDIT

## A. Reproduction

Audit réalisé le 11 août 2026 avec le Playwright MCP opérationnel sur `http://192.168.1.41:8080/admin?eventId=10`.

Contexte conservé :

```text
MAMELLES OPEN (event_id=10)
JUNIOR — Round 1 — Heat 1
J1 CHARLES
J2 J1MAIMOUNA
J3 JKHADIJA
ROUGE Babacar Sene
BLANC Mouhamed Diawara
JAUNE Buye Assane Gueye
```

La session MCP contenait déjà l'unique clic `SAVE` contrôlé de P2.7.7. Le bouton était ensuite `SAUVEGARDÉE` et désactivé. Aucun second clic n'a été forcé : le journal réseau complet, les corps de requête, les réponses, la console et le stockage local de cette reproduction unique étaient encore disponibles.

État UI après l'échec : `Podium A prêt · panel enregistré · JUNIOR R1H1 diffusé`, `configSaved=true`, bouton `START` actif. Aucun score n'a été saisi.

## B. Network request order

Ordre pertinent observé :

```text
#163 POST /rpc/set_podium_judge_panel                         200
#165 POST /rpc/activate_heat_on_podium                       200

SAVE :
#174 GET  /events?name=ilike.MAMELLES+OPEN                   200
#175 GET  /heat_configs?heat_id=in.(mamelles_open_junior...) 200
#176 GET  /heat_judge_assignments?...                        200
#178-182 lectures heat/entries/runtime/status                 200
#183 PATCH /events?id=eq.10                                  401
#185-186 lectures runtime/status                              200
#187 POST /heats?on_conflict=id                              401
#188 POST /heat_configs?on_conflict=heat_id                  401
#189-191 lectures lineup/participants/interférences           200
```

Absences confirmées pendant `SAVE` :

```text
/rpc/upsert_heat_config_runtime   NOT CALLED
/rpc/upsert_event_last_config     NOT CALLED dans la branche AdminPage
heat_judge_assignments direct     NOT REACHED pendant SAVE
heat_entries write                NOT REACHED pendant SAVE
```

Il n'existe qu'un seul `POST heat_configs` dans cette reproduction. Il s'agit de l'écriture runtime elle-même, pas d'un snapshot événement ni d'une réparation offline.

Console :

```text
events: permission denied for table events
heats: new row violates row-level security policy for table "heats"
heat_configs: permission denied for table heat_configs
```

## C. PATCH events source

Chaîne exacte du code actuellement servi :

```text
AdminInterface.handleSaveConfig
→ AdminPage.handleConfigSaved(true, podium A)
→ updateEventConfiguration(event_id=10, ...)
→ events.api.ts
→ supabase.from('events').update(...).eq('id', 10)
```

Payload capturé :

```json
{
  "name": "MAMELLES OPEN",
  "categories": ["BENJAMIN", "CADET", "JUNIOR", "MINIME", "ONDINE OPEN", "ONDINE U16", "OPEN"],
  "judges": [
    {"id":"J1","name":"CHARLES","identityId":"5164895e-51e9-42f2-9583-80a3e36cc435"},
    {"id":"J2","name":"J1MAIMOUNA","identityId":"442df135-52cb-4037-895f-5a174de825ca"},
    {"id":"J3","name":"JKHADIJA","identityId":"c724401b-46ba-4b3e-8227-d8c46110eb2e"}
  ],
  "config": {"competition":"MAMELLES OPEN","division":"JUNIOR","round":1,"heatId":1,"judges":["J1","J2","J3"],"surfers":["ROUGE","BLANC","JAUNE"],"waves":15,"tournamentType":"elimination"}
}
```

Ce PATCH persiste un miroir événement legacy très large (`name`, catégories, panel et config complète). Il n'est pas le snapshot canonique `event_last_config`. Dans `AdminPage`, il précède `saveEventConfigSnapshot`; comme les deux appels sont dans le même `try`, son 401 empêche l'appel de l'RPC étroit `upsert_event_last_config` dans cette branche. L'erreur est ensuite traitée comme secondaire et la chaîne heat continue.

Conclusion : l'échec du PATCH ne signifie pas à lui seul que la configuration du heat a échoué. Il s'agit de métadonnées/compatibilité événement, distinctes de `heat_configs` et des affectations officielles.

## D. POST heats source

Chaîne exacte :

```text
AdminPage.handleConfigSaved
→ useSupabaseSync.createHeat
→ HeatRepository.createRuntime
→ supabase.from('heats').upsert(..., onConflict='id')
```

Payload capturé :

```json
{
  "id":"mamelles_open_junior_r1_h1",
  "event_id":10,
  "competition":"MAMELLES OPEN",
  "division":"JUNIOR",
  "round":1,
  "heat_number":1,
  "status":"waiting",
  "created_at":"2026-08-11T20:58:11.113Z"
}
```

État DB avant/pendant l'audit, vérifié par `SELECT` :

```text
id          mamelles_open_junior_r1_h1
event_id    10
division    JUNIOR
round       1
heat_number 1
status      open
heat_size   3
color_order {RED,WHITE,YELLOW}
created_at  2026-08-10T21:00:46.034689Z
```

Le heat existe donc déjà grâce au planning. L'UPSERT n'est pas un simple `ensure exists` : s'il était autorisé, il pourrait remplacer `status=open` par `waiting` et réécrire `created_at`, tout en omettant `heat_size` et `color_order`. L'appel est un reliquat du mode runtime/legacy et n'est pas justifié pour un heat planifié existant.

Autre défaut confirmé dans le code source actuel : `useSupabaseSync.createHeat` capture et journalise l'erreur de `HeatRepository.createRuntime`, puis retourne tout de même un objet heat. Il ne garantit donc ni l'existence ni la mutation et ne respecte pas le test de propagation d'erreur lorsqu'il est utilisé réellement.

## E. POST heat_configs source

Chaîne exacte du bundle servi :

```text
AdminPage.handleConfigSaved
→ useSupabaseSync.saveHeatConfig
→ HeatRepository.saveConfiguration
→ HeatRepository.saveHeatConfig (bundle servi obsolète)
→ supabase.from('heat_configs').upsert(..., onConflict='heat_id')
```

Payload capturé :

```json
{
  "heat_id":"mamelles_open_junior_r1_h1",
  "judges":["J1","J2","J3"],
  "surfers":["ROUGE","BLANC","JAUNE"],
  "judge_names":{"J1":"CHARLES","J2":"J1MAIMOUNA","J3":"JKHADIJA"},
  "waves":15,
  "tournament_type":"elimination"
}
```

Réponses explicites :

```text
Is this the runtime heat config itself?       YES
Is it ensureEventLastConfigSnapshot?          NO
Is it another repository?                     NO — HeatRepository, mais ancienne implémentation servie
Is it required?                               YES comme donnée, NO comme écriture directe
Are there two heat_configs writes on SAVE?    NO
```

Le code source courant de `HeatRepository.saveHeatConfig` appelle bien `upsertRuntimeHeatConfig`, qui appelle `rpc('upsert_heat_config_runtime', ...)`. Le bundle Field courant construit dans `frontend/dist-field` contient aussi cet appel RPC et ne contient pas l'upsert direct. En revanche, le bundle réellement servi (`index-DxqD-br5.js`) contient encore `this.supabase.from("heat_configs").upsert(...)` dans `HeatRepository.saveHeatConfig`.

Cause confirmée : divergence de déploiement/bundle, pas régression du fichier TypeScript courant.

## F. Canonical save path

Contrat attendu d'après P2.7.4/P2.7.5 et le code source courant :

```text
Admin SAVE
│
├── lookup event                         lecture directe
├── event metadata mirror               direct table legacy/secondaire
├── event_last_config                    RPC upsert_event_last_config
├── legacy createRuntime                 direct table heats (à retirer du SAVE planifié)
├── runtime heat config                  RPC upsert_heat_config_runtime
├── official judge assignments           direct table heat_judge_assignments
├── lineup completion                     heat_entries / lectures + écritures ciblées
├── event snapshot podium A              RPC upsert_event_last_config
├── Realtime publication                 secondaire
└── local recovery snapshot              localStorage, après succès canonique seulement
```

Chemin réellement servi :

```text
Admin SAVE
│
├── PATCH events                         direct table → 401, avalé comme secondaire
├── createRuntime / UPSERT heats         direct table → 401, avalé dans useSupabaseSync
├── UPSERT heat_configs                  direct table → 401
├── heat_judge_assignments               non atteint
├── heat_entries                         non atteint
├── event snapshot repository            non atteint
├── Realtime publication                 exécutée seulement par l'ancien catch permissif
└── persistConfig/configSaved             local-only → faux succès
```

Les opérations `set_podium_judge_panel` et `activate_heat_on_podium` sont des RPC de sélection/podium antérieurs au clic SAVE. Elles ont réussi, mais ne remplacent pas `upsert_heat_config_runtime`.

## G. Duplicate/legacy paths

Inventaire des écritures de production trouvé par recherche de toutes les références `.from('events'|'heats'|'heat_configs')` (tests, backups et bundles générés exclus) :

### `events`

| Source | Écriture | Classification |
|---|---|---|
| `api/modules/events.api.ts:updateEventConfiguration` | UPDATE miroir config | admin runtime legacy ; problématique en Field |
| `repositories/EventRepository.ts:updateEventConfiguration` | même UPDATE | façade repository/duplication de l'API |
| `api/modules/events.api.ts:ensureEventExists` | INSERT si absent | fallback runtime legacy ; le chemin sécurisé moderne utilise `create_event_secure` |
| `pages/EventForm.tsx` | INSERT création événement | workflow création |
| `components/EventStatus.tsx` | INSERT fallback | legacy |
| `pages/ParticipantsStructure.tsx` | UPDATE `config` | administration structure participants |
| `api/modules/judges.api.ts` | UPDATE `judges` | miroir legacy du registre juges |
| `utils/syncCloudEvents.ts` | UPSERT batch | synchronisation opérationnelle Cloud → Field |
| pages paiement/participants | INSERT/UPDATE métier événement | Cloud/administration, hors SAVE heat |

### `heats`

| Source | Écriture | Classification |
|---|---|---|
| `HeatRepository.createRuntime` | UPSERT | runtime legacy ; responsable du 401 #187 |
| `HeatRepository.updateHeatStatus` | UPDATE | cycle de vie heat |
| `AdminInterface.handleRejudgeOverrideEnable` | UPDATE reopen | override chef juge |
| `ScoreRepository` | UPSERT heats manquants | réparation/compatibilité avant replay scores |
| `lib/supabase.ts` | INSERT heats absents | ancien helper/offline |
| `utils/syncCloudEvents.ts` | UPSERT batch | sync Cloud → Field |
| `api/modules/heats.api.ts` | DELETE legacy + RPC planning moderne | planning/réparation ; le chemin moderne est `bulk_upsert_heats_safe_v2` |
| hooks lifecycle | UPDATE/transition | clôture/progression legacy ou lecture selon occurrence |

### `heat_configs`

| Source | Écriture | Classification |
|---|---|---|
| code source courant `HeatRepository.saveHeatConfig` | aucune écriture directe ; RPC | canonique |
| `runtimeHeatConfig.api.ts` | RPC `upsert_heat_config_runtime` | canonique runtime |
| file offline `__heat_config_repair__` | replay via le même RPC | réparation offline encadrée |
| bundle servi `index-DxqD-br5.js` | UPSERT direct | obsolète ; responsable du 401 #188 |
| planning moderne | payload `heatConfigs` dans RPC safe v2 | planning atomique |

La présence du helper RPC et de l'ancien upsert direct dans le même bundle servi prouve un assemblage antérieur : le helper existe pour certains chemins/replays, mais `HeatRepository.saveHeatConfig` n'a pas encore été relié à lui dans ce build.

## H. Current RLS/grants

État runtime PostgreSQL Field, audit en lecture seule :

| Table | anon | authenticated | service_role | RLS |
|---|---|---|---|---|
| `events` | SELECT seulement | SELECT seulement | aucun grant direct observé | activée |
| `heats` | SELECT/INSERT/UPDATE grants, mais aucune policy write anon | idem grants ; policies write authenticated | aucun grant direct observé | activée |
| `heat_configs` | SELECT seulement | SELECT seulement | ALL | activée |

Conséquences :

- `events` : le 401 direct est intentionnel ; Field écrit via RPCs `SECURITY DEFINER` étroits.
- `heat_configs` : le retrait des droits directs est explicitement documenté dans les migrations `20260808160000`, `170000` et `180000`. L'RPC `upsert_heat_config_runtime` est la voie voulue.
- `heats` : les grants historiques anon existent encore, mais les policies n'autorisent pas l'écriture anon. Ajouter une policy large pour faire passer l'UPSERT serait contraire à la direction de sécurité.

RPCs vérifiés `SECURITY DEFINER`, owner `postgres`, exécutables par `anon` :

```text
upsert_heat_config_runtime
upsert_event_last_config
set_podium_judge_panel
activate_heat_on_podium
```

Verdict sécurité : ne pas accorder de droits directs supplémentaires à `anon` sur ces trois tables.

## I. Why configSaved remained true

**CONFIRMED — bundle servi antérieur au correctif P2.7.4.**

Dans le bundle réellement servi, `AdminPage.handleConfigSaved` :

1. appelle immédiatement `setConfigSaved(true)` ;
2. traite l'échec `events` comme une synchronisation secondaire ;
3. appelle `createHeat`, dont le hook avale déjà le 401 ;
4. capture l'échec `heat_configs` ;
5. ne repasse à `false` que pour les codes `23514` ou `23505` ;
6. pour `42501`, journalise `Heat créé en mode local uniquement`, puis exécute `persistConfig(config)`.

Le `localStorage` capturé confirme alors :

```text
surfJudgingConfigSaved = "true"
surf-judging-config.state.configSaved = true
surfJudgingConfig = configuration JUNIOR R1H1
```

Le correctif présent dans le fichier source non déployé remet `configSaved=false`, relance l'erreur vers `AdminInterface`, n'écrit le snapshot de récupération qu'après succès canonique et sépare la publication Realtime. Le rapport P2.7.7 n'était donc pas trompeur : le faux succès est réel sur le runtime servi.

## J. upsert_heat_config_runtime reached?

```text
NOT CALLED
HTTP status: N/A
request order relative to POST heat_configs: absent ; seul #188 direct a été émis
```

Le RPC existe dans la DB, possède `EXECUTE` pour `anon`, et son corps applique le garde Field/access. Il n'est simplement pas appelé par `HeatRepository.saveHeatConfig` dans le bundle servi.

## K. heat_judge_assignments reached?

Pendant le clic SAVE : **NOT REACHED**. L'ancien `saveHeatConfig` échoue sur son premier upsert `heat_configs` avant l'upsert des affectations et avant `heat_entries`.

Avant SAVE, l'RPC `set_podium_judge_panel` a écrit le panel avec succès. État DB actuel :

```text
J1 CHARLES    5164895e-51e9-42f2-9583-80a3e36cc435
J2 J1MAIMOUNA 442df135-52cb-4037-895f-5a174de825ca
J3 JKHADIJA   c724401b-46ba-4b3e-8227-d8c46110eb2e
```

Cela explique `3 affectation(s)` sans prouver que la chaîne SAVE canonique a réussi.

## L. Root cause

### CONFIRMED — runtime Field obsolète

Le conteneur sert `AdminPage-BL5iWTFl.js` et `index-DxqD-br5.js`. `HeatRepository.saveHeatConfig` y fait encore un upsert direct `heat_configs`. Le source courant et `frontend/dist-field` utilisent l'RPC officiel. C'est la cause immédiate du POST direct et du blocage canonique.

### CONFIRMED — faux succès déployé

Le bundle servi contient l'ancien catch permissif de `AdminPage`, qui avale `42501` et persiste localement. Les corrections P2.7.4 présentes dans le worktree ne sont pas dans le runtime.

### CONFIRMED — createHeat legacy inutile pour ce heat

Le heat planifié existe. L'UPSERT runtime est appelé inconditionnellement, n'est pas un simple test d'existence et porte un payload susceptible de régresser le statut et `created_at`.

### CONFIRMED — PATCH events secondaire mais mal ordonné

Le PATCH large est un miroir legacy. Son échec empêche l'RPC snapshot placé après lui dans le même `try`, même si l'échec est ensuite annoncé non bloquant.

### PROBABLE — dette plus large de coexistence runtime/planning

`createRuntime`, les helpers d'auto-création de heats et les réparations de scores gardent des écritures directes conçues avant le planning sûr. Leur suppression globale nécessite une caractérisation séparée ; seule leur utilisation dans Admin SAVE est ici prouvée obsolète.

### POSSIBLE — autres déploiements avec divergence équivalente

Les artefacts Cloud/Field et backups présents ne garantissent pas que chaque runtime actif correspond au source courant. Il faut vérifier les marqueurs de bundle pendant le déploiement P2.7.9.

## M. Minimal correction proposal

| Requête échouée | Classification | Correction minimale |
|---|---|---|
| `PATCH events?id=10` | **REMOVE DIRECT WRITE** du SAVE Field ; métadonnées **SECONDARY** | Ne pas mettre à jour le miroir `events.config/categories/judges` lors d'un SAVE heat Field. Appeler `upsert_event_last_config` indépendamment. Conserver l'édition événement dans son workflow dédié/Cloud si nécessaire. |
| `POST heats?on_conflict=id` | **REMOVE DIRECT WRITE** pour un heat planifié existant | Remplacer l'UPSERT par une lecture/validation d'existence. Si la création runtime ad hoc reste un besoin démontré, concevoir séparément un **NEW NARROW RPC REQUIRED**, sans écraser statut/created_at. |
| `POST heat_configs?on_conflict=heat_id` | **REPLACE WITH EXISTING RPC** | Déployer la version déjà présente dans le source : `upsert_heat_config_runtime`. Aucun grant table. |

Actions transverses :

1. intégrer et déployer les correctifs de propagation d'erreur déjà présents dans `AdminPage.tsx`/`AdminInterface.tsx` ;
2. faire rejeter `useSupabaseSync.createHeat` si ce helper reste utilisé, ou le retirer du SAVE planifié ;
3. ne considérer `configSaved=true` qu'après config RPC + affectations + entries + snapshot requis ;
4. conserver la publication Realtime comme secondaire ;
5. ne modifier ni ACL ni RLS pour masquer les appels legacy.

## N. Tests required before patch

### Caractérisation browser/intégration

```text
existing planning heat + Field anon + Admin SAVE
→ no PATCH events direct
→ no UPSERT heats direct
→ POST /rpc/upsert_heat_config_runtime = 2xx
→ heat_judge_assignments = 3/3
→ heat_entries cohérentes
→ upsert_event_last_config = 2xx pour podium A
→ configSaved=true uniquement à la fin
```

### Contrat d'échec

```text
upsert_heat_config_runtime échoue
→ aucune étape dépendante annoncée réussie
→ configSaved=false en store et localStorage
→ bouton non sauvegardé
→ erreur opérateur visible
→ aucune publication Realtime de faux succès
```

### Heat planifié

```text
heat existant status=open, created_at=T0
→ SAVE
→ aucun create/upsert heat
→ status=open et created_at=T0 inchangés
```

### Event metadata

```text
échec du miroir metadata éventuel
→ ne bloque pas l'RPC event_last_config
→ ne modifie pas le verdict de persistance canonique heat
```

### Déploiement

Ajouter un smoke qui inspecte le réseau réel et échoue si `POST /heat_configs?on_conflict=heat_id` ou `POST /heats?on_conflict=id` apparaît pendant SAVE d'un heat planifié. Vérifier aussi que le bundle servi contient `upsert_heat_config_runtime` dans l'implémentation active de `HeatRepository`, pas uniquement dans le code de replay.

## O. Files modified

```text
P2_7_8_FIELD_SAVE_RLS_AUDIT.md
```

Aucun code frontend, migration, ACL, RLS, RPC ou test n'a été modifié. Les modifications frontend préexistantes du worktree ont seulement été lues et comparées au bundle servi.

## P. Mamelles state

Vérification DB finale en lecture seule :

```text
event_id              10
active podium A       mamelles_open_junior_r1_h1
heat status            open
heat closed            NO
heat advanced          NO
heat scores            0
judge assignments      3/3
heat_configs existing  judges={J1,J2,J3}, judge_names={}
data cleaned            NO
scores changed          NO
```

Le court changement visuel du champ Organisateur tenté pour réactiver le bouton a été restauré immédiatement avant toute sauvegarde ; aucune requête d'écriture n'a été produite et la valeur finale reste `LARAISE`.

## Q. Recommendation

P2.7.9 doit être un chantier frontend + déploiement ciblé, sans changement ACL/RLS :

1. verrouiller par tests le SAVE Field d'un heat planifié existant ;
2. retirer `updateEventConfiguration` du chemin SAVE Field et appeler le snapshot RPC indépendamment ;
3. retirer l'appel `createHeat/createRuntime` du SAVE lorsque le heat planifié existe, avec erreur explicite si le heat attendu est absent ;
4. garantir l'utilisation de `upsert_heat_config_runtime` dans `HeatRepository.saveHeatConfig` ;
5. intégrer les corrections de faux succès P2.7.4 déjà présentes dans le worktree ;
6. rebuild et déployer l'artefact Field ;
7. vérifier le hash/nom du bundle réellement servi ;
8. rejouer une seule fois le workflow Mamelles JUNIOR R1H1, sans score, puis certifier réseau, DB, refresh et `configSaved`.

Verdict : **P277-02 est principalement un défaut de bundle Field non aligné avec le code corrigé, aggravé par deux écritures directes legacy encore présentes dans le chemin Admin SAVE. Aucun élargissement des droits anon n'est justifié.**
