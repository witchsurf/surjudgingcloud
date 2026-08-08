# P2.5.6j — Safe Planning Persistence Readiness

Date de validation : 2026-08-08
Périmètre : persistance sûre du planning uniquement. P2.5.7 non commencé. Le bouton final H4 reste désactivé et déconnecté.

## Conclusion

**BLOCKED**

La protection contre la destruction de données sportives et l'inactivité initiale des nouveaux heats sont démontrées. En revanche, la persistance opérateur complète n'est pas prête sur un schéma local reconstruit : le rôle `authenticated` ne possède pas `INSERT/UPDATE` sur `heat_configs`. La RPC sûre commit les heats, puis l'upsert client des configurations échoue. Cette atomicité partielle doit être arbitrée avant d'activer H4 ou de déclarer `SAFE_PERSISTENCE_READY`.

## Changements réalisés

- `backend/supabase/migrations/20260808110000_safe_planning_inactive_payload.sql`
  - durcit `bulk_upsert_heats_safe` ;
  - exige `event_id`, `division` et `is_active=false` dans chaque heat ;
  - échoue fermé si le payload est incomplet ou incohérent ;
  - conserve le verrou transactionnel et l'inventaire de sécurité P2.5.6i ;
  - appelle la RPC legacy inchangée, puis force atomiquement les heats proposés à `is_active=false`.
- `frontend/src/api/modules/heats.api.ts`
  - ajoute explicitement `is_active: false` aux heats de planning ;
  - remplace l'appel direct à `bulk_upsert_heats` par l'adaptateur sûr ;
  - conserve l'ordre historique : participants, résolution des IDs, construction, RPC planning, puis `heat_configs`.
- `frontend/src/repositories/HeatPlanningRepository.ts`
  - injecte `PlanningSafetyRepository.persistSafePlanning` dans l'adaptateur existant.
- `frontend/src/pages/ParticipantsStructure.tsx`
  - supprime l'initialisation automatique du pointeur actif après génération ;
  - clarifie la sémantique opérateur de `overwrite=false` et `overwrite=true`.
- `frontend/src/services/persistPlanningImportSafely.ts`
  - prépare la conversion import canonique/preview vers `HeatPlanningRepository` ;
  - n'est importé par aucun composant H4.
- tests unitaires, architecturaux et Supabase réels ajoutés ou adaptés.

## Caractérisation de `is_active`

| Chemin | État observé |
|---|---|
| Définition historique `heats.is_active` | `default true` |
| `bulk_upsert_heats` legacy | ignore `is_active` |
| planning moderne avant P2.5.6j | omettait `is_active`, donc héritait de `true` |
| planning moderne P2.5.6j | payload explicite `false`, vérifié et préservé par la RPC sûre |
| activation lifecycle | seule transition validée vers `true` |
| fermeture lifecycle | transition validée vers `false` |

Le défaut DB n'a pas été changé : `createHeat` et d'autres chemins runtime legacy l'omettent encore et leur dépendance au défaut n'est pas caractérisée. Aucun backfill n'a été exécuté.

Inventaire local en lecture seule avant les tests : 16 heats, tous `running` et `is_active=true`; aucun pointeur actif; aucun heat `closed`, `waiting` ou `open` actif. Cet inventaire décrit seulement la fixture locale existante, pas une règle métier.

## Sémantique de remplacement

- `overwrite=false` cible uniquement les IDs proposés déjà présents. Une collision propre peut être remplacée selon le comportement historique.
- `overwrite=true` cible les heats existants de toute la catégorie.
- Dans les deux modes, toute donnée protégée relevée par l'inventaire bloque la transaction avant l'appel legacy.
- Aucun delete implicite supplémentaire n'a été ajouté.
- Le libellé UI indique désormais que l'option remplace tous les heats planifiés de la catégorie et que, sans elle, seules les collisions d'IDs propres sont remplacées.

## Atomicité et ordre

Ordre conservé :

1. upsert participants ;
2. lecture/résolution des IDs participants ;
3. construction des heats, entries et mappings ;
4. `bulk_upsert_heats_safe` atomique pour le planning ;
5. upsert `heat_configs` uniquement après succès de la RPC.

La séquence complète n'est pas atomique. Les participants peuvent être écrits avant un refus planning. Plus critique, les heats peuvent être commités puis l'écriture de `heat_configs` échouer. Le test réel a précisément observé ce cas sur la stack reconstruite à cause des grants manquants.

## Divergence de privilèges `heat_configs`

Sur la stack locale reconstruite :

- des policies autorisent en principe l'écriture locale/authentifiée ;
- `authenticated` ne possède que `SELECT` sur `heat_configs` ;
- `anon` ne possède que `SELECT` ;
- l'upsert réel retourne `permission denied for table heat_configs`.

