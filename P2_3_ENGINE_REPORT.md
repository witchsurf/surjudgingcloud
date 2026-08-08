# Rapport P2.3 — moteur de scoring partagé

## Périmètre

P2.3 extrait un moteur pur de résultat d’un heat. Aucun composant UI ne l’utilise encore. Le calcul historique reste accessible dans `legacyScoringFacade`, ce qui maintient un chemin de référence et de retour arrière avant P2.4.

Aucune migration SQL, WAL, logique timer, synchronisation Cloud ↔ HP, route P1 ou intégration ESP32 n’a été modifiée.

## Fichiers créés ou modifiés

Créés :

- `frontend/src/domain/scoring/engine.ts` : moteur pur et calcul des interférences effectives ;
- `frontend/src/domain/scoring/legacyFacade.ts` : façade explicite du calcul historique ;
- `frontend/src/domain/scoring/__tests__/engine.parity.test.ts` : exécution legacy/nouveau en parallèle ;
- `frontend/src/domain/scoring/__tests__/interference.parity.test.ts` : parité majorité et override chef juge ;
- `frontend/src/domain/scoring/__tests__/engine.performance.test.ts` : budget de performance terrain.

Modifiés :

- `frontend/src/domain/scoring/contracts.ts` : entrée du moteur, votes d’interférence et validation officielle ;
- `frontend/src/domain/scoring/index.ts` : exports du moteur et de la façade.

Les fichiers legacy `frontend/src/utils/scoring.ts` et `frontend/src/utils/interference.ts` ne sont pas modifiés.

## Règles extraites

- panels officiellement supportés : 3 et 5 juges ; les autres tailles lèvent `UnsupportedPanelSizeError` ;
- moyenne à 3 juges ;
- à 5 juges complets, tri puis retrait d’une occurrence minimale et d’une occurrence maximale ;
- égalités min/max : une seule occurrence retirée de chaque côté ;
- moyenne de vague arrondie à deux décimales ;
- total égal aux deux meilleures vagues complètes, arrondi à deux décimales ;
- vague incomplète visible mais exclue du total et du classement ;
- last-write-wins : `timestamp`, puis `createdAt`, puis identifiant stable, ordre lexical décroissant ;
- normalisation bilingue des couleurs pour l’appariement, sans rattachement au participant ;
- majorité d’interférence, dernier vote par juge, override chef juge, INT1, INT2 et disqualification après deux décisions effectives ;
- ordre actuel des pénalités : sélection des meilleures vagues, puis pénalité de la seconde ;
- classement actuel avec rangs ex æquo et trous de rang, ordre lexical d’affichage inchangé.

## Parité ancien / nouveau

Les fixtures P0 sont exécutées par les deux implémentations dans le même test et réduites à une représentation comparable : lycra, vagues, notes par juge, moyenne, complétude, total, rang et disqualification. Une différence provoque un échec strict `toEqual`.

La parité couvre :

- nominal 3 juges ;
- nominal 5 juges ;
- min/max et trois variantes d’égalités ;
- arrondis et trois vagues avec sélection des deux meilleures ;
- vagues 2/3 et 4/5 ;
- correction arrivée hors ordre ;
- INT1, INT2 et disqualification ;
- majorité 3/5, absence de majorité et override chef juge ;
- classement ex æquo ;
- changement de participant sur le lycra ROUGE sans déplacement des scores.

## Écarts observés et autorisés

1. Le moteur officiel rejette `0`, `10,1` et les valeurs ayant plus d’une décimale. Il accepte `0,1` et `10,0`. Le validateur legacy continue temporairement d’accepter zéro.
2. Le moteur refuse explicitement les panels 1, 2, 4 ou supérieurs à 5 au lieu de prolonger le comportement technique legacy.
3. En cas d’égalité exacte des dates, le moteur applique les critères `createdAt` puis `id`. Le legacy dépendait alors de l’ordre stable du tableau ; ce départage technique déterministe a été approuvé avant P2.3.

Aucun autre écart n’a été observé sur les fixtures de parité.

PostgreSQL accepte toujours zéro et deux décimales. Cette divergence reste documentée et aucune contrainte SQL n’est ajoutée.

## Performance

Fixture : 6 lycras, 12 vagues, 5 juges, soit 360 faits de score. Sur cette machine, 250 calculs complets ont pris `174,93 ms`, soit environ `0,70 ms` par calcul. Le test impose un plafond conservateur de `1 500 ms` pour 250 calculs afin de détecter une régression majeure sans rendre la CI instable.

## Vérifications

- `tsc --noEmit` : réussi ;
- suite complète : 110 tests réussis sur 21 fichiers ;
- tests du domaine scoring : 34 tests réussis ;
- build Vite/PWA : réussi, 2 355 modules transformés ;
- audit réseau P1 : réussi, cinq routes validées et aucune requête publique ;
- avertissement Vitest `EPERM` sur le WebSocket HMR sandbox : non bloquant, code de sortie nul.

## Risques restants

- Le moteur n’est volontairement utilisé par aucun écran : la parité est démontrée sur les fixtures, pas encore en shadow mode sur un événement réel.
- La conversion future des lignes Supabase vers `ScoreFact` devra fournir un `id` et un `createdAt` stables, y compris pour les entrées offline temporaires.
- La divergence base/contrat sur zéro et deux décimales reste ouverte jusqu’à une validation SQL séparée.
- Les panels legacy non 3/5 devront être signalés à l’opérateur avant leur passage au nouveau moteur.
- La normalisation bilingue associe les alias d’une même couleur ; l’étiquette de lineup d’origine est conservée pour reproduire l’ordre lexical actuel.
- P2.4 devra comparer ancien et nouveau moteur avant chaque consommateur et garder la façade legacy activable.
