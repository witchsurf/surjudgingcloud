# P2.5.6g — Heat Status & Planning Safety Characterization

## Résultat exécutif

Conclusions obligatoires :

- **STATUS_DIVERGENT**
- **PLANNING_DESTRUCTIVE**

Aucun correctif fonctionnel, payload, contrainte, migration SQL ou comportement n'a été modifié pendant cette caractérisation. P2.5.7 n'a pas commencé.

Deux modèles de statut coexistent :

- `heats.status`, statut métier/lifecycle du heat ;
- `heat_realtime_config.status`, statut opérationnel du timer et du flux Realtime.

Ils emploient des valeurs communes mais ne possèdent plus la même contrainte. Le code et certaines RPC continuent à écrire `open` dans `heats`, alors que le schéma reconstruit et la stack locale réelle le refusent.

Le planning est destructif par conception actuelle : la RPC supprime les heats ciblés avant de les recréer. La suppression d'un heat cascade notamment vers les scores et les interférences. Les logs `score_overrides`, eux, n'ont pas de clé étrangère et peuvent rester orphelins.

# Partie A — Statuts de heat

## Matrice canonique observée

Dans la colonne « accepté DB », `H` signifie `heats.status` et `R` signifie `heat_realtime_config.status`.

| Statut | Utilisé/produit par le frontend | Accepté DB actuelle | Produit par SQL/RPC | Attendu/interprété par l'UI | Transitions observées |
|---|---|---|---|---|---|
| `planned` | Seulement filtre de `deletePlannedHeats` | H: **non** ; R: **non** | Aucun producteur courant trouvé | Aucun état UI spécifique | Référence legacy sans transition réalisable sous les CHECK actuels |
| `open` | Planning bulk, rejudge admin, réparation de parent score, mocks/fallbacks et modèles legacy | H: **non** ; R: **oui** | `activate_heat_on_podium` tente `waiting -> open`; plusieurs anciennes fonctions de transition produisent `open` | Souvent traité comme « non fermé » ou ramené à `waiting`; anciens types `Heat` attendent `open/closed` | `waiting -> open` à l'activation ; `closed -> open` lors du rejudge client, actuellement refusé par H |
| `waiting` | `createHeat` normalise `open -> waiting`; valeur par défaut/reset Realtime; générateur alternatif | H: oui ; R: oui | défaut de `upsert_heat_realtime_config`; fonctions historiques préparent le prochain heat en `waiting` | Timer prêt/non démarré ; scoring bloqué par trigger Realtime | création/reset -> `waiting`; activation SQL tente ensuite `open`; timer start -> R `running` |
| `running` | Timer start et abonnements Realtime | H: oui ; R: oui | RPC/config Realtime accepte `running`; aucune activation courante ne force directement H à `running` | LIVE, timer actif, scoring autorisé | R `waiting/paused -> running`; H peut être `running` via écritures historiques/directes |
| `paused` | Timer pause et reprise | H: oui ; R: oui | RPC Realtime accepte `paused` | Timer en pause, scoring autorisé | R `running -> paused -> running` |
| `finished` | Expiration timer/webhook juge | H: oui ; R: oui | fonctions historiques et Realtime produisent `finished` | Overlay normalise `finished` en état terminé ; scoring reste autorisé jusqu'au close officiel | R `running/paused -> finished`; fermeture officielle -> `closed` |
| `closed` | Fermeture, protections UI, sélection du prochain heat, affichage terminé | H: oui ; R: oui | `close_heat_on_podium` met H et R à `closed` | État final/protégé ; exclu comme prochain heat ; scoring bloqué | tout état prêt à fermer -> H/R `closed`; rejudge tente `closed -> H open` et `R waiting` |

## Sources frontend et branches UI

### `open`

Producteurs directs identifiés :

