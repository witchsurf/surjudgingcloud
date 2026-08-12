# SAVE Admin en mode Field

Cette procédure décrit le comportement canonique validé depuis P2.7.9. Elle
remplace les anciens workflows dans lesquels le bouton SAVE créait un heat ou
écrivait directement l'événement.

## Préconditions

1. L'événement et le planning ont déjà été préparés puis synchronisés vers la base Field.
2. Le heat sélectionné existe déjà avec le bon `event_id`, la bonne division, le bon round et le bon numéro.
3. Les identités officielles sont affectées à toutes les stations du panel.
4. Le lineup correspond aux `heat_entries` planifiées.

SAVE configure un heat existant. Il ne crée pas le planning.

## Procédure opérateur

1. Ouvrir `/admin?eventId=<EVENT_ID>` sur le frontend LAN.
2. Choisir le podium, la division, le round et le heat.
3. Vérifier les juges, leurs stations et leurs identités officielles.
4. Vérifier les surfeurs et les couleurs de lycra.
5. Cliquer `SAUVEGARDER` une seule fois et attendre `SAUVEGARDÉE`.
6. Rafraîchir la page si une certification est nécessaire : le contexte doit revenir identique et rester `SAUVEGARDÉE`.
7. Utiliser l'action dédiée d'activation/démarrage pour déplacer les tablettes.

Les alias `RED/WHITE/YELLOW/BLUE/GREEN/BLACK` et
`ROUGE/BLANC/JAUNE/BLEU/VERT/NOIR` représentent les mêmes lycras au
rafraîchissement. Cette normalisation ne change jamais les scores.

## Chaîne de persistance canonique

Le frontend valide d'abord le heat planifié, puis le repository exécute dans cet ordre :

1. RPC `upsert_heat_config_runtime` ;
2. upsert de `heat_judge_assignments` par `(heat_id, station)` ;
3. vérification/reconstruction contrôlée des `heat_entries` ;
4. pour le podium A uniquement, RPC `upsert_event_last_config` afin de maintenir le snapshot de reprise historique.

Le SAVE ne doit pas :

- insérer ou upserter directement `heats` ;
- modifier directement `events` ;
- upserter directement `heat_configs` depuis le navigateur ;
- changer le pointeur de heat actif ;
- démarrer le timer ;
- déplacer une note d'une couleur de lycra à une autre.

## Succès et erreur

`configSaved` reste `false` pendant toute la chaîne critique. Il passe à `true`
seulement après sa réussite complète. La publication Realtime et le snapshot de
reprise navigateur viennent ensuite.

Si la validation du heat, le RPC, les affectations, les entrées ou le snapshot canonique échouent :

- l'interface reste non sauvegardée ;
- l'erreur est affichée ;
- l'opérateur ne doit pas démarrer le heat ;
- il ne faut pas contourner l'erreur par un INSERT SQL ou REST manuel.

## Contrôle rapide

Après SAVE, vérifier au minimum :

- bouton `SAUVEGARDÉE` désactivé ;
- heat et event inchangés ;
- une affectation par station avec le bon `judge_identity_id` ;
- lineup/couleurs corrects ;
- aucune écriture directe `events`, `heats` ou `heat_configs` dans la trace réseau ;
- après refresh, même contexte et aucun doublon.
