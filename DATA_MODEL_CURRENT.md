# Modèle de données actuel — P0

## Nature du modèle

Le modèle courant est PostgreSQL/Supabase, construit par une longue suite de migrations incrémentales et complété historiquement par `backend/sql/`. `frontend/src/types/supabaseDatabase.ts` ne décrit pas réellement le schéma : toutes les tables/RPC y sont typées génériquement avec `any`. La source de vérité est donc l'état migré de PostgreSQL, pas ce fichier TypeScript.

Les identifiants sont mixtes : événements en `bigint`, nombreuses entités en UUID, heats et scores historiquement en `text`. Les entités sportives utilisent à la fois des champs normalisés et des snapshots JSON.

## Agrégats principaux

### Événement et participants

- `events` : événement commercial/opérationnel, propriétaire, dates, statut, paiement, catégories/juges et `last_config`/configuration JSON ajoutée au fil des migrations.
- `participants` : athlètes d'un événement, identité, catégorie, pays/club et métadonnées.
- `event_config` : snapshot de configuration de l'événement.
- `event_judge_assignments`, `judges` : catalogue et affectations de juges.
- `payments` : provider, montant, statut et référence de transaction.

### Structure sportive

- `heats` : clé texte, événement, compétition, division, round, numéro et état open/closed.
- `heat_entries` : participants réellement placés dans un heat, position/couleur et overrides de lineup.
- `heat_slot_mappings` : placeholders et propagation entre rounds.
- `heat_configs` : snapshot du panel, des lycras, du nombre de vagues et du
  format. En mode Field, le navigateur ne l'upsert pas directement : le SAVE
  Admin passe par `upsert_heat_config_runtime` après validation d'un heat déjà
  planifié.
- `heat_judge_assignments` : station J1…J5 et identité du juge pour un heat ; le panel permanent par podium est aussi conservé et recopié lors de l'activation.
- `active_heat_pointer` : heat actif par événement/podium.
- `podium_judge_panels` : panel stable d'un podium.

### Live, scoring et résultats

- `scores` : fait brut par heat, station/identité juge, couleur de lycra, vague, note, timestamp et événement. La couleur est la liaison sportive stable.
- `score_overrides` : ancien/nouveau score, raison, auteur et commentaire.
- `score_deletions` : suppression auditée avec snapshot.
- `interference_calls` : appels par juge/vague/surfeur et override chef juge.
- `heat_realtime_config` : statut, début/durée timer et `config_data` JSON contenant notamment lineup et `priorityState`.
- `heat_timers` : table historique de timer, tandis que le runtime moderne utilise surtout `heat_realtime_config`.
- `heat_history` : début, fin et durée d'un heat.
- `competition_audit_log` : journal transverse des changements de score, suppressions, interférences, statuts, pointeurs et dérogations.

### Exploitation et synchronisation

- `app_runtime_schema_version` : version de migration installée.
- Vues/RPC de reporting, complétude des notes, validation de fermeture, accuracy juges, transitions de heat et propagation de qualifiés.
- Côté navigateur, IndexedDB `SurfJudging` contient `scores`, `offline_wal` et `legacy_queue`. Ce stockage est un cache/WAL, pas le registre officiel.

## Relations métier essentielles

- Un événement possède participants, heats, juges et paiements.
- Un heat appartient à un événement et une division/round ; ses entrées associent une position et une couleur à un participant.
- Une note appartient à un heat et à une vague, mais cible d'abord une **couleur de lycra** et une station de juge. Le nom affiché est résolu séparément.
- Un pointeur actif relie un podium à un heat ; un juge ne doit pas être actif simultanément sur plusieurs podiums.
- Les qualifiés sont propagés des résultats sources vers les slots aval par fonctions SQL transactionnelles.
- Le SAVE Admin n'est pas une mutation de planning : la création des heats et
  la propagation des qualifiés appartiennent aux workflows dédiés.

## Calculs dérivés

Les moyennes de vague, deux meilleures vagues, rang et besoin ne sont pas persistés comme source canonique dans des tables `wave_results`/`heat_results`. Ils sont principalement recalculés dans le frontend depuis `scores` et `interference_calls`. Des vues/RPC SQL vérifient la complétude et les transitions, mais la présentation sportive dépend encore du calcul TypeScript.

Conséquence : la reproductibilité exige de conserver scores, corrections/suppressions, affectations du panel, lineup/couleurs et interférences. Exporter uniquement le classement final est insuffisant.

## Contraintes et divergences relevées

- La plage autorisée actuelle est 0 à 10 ; la spécification cible 0,1 à 10.
- La complétude est évaluée contre le nombre de juges configuré ; une vague incomplète reste exclue après clôture.
- Des migrations récentes sécurisent les inserts/corrections et canonicalisent heat/event/judge, signe d'une dette historique d'identifiants.
- Les données de timer et de configuration sont partiellement dupliquées entre tables, JSON, stores et localStorage.
- Les migrations cloud et les scripts SQL historiques locaux peuvent dériver ; la version runtime atténue sans supprimer ce risque.
- L'absence de types générés empêche un inventaire statique fiable des colonnes et RPC consommées.

## Données à inclure dans toute future migration

Le futur mapping devra couvrir sans perte : événements, participants, heats/slots/entries, panels et identités juges, scores bruts et leurs timestamps, corrections/suppressions, interférences, état timer, priorité, pointeurs podium, historique des heats, audit, configuration et références de synchronisation cloud. Une migration destructive ou un changement de clé reste soumis à confirmation explicite.