- `api/modules/heats.api.ts:createHeatsWithEntries` crée chaque heat bulk avec `status: 'open'` ;
- `AdminInterface` rejudge écrit directement `heats.status='open'` et reflète `open` dans ses séquences locales ;
- `ScoreRepository.ensureHeatRowsExist` auto-crée un parent heat manquant avec `status: 'open'` ;
- `AdminPage` et `useHeatManager` construisent des heats avec `open`, mais le chemin `useSupabaseSync.createHeat` traduit cette valeur en `waiting` avant persistance ;
- `useHeat` utilise `open` dans son modèle simulé ;
- `heatReadParsers` remplace trois statuts absents/non textuels par `open` ;
- certains types legacy de `lib/supabase.ts` exposent encore seulement `open | closed`.

Branches UI dépendantes :

- `useHeatManager` considère tout statut autre que `closed` comme candidat ;
- `AdminInterface` utilise explicitement `open` pour réinitialiser la protection de fermeture/rejudge ;
- l'overlay ne connaît pas `open` comme état propre : toute valeur non `running/paused/finished/closed` devient `waiting` ;
- `deletePlannedHeats` sélectionne `open` comme supprimable ;
- les parsers historiques rendent `open` en cas de donnée partielle, même si ce statut n'est plus insérable dans H.

### `waiting`

Producteurs :

- normalisation `open -> waiting` dans `useSupabaseSync.createHeat` ;
- `utils/heatGenerator.ts` produit `waiting` ;
- création/fallback de `heat_realtime_config` utilise `waiting` par défaut ;
- reset timer/rejudge place R à `waiting` ;
- anciennes fonctions de transition placent les heats suivants à `waiting`.

Branches UI : timer prêt mais non démarré, overlay en attente, store de jugement et types Realtime. Le trigger de scoring consulte R et bloque explicitement la saisie en `waiting`.

### `running`

Producteurs : démarrage timer/Reatime (`useRealtimeSync`, `TimerRepository`, RPC de configuration). La stack locale contient actuellement 16 heats H et 12 configs R au statut `running`.

La RPC actuelle `activate_heat_on_podium` ne transforme pas H en `running`; elle tente seulement `waiting -> open` et marque `is_active=true`. Le passage opérationnel à `running` est principalement porté par R.

### `planned`

Aucun insert, générateur, RPC ou contrainte courante ne produit/accepte `planned`. Il reste uniquement dans la sélection de suppression `['planned', 'open']`. Après validation du CHECK courant, une ligne H `planned` ne peut pas être créée normalement.

### `paused`, `finished`, `closed`

`paused` et `finished` appartiennent principalement au timer/Reatime. Le trigger de scoring les autorise encore. `closed` est le verrou sportif final : la RPC atomique l'écrit dans H et R, désactive `is_active`, propage/rebuild les qualifiés et bloque ensuite le scoring.

## Schéma versionné, stack locale et types générés

### Historique contradictoire

1. Migration initiale 2025-09 : H accepte seulement `open/closed`; R accepte `waiting/running/paused/finished`.
2. Snapshot distant 2025-11 : H devient `waiting/running/paused/finished/closed`; `open` disparaît.
3. `init_judging` contient encore une création H `open/closed`, mais `CREATE TABLE IF NOT EXISTS` ne remplace pas la table déjà créée.
4. Migration de réparation 2026-03-29 réaffirme pour H et R les cinq valeurs sans `open`.
5. Migration 2026-04-18 ajoute `open` **uniquement à R**.
6. Des migrations RPC postérieures continuent néanmoins à lire ou produire `open` dans H, notamment `activate_heat_on_podium` en juillet 2026.

Le schéma reconstruit depuis les migrations aboutit donc à :

- H : `waiting`, `running`, `paused`, `finished`, `closed` ;
- R : `waiting`, `running`, `paused`, `finished`, `closed`, `open`.

### Stack locale réelle

Inspection directe :

```text
heats_status_check:
  waiting, running, paused, finished, closed

heat_realtime_config_status_check:
  waiting, running, paused, finished, closed, open
```

