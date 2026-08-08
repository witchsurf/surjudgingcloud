# P2.5.6a — Mutations heat non destructives

## Statut

Le sous-lot P2.5.6a est terminé sur les trois mutations autorisées :

- sauvegarde de configuration ;
- remplacement d'entries ;
- override d'une entry par le chef juge.

Activation, fermeture, propagation, active heat pointer, création/suppression de heats planifiés, timer, priorité et Realtime n'ont pas été migrés.

Aucun changement SQL, WAL score, scoring, Cloud↔HP, ESP32, route P1, `event-box` ou `beach` n'a été effectué.

## Contrats et repository

Le contrat heat expose maintenant :

- `saveConfiguration(heatId, HeatConfigurationRequest)` ;
- `replaceEntries(heatId, ReplaceHeatEntry[])` ;
- `overrideEntry(HeatEntryOverrideRequest)`.

`HeatRepository` implémente explicitement ce sous-contrat de mutation, séparément de son sous-contrat de lecture.

### saveConfiguration

La nouvelle méthode canonique délègue à la méthode legacy `saveHeatConfig`, restée disponible et inchangée. Le mapping camelCase → payload legacy est explicite :

- `eventId` → `event_id` ;
- `judgeNames` → `judge_names` ;
- `judgeIdentities` → `judge_identities` ;
- `surferNames` → `surfer_names` ;
- `surferCountries` → `surfer_countries` ;
- `tournamentType` → `tournament_type`.

Les tableaux sont copiés sans modification de leur contenu ou de leur ordre.

Le chemin nominal conserve l'ordre observé :

1. upsert `heat_configs` ;
2. upsert `heat_judge_assignments` si le panel n'est pas vide ;
3. garantie/réparation `heat_entries` ;
4. snapshot événement pour le podium A.

Le chemin offline conserve l'ordre :

1. opération `heat_configs` ;
2. opération `heat_judge_assignments` ;
3. opération technique `__heat_config_repair__`.

Les mêmes options `onConflict`, timestamps de queue, messages logger et mécanismes `BaseRepository.execute` sont utilisés.

### replaceEntries

`HeatRepository.replaceEntries` délègue à l'adaptateur historique `replaceHeatEntries`. Le seul mapping est :

- `participantId` → `participant_id`.

L'adaptateur conserve strictement son comportement : suppression des positions concernées dans `heat_entries`, puis insertion du payload existant. Il n'appelle aucune table score et ne modifie pas les scores attachés aux couleurs de lycra.

### overrideEntry

`HeatRepository.overrideEntry` délègue sans altération de la requête à `adminOverrideHeatEntry`, donc au RPC existant `admin_override_heat_entry`.

Le résultat snake_case du RPC est converti vers le DTO canonique. Aucun score, log de score ou fait de scoring n'est envoyé au repository. La couleur retournée, notamment `ROUGE`, reste l'identité sportive ; seuls le participant et ses métadonnées d'affichage peuvent changer.

Les erreurs de l'adaptateur sont propagées telles quelles.

## Consommateurs migrés

- `useSupabaseSync` utilise `saveConfiguration` ;
- `configStore` utilise `saveConfiguration` ;
- `useHeatManager` utilise `replaceEntries` ;
- `AdminInterface` utilise `replaceEntries` et `overrideEntry`.

Les fonctions legacy restent exportées par `api/supabaseClient` et les méthodes historiques restent présentes pour permettre un rollback par simple changement d'import.

## Invariant lycra

La migration ne contient aucun update/insert/delete vers `scores`.

Pour un override sur ROUGE :

- le RPC reçoit encore `p_color = ROUGE` ;
- le participant peut changer ;
- le résultat canonique conserve `color: ROUGE` ;
- les faits sportifs restent identifiés par `score.surfer = ROUGE` ;
- le test P2 existant confirme que le total et le lycra ne changent pas lorsque seul le participant affiché est remplacé.

## Tests ajoutés

`HeatRepository.mutations.test.ts` couvre :

- panel 3 conservé par `saveConfiguration` ;
- panel 5 conservé ;
- mapping complet de configuration ;
- ordre nominal config/assignments/entries/snapshot ;
- fallback offline et ordre exact des trois opérations ;
- payload snake_case inchangé de `replaceEntries` ;
- override participant sur ROUGE ;
- absence d'appel à une opération de scoring ;
- mapping du résultat override ;
- propagation inchangée des erreurs RPC/adaptateur.

Tests P0/P2 pertinents réexécutés :

- invariant lycra après changement de participant ;
- parité complète du moteur ;
- scoring 3 et 5 juges ;
- AdminInterface P2, incluant l'override lineup sans déplacement des scores ;
- tests WAL score/override existants dans la suite standard.

## Résultats de validation

- tests ciblés : **67/67 réussis** ;
- typecheck : **succès** ;
- suite complète : **232 réussis, 2 intégrations Supabase conditionnelles ignorées, 0 échec** ;
- build Vite : **succès**, 2 374 modules transformés ;
- audit réseau P1 : **succès**, aucune violation statique ou runtime ;
- routes validées : `/admin`, `/chief-judge` → `/admin`, `/judge`, `/priority`, `/display`.

L'avertissement Vitest `listen EPERM` concernant le WebSocket HMR du sandbox reste non bloquant ; les tests terminent avec le code 0.

## Payloads persistants

Aucun payload persistant n'a été modifié :

- `heat_configs` garde les mêmes clés ;
- `heat_judge_assignments` garde les mêmes clés et le même `onConflict` ;
- `heat_entries` garde `heat_id`, `participant_id`, `position`, `seed`, `color` ;
- `admin_override_heat_entry` reçoit les mêmes paramètres ;
- les opérations offline conservent leurs tables, actions et enveloppes `rows/options`.

## Rollback

Le rollback est immédiat et sans migration de données :

1. rétablir les imports `replaceHeatEntries` et `adminOverrideHeatEntry` depuis `api/supabaseClient` ;
2. rappeler `saveHeatConfig` au lieu de `saveConfiguration` ;
3. conserver ou retirer les wrappers canoniques sans toucher aux adaptateurs ni à Supabase.

Les chemins legacy sont restés actifs et testables.

## Risques ouverts

- `saveHeatConfig` conserve volontairement son paramètre legacy `any`. Son remplacement interne complet n'est pas nécessaire pour ce sous-lot et aurait augmenté le risque sur les fallbacks terrain.
- Les tests unitaires vérifient l'ordre des appels et les payloads via les adaptateurs/fakes ; ils ne réalisent pas une mutation sur une stack Supabase réelle dans la suite standard.
- Les deux intégrations Supabase réelles score/WAL restent conditionnelles à leur environnement et ont été ignorées par la commande standard.
- Les validations HP réel et Realtime plage restent ouvertes.
- Les mutations d'activation, fermeture, propagation, active pointer et création/suppression restent explicitement hors de HeatRepositoryContract actif pour ce sous-lot.

P2.5.6 activation/fermeture/propagation n'a pas été commencé.
