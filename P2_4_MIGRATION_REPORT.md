# Rapport P2.4 — checkpoint de migration progressive

## Statut

P2.4 est en cours. Deux consommateurs ont été migrés et validés séparément : `HeatResults`, puis `ScoreDisplay`. La migration s’arrête volontairement avant `DisplayPage` parce que son calcul historique ne dispose pas toujours de la taille de panel configurée.

P2.5 n’est pas commencé.

## Consommateurs migrés

### HeatResults

- construit un `HeatResultSnapshot` canonique via `calculateShadowHeatResult` ;
- exécute legacy et P2 sur les mêmes scores ;
- n’utilise P2 que si les projections sont strictement identiques ;
- affiche les erreurs de panel, de note officielle ou de divergence ;
- ne calcule plus moyenne, trim, deux meilleures vagues, total, rang ou pénalité dans le composant ;
- conserve les métadonnées participant comme simple résolution d’affichage du lycra.

### ScoreDisplay

- reçoit ses `SurferStats` uniquement depuis l’adaptation du snapshot canonique après parité ;
- affiche l’état opérateur P2 ;
- conserve `calculateSurfRequirement`, qui calcule un besoin futur à partir du snapshot mais ne recalcule pas le résultat du heat ;
- refuse explicitement les panels non 3/5 ;
- conserve le calcul legacy derrière `legacyScoringFacade` et le shadow service.

## Consommateurs restant en legacy

- `DisplayPage` ;
- `OverlayPage` et `ObsOverlay` ;
- `AdminInterface` ;
- `pdfExport` ;
- les portions heat de `ranking.ts`.

## Blocage découvert avant DisplayPage

Plusieurs chemins historiques de `DisplayPage` appellent `getEffectiveJudgeCount(scores)` sans panel configuré. Une vague incomplète contenant deux notes est donc techniquement interprétée comme un panel de deux juges par le code legacy. Le moteur officiel ne supporte que 3 ou 5.

La migration sûre nécessite que ces calculs historiques reçoivent une taille de panel explicite depuis `heat_configs`, `heat_judge_assignments` ou un snapshot de configuration déjà chargé. Déduire 3 à partir de 1–3 notes ou 5 à partir de 4–5 notes inventerait une règle et est interdit. Le composant n’est donc pas basculé dans ce checkpoint.

## Shadow comparisons et rollback

`frontend/src/domain/scoring/shadow.ts` :

1. transforme les scores legacy en `ScoreFact` ;
2. calcule le résultat historique ;
3. calcule le snapshot P2 ;
4. compare lycra, vagues, notes juge, moyenne, complétude, total, rang, disqualification et interférences ;
5. journalise `[P2 shadow divergence]` avec les deux projections ;
6. ne sélectionne P2 qu’en cas de parité exacte.

Une divergence conserve le résultat legacy dans le service pour diagnostic mais retourne `source: none` et un état opérateur : le composant ne présente pas le résultat divergent comme officiel. Le rollback complet reste disponible en reconnectant directement `legacyScoringFacade` ; les fonctions legacy n’ont pas été modifiées.

## Divergences détectées

- Aucune divergence sur les fixtures P0 nominales.
- Le test shadow provoque volontairement une égalité exacte de `timestamp`/`created_at` : P2 choisit l’ID stable, tandis que legacy conserve le premier élément du tableau. La divergence est détectée, journalisée et empêche la bascule.
- Zéro est accepté par legacy mais rejeté par P2 : l’écran affiche la règle officielle et aucun résultat P2.
- Un panel 4 retourne un état opérateur sans calcul legacy silencieux.

## Tests et validations

- test UI `HeatResults` : total canonique identique et panneau 4 explicite ;
- tests shadow : parité, divergence journalisée, rollback diagnostic, zéro interdit, panel non supporté ;
- tests P2.3 : parité 3/5, interférences, LWW et performance ;
- après `HeatResults` : typecheck, 112 tests, build et audit P1 réussis ;
- après `ScoreDisplay` : typecheck, 112 tests, build et audit P1 réussis ;
- checkpoint final avec les tests shadow ajoutés : typecheck, 116 tests sur 23 fichiers, build et audit P1 réussis.

## Performance

Le moteur seul reste sous une milliseconde par heat sur la fixture 360 scores (`211,40 ms` pour 250 calculs lors de la validation finale, soit environ `0,85 ms` par calcul). Pendant P2.4, le shadow mode exécute volontairement deux calculs. Cette surcharge reste acceptable pour les deux écrans migrés, mais devra être mesurée sur un événement historique complet avant `DisplayPage`.

## Risques restants

- métadonnée de panel absente dans certains chemins d’historique/display ;
- scores offline sans ID serveur : l’adaptateur construit un ID déterministe de compatibilité incluant l’ordre d’entrée en dernier recours ;
- divergence PostgreSQL sur zéro et deux décimales toujours ouverte ;
- logs shadow uniquement dans la console pour les consommateurs non encore migrés ;
- P2.4 ne peut être clôturée tant que les consommateurs restants ne sont pas migrés et validés un par un.