Le test réel P2.5.6f a atteint `bulk_upsert_heats` et a échoué avec `23514 heats_status_check` sur la valeur `open`. L'événement temporaire a été supprimé ; aucun reliquat n'existe.

La RPC locale `activate_heat_on_podium` contient actuellement :

```sql
status = case when status = 'waiting' then 'open' else status end
```

Elle est donc elle-même incompatible avec le CHECK H lorsqu'elle active un heat `waiting`. Une activation d'un heat déjà `running` ne tente pas cette conversion, ce qui peut masquer la divergence sur certains événements existants.

### Types Supabase générés

`supabase.generated.ts` expose les colonnes `status` comme `string`, sans union ou enum contraignant. Le typage généré ne détecte donc aucune incompatibilité entre `open` et le CHECK SQL.

Les types frontend sont eux-mêmes divisés :

- anciens heats : `open | closed` ou `string` ;
- Realtime/kiosk : `waiting | running | paused | finished`, parfois étendu à `closed` ;
- plusieurs DTO repository restent volontairement `string`.

## Vues, triggers et RPC

- `v_current_heat` expose H tel quel, sans normalisation.
- `v_heat_lineup` ne filtre pas sur le statut.
- les vues de scores/manquants reposent sur les relations heat/config, pas sur une conversion de statut.
- `trg_sync_heat_status` copie chaque changement H vers R. Un statut accepté par H doit donc également être accepté par R ; R accepte actuellement toutes les valeurs de H.
- `trg_audit_heat_status` journalise les changements H.
- `upsert_heat_realtime_config` produit `waiting` par défaut et accepte les statuts fournis dans la limite du CHECK R.
- `close_heat_on_podium[_strict]` produit `closed` dans les deux tables.
- `bulk_upsert_heats` reprend sans normalisation le statut fourni par le JSON frontend.

# Partie B — Destructivité du planning

## Mécanisme exact

Avant la RPC, `createHeatsWithEntries` calcule `p_delete_ids` :

- `overwrite=false` : IDs du bracket nouvellement généré ;
- `overwrite=true` : **tous** les IDs H existants du couple événement/catégorie, sans filtre de statut.

La RPC `bulk_upsert_heats` à cinq arguments exécute explicitement :

1. delete `heat_slot_mappings` ;
2. delete `heat_entries` ;
3. delete `heat_realtime_config` ;
4. delete `heats` ;
5. insert/upsert participants, heats, mappings et entries ;
6. recréation d'une config Realtime minimale ;
7. le client upsert ensuite `heat_configs`.

La stack locale possède également une surcharge legacy à quatre arguments qui dérive toujours ses suppressions des IDs de `p_heats`. Les deux signatures sont destructives.

## Cascades réelles lors du delete H

| Table | Suppression explicite RPC | Cascade depuis `heats` | Résultat |
|---|---:|---:|---|
| `heat_slot_mappings` | oui | oui | supprimée |
| `heat_entries` | oui | oui | supprimée |
| `heat_realtime_config` | oui | pas de FK observée | supprimée explicitement |
| `heats` | oui | objet parent | supprimée puis éventuellement recréée |
| `heat_configs` | non | oui | supprimée, puis recréée par le client seulement après succès RPC |
| `heat_judge_assignments` | non | oui | supprimée et **non recréée** par le planning bulk |
| `heat_history` | non | oui | supprimée et non recréée |
| `heat_timers` | non | oui | supprimée et non recréée |
| `interference_calls` | non | oui | supprimée et non recréée |
| `scores` | non | oui | supprimée et non recréée |
| `score_overrides` | non | **aucune FK** | survit, avec `heat_id/score_id` potentiellement orphelins |

Autres références sans FK observées : `active_heat_pointer`, `competition_audit_log`, `heat_entry_overrides` et `score_deletions`. Elles ne sont pas supprimées par la RPC et peuvent conserver des références vers un ancien heat recréé ou supprimé.

## Scénarios demandés