Le test opt-in accorde temporairement `INSERT, UPDATE` à `authenticated`, exécute le vrai repository, puis révoque ces droits dans son nettoyage. Le contrôle final confirme que les grants temporaires ne subsistent pas. Aucun SQL correctif de droits n'est inclus dans ce lot.

## Tests

### Unitaires et architecturaux

- payload planning avec `is_active=false` ;
- RPC sûre appelée, sans fallback destructif legacy ;
- absence d'écriture config après refus RPC ;
- délégation repository ;
- service `persistPlanningImportSafely` ;
- aucun appel production direct à `bulk_upsert_heats` ;
- aucun pointeur actif initialisé par `ParticipantsStructure` ;
- H4 non connecté à la persistance.

Résultat ciblé : **15/15 tests passés**.

Suite complète : **354 tests passés, 5 opt-in ignorés**, 63 fichiers passés, 5 ignorés.

### Stack Supabase locale réelle

Le script transactionnel `safe_planning_persistence_readiness.sql` valide avec rollback :

- création initiale de heats inactifs ;
- refus d'un payload sans `is_active=false` ;
- activation lifecycle d'un seul heat ;
- blocage de régénération avec heat actif ;
- remplacement d'une collision propre ;
- blocage avec score ;
- blocage avec affectation juge ;
- blocage d'un heat fermé ;
- conservation des données après chaque refus.

Résultat : **passé**, événement temporaire supprimé par rollback.

Le test réel `coordinator UI repository -> adaptateur -> PostgREST/RPC` valide, avec grants temporaires contrôlés :

- un heat initial est `is_active=false` ;
- entries et config sont écrites ;
- l'ajout d'un score bloque le remplacement ;
- heat, score et config restent inchangés ;
- événement temporaire supprimé ;
- droits temporaires révoqués.

Résultat : **1/1 passé**. Contrôle final : `temp_events=0`, `config_write_grant=false`.

### Fichier terrain Competition X

- parsing XLSX inchangé et hors ligne ;
- 62 lignes valides, 7 catégories ;
- preview H4 en mémoire ;
- aucun fetch réseau ;
- aucune persistance.

Résultat : **2/2 tests opt-in passés**. Médiane de parsing observée : 161,67 ms sur 5 exécutions.

### Vérifications de livraison

- `tsc --noEmit` : passé ;
- build Vite/PWA : passé, 2453 modules ;
- lint DB local niveau error : aucun résultat ;
- audit réseau P1 : passé ;
- routes validées : `/admin`, `/chief-judge` vers `/admin`, `/judge`, `/priority`, `/display` ;
- aucun domaine public interdit observé.

L'avertissement Vitest `listen EPERM` du serveur WebSocket HMR apparaît dans le sandbox, mais les suites concernées terminent avec code 0. L'audit P1 a été exécuté hors restriction de bind local et est vert.

## Déploiement et versions mixtes

Ordre obligatoire si cette voie est poursuivie :

1. résoudre et tester les droits/atomicité de `heat_configs` ;
2. déployer les migrations `20260808090000` puis `20260808110000` sur une base isolée ;
3. vérifier la présence et la signature de `bulk_upsert_heats_safe` ;
4. déployer le frontend ;
5. exécuter un smoke test planning sans données sportives.

Un frontend P2.5.6j contre une base sans RPC sûre échoue fermé. Il ne retombe jamais sur `bulk_upsert_heats`. Un ancien frontend peut encore appeler la RPC legacy : la protection ne peut donc être garantie pendant une période de versions mixtes. Le bouton H4 final demeure désactivé.

## Rollback

- frontend : revenir à la façade legacy restaure l'ancien comportement, y compris ses risques destructifs ; ce rollback ne doit pas être utilisé sur le terrain sans décision explicite ;
- DB : la RPC legacy n'est ni modifiée ni supprimée ; la RPC sûre peut être retirée séparément ;
- aucun défaut de colonne, backfill ou donnée existante n'a été modifié ;
- les fixtures réelles sont nettoyées et les grants temporaires restaurés.

## Risques ouverts et décision requise

1. **Bloquant — grants/atomicité `heat_configs`** : choisir entre une migration minimale de privilèges vérifiée Cloud/HP ou une persistance serveur atomique incluant les configurations. Ne pas activer H4 avant décision.
2. Le défaut historique `is_active=true` reste nécessaire aux chemins runtime non caractérisés ; le planning sûr ne dépend plus de ce défaut.
3. Les versions frontend anciennes conservent un accès possible à la RPC legacy.
4. Les participants sont écrits avant le preflight transactionnel final ; une opération refusée peut donc laisser des participants upsertés.
5. Les smoke tests sur le véritable HP et la validation Realtime plage restent ouverts.

P2.5.7 n'a pas été commencé.