| Scénario | IDs supprimés | Effets explicites | Effets cascade / résiduels |
|---|---|---|---|
| A. Événement vide | `overwrite=true`: liste vide ; `false`: nouveaux IDs inexistants | Aucun ancien mapping/entry/R/H à supprimer | Création échoue actuellement sur H `open`; aucune donnée sportive ancienne touchée |
| B. Bracket existant sans scores | `false`: collisions d'IDs nouveaux ; `true`: tous les heats de la catégorie | mappings, entries, R, H supprimés | configs, assignments, history, timers et autres dépendances supprimés ; pas de scores à perdre |
| C. Bracket existant avec scores | mêmes règles | mêmes deletes explicites | **scores supprimés en cascade** ; override logs peuvent survivre orphelins |
| D. `overwrite=false`, IDs identiques | IDs nouvellement générés, donc exactement les collisions | le heat existant est supprimé avant réinsertion malgré `false` | mêmes cascades, y compris scores/interférences/assignments ; `overwrite=false` n'est pas non destructif |
| E. `overwrite=true`, heat `running` | inclus, car aucun filtre de statut | heat actif supprimé avec R, mappings, entries | scores, interférences, panel, timer, historique supprimés ; pointeur actif peut rester référent sans FK |
| F. `overwrite=true`, heat `closed` | inclus, car aucun filtre de statut | heat fermé supprimé | archive sportive relationnelle supprimée par cascades ; logs sans FK persistent éventuellement |
| G. `interference_calls` existants | dès que le heat parent est ciblé | aucun delete client direct | supprimés par `ON DELETE CASCADE` |
| H. judge assignments existants | dès que le heat parent est ciblé | aucun delete client direct | supprimés par `ON DELETE CASCADE`, non recréés par le bulk planning |

La RPC est transactionnelle : si l'insertion du nouveau heat échoue sur `status='open'`, les suppressions exécutées dans **cet appel RPC** sont annulées avec la transaction. En revanche, l'upsert participants effectué par le client avant la RPC est une requête distincte et peut déjà avoir modifié les participants. L'upsert `heat_configs` intervient après la RPC et peut échouer séparément après que le bracket a été remplacé.

## Garde-fous UI réellement présents

### `GenerateHeatsPage`

- vérifie event ID, preview non vide et présence de participants ;
- affiche un bouton générique « Confirmer et écrire dans la base » ;
- appelle systématiquement le repository avec `overwrite: true` ;
- ne lit pas les statuts existants ;
- ne cherche ni scores, ni interférences, ni assignments, ni timer ;
- n'affiche aucune confirmation renforcée liée à des données sportives existantes.

Ce chemin peut donc cibler silencieusement des heats `running` ou `closed`.

### `ParticipantsStructure`

- exige une preview, un événement et une catégorie ;
- expose une checkbox « Écraser les heats planifiés existants de cette catégorie », désactivée par défaut ;
- ne vérifie pas le statut réel des heats ni la présence de données sportives ;
- n'affiche pas d'inventaire de ce qui sera supprimé ;
- ne demande pas de confirmation renforcée au clic final.

La checkbox donne une impression de sécurité trompeuse : avec `overwrite=false`, les IDs nouvellement générés sont tout de même transmis à `p_delete_ids`, donc les heats existants portant les mêmes IDs sont supprimés.

## `deletePlannedHeats` et `open`

La fonction sélectionne H avec `status IN ('planned','open')`.

Sous le schéma courant :

- aucune nouvelle ligne `planned` ou `open` ne peut être insérée/validée ;
- la validation du CHECK empêche normalement des lignes historiques invalides de subsister ;
- la stack locale ne contient actuellement que des H `running` ;
- la fonction ne sélectionnera donc en pratique aucun heat courant avec ces statuts.

Elle peut seulement supprimer `open/planned` sur un ancien schéma permissif, une base ayant perdu/désactivé le CHECK, ou pendant une dérive de schéma. Sur la stack courante cohérente avec les migrations, cette opération est fonctionnellement presque morte.

# Partie C — Propositions sans implémentation

## A. Cohérence des statuts

### Option A1 — Canoniser H sur `waiting/running/paused/finished/closed`

Changements futurs requis :

- planning : produire `waiting` au lieu de `open` ;
- `ScoreRepository` : créer un parent manquant en `waiting` ou refuser cette réparation selon décision séparée ;
- rejudge : écrire H `waiting`, pas `open` ;
- `activate_heat_on_podium` : ne plus produire `open`; décider si l'activation conserve `waiting` jusqu'au timer ou passe H à `running` ;
- parsers/types/UI : remplacer le fallback `open` et traiter explicitement les cinq états ;
- retirer `open/planned` des sélections lorsque la compatibilité historique n'est plus requise.

Évaluation :

| Critère | Évaluation |
|---|---|
| Risque terrain | Moyen pendant migration, faible après parité complète |
| Compatibilité historique | Nécessite mapping de lecture `open -> waiting` pour anciens dumps |
| SQL | Oui pour modifier les RPC ; pas forcément pour le CHECK déjà correct |
| Cloud/HP | Déploiement coordonné indispensable pour éviter des versions mixtes |
| Rollback | Réactiver le mapping/les anciennes RPC ; difficile si versions mélangées |
| Données existantes | Backfill éventuel de H `open`; R peut temporairement conserver `open` |

C'est la cible conceptuellement la plus cohérente : H devient un vrai lifecycle à cinq états et R reste le miroir/timer.

### Option A2 — Réautoriser `open` dans H

Ajouter `open` au CHECK H et documenter sa sémantique (« préparé/activable »), sans changer immédiatement les producteurs existants.

Évaluation :

| Critère | Évaluation |
|---|---|
| Risque terrain | Faible à court terme : rétablit planning, rejudge et activation existants |
| Compatibilité historique | Forte, conforme aux anciens clients/dumps |
| SQL | Oui, migration CHECK |
| Cloud/HP | Migration requise sur les deux avant ou avec le frontend actuel |
| Rollback | Retirer `open` exige d'abord un backfill et l'arrêt de tous les producteurs |
| Données existantes | Aucun changement nécessaire pour les cinq statuts actuels |

Cette option est la correction opérationnelle la plus petite, mais elle maintient deux synonymes potentiels `open/waiting` et reporte la clarification métier.

### Option A3 — Migration de compatibilité en deux temps (recommandée)

1. Ajouter temporairement `open` à H sur Cloud et HP pour restaurer la compatibilité immédiate.
2. Introduire un type canonique partagé et une télémétrie locale des producteurs.
3. Migrer frontend/RPC vers `waiting` et les transitions décidées.
4. Backfill contrôlé `open -> waiting`.
5. Retirer `open` du CHECK lors d'une phase ultérieure seulement après preuve qu'aucun producteur ne subsiste.

Évaluation : risque terrain le plus faible, compatibilité maximale, mais deux migrations SQL et une période transitoire plus longue. Rollback simple à l'étape 1 ; après retrait final, rollback nécessite de réautoriser `open`.

Décision métier encore nécessaire : H doit-il passer à `running` au démarrage du timer, ou rester un statut d'orchestration distinct tandis que R porte seul le timer ?

## B. Sécurité du planning

### Option B1 — Blocage serveur des données sportives (recommandée)

Créer une RPC de planning sûre ou durcir `bulk_upsert_heats` afin de refuser toute suppression d'un heat contenant au moins : score, override, interférence, timer démarré/historique, statut `running/paused/finished/closed`, ou activité/pointeur. Retourner un inventaire explicite des blockers.

| Critère | Évaluation |
|---|---|
| Risque terrain | Faible après tests ; protège même un ancien frontend |
| Compatibilité historique | Les remplacements auparavant autorisés deviennent bloqués |
| SQL | Oui, RPC/validation atomique |
| Cloud/HP | Même migration obligatoire sur les deux |
| Rollback | Réactiver l'ancienne RPC, avec retour du risque destructif |
| Données existantes | Aucun backfill ; les données deviennent des garde-fous |

Cette option doit distinguer « remplacer un bracket jamais utilisé » de « réparer un événement sportif commencé ».

### Option B2 — Autoriser seulement des statuts préparatoires

Limiter côté RPC les suppressions à `waiting` (et éventuellement `open` pendant compatibilité), en refusant `running/paused/finished/closed`. Ajouter en plus une vérification de présence de scores/interférences, car un heat au mauvais statut peut déjà contenir des données.

Risque moyen : plus simple, mais le statut seul n'est pas une preuve suffisante d'absence de données sportives. SQL requis pour une garantie atomique.

### Option B3 — Confirmation opérateur renforcée uniquement

Afficher avant écriture les heats, statuts et nombres de scores/interférences/assignments qui seraient supprimés, puis exiger une phrase de confirmation.

Risque élevé si utilisée seule : concurrence, ancien client, erreur opérateur et absence de contrôle atomique. Aucun SQL strictement requis, rollback trivial, mais cette option ne constitue pas une garantie terrain. Elle peut compléter B1/B2.

### Option B4 — Versionner au lieu de supprimer

Créer une nouvelle version de bracket/heat IDs, conserver les heats sportifs historiques et basculer explicitement le pointeur vers la version nouvelle. Ne supprimer que les drafts jamais utilisés lors d'un nettoyage séparé.

Risque terrain faible pour les données, compatibilité et complexité élevées. Nécessite schéma, RPC, adaptation Cloud/HP, vues et UI. Rollback facile tant que les anciennes versions restent intactes, mais la progression/qualification doit devenir consciente des versions.

### Séquence de sûreté proposée

1. Ne plus présenter `overwrite=false` comme non destructif tant que `p_delete_ids=newHeatIds` subsiste.
2. Ajouter une lecture de préflight opérateur, informative seulement dans un premier lot.
3. Implémenter B1 atomiquement côté DB avec refus des données sportives.
4. Ajouter la confirmation renforcée B3 pour les drafts réellement remplaçables.
5. Étudier B4 séparément si la régénération après début de compétition est un besoin métier réel.

## Arbitrages requis avant correction

1. Sémantique officielle de H lors de l'activation et du démarrage timer : `waiting`, `open` ou `running`.
2. Compatibilité à maintenir avec les dumps/clients historiques contenant `open`.
3. Définition exacte d'un heat « jamais utilisé » : absence de scores seulement, ou également absence d'interférences, overrides, timer, historique, panel et audit.
4. Autorisation éventuelle de régénérer un heat `closed` — recommandation : interdiction absolue hors outil de réparation séparé et audité.
5. Traitement futur des `score_overrides` et autres logs sans FK lors d'une suppression autorisée.

## Validation de la caractérisation

- Inventaire statique du frontend, API, repositories, hooks/stores, tests et migrations effectué.
- Contraintes, données, RPC, triggers, vues et clés étrangères vérifiés en lecture seule sur Supabase local.
- Aucun scénario destructif n'a été exécuté sur une compétition existante.
- Les essais temporaires antérieurs sont nettoyés : zéro événement P2.5.6f résiduel.
- Aucun fichier applicatif ou SQL n'a été modifié dans P2.5.6g ; seul ce rapport a été produit.

## Conclusion finale

**STATUS_DIVERGENT** : les producteurs `open`, la RPC d'activation et le CHECK actuel de `heats` sont incompatibles. Les types générés ne détectent pas cette divergence.

**PLANNING_DESTRUCTIVE** : `overwrite=true` supprime toute la catégorie, `overwrite=false` supprime tout de même les IDs en collision, et les cascades atteignent les scores, interférences, panels, timers et historiques. Les overrides peuvent rester orphelins.

Aucune poursuite vers P2.5.7 ne doit avoir lieu avant arbitrage explicite de ces deux risques.
