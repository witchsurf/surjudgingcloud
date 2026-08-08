# Rapport P2.1 / P2.2 — types et contrats

## Types générés

La stack CLI isolée a été reconstruite depuis `backend/supabase/migrations` jusqu’à `20260727210000_add_event_operations_health.sql`. La génération exige explicitement Supabase CLI 2.111.0 et le schéma `public` ; elle échoue clairement avec une autre version au lieu de produire silencieusement un diff de format.

Commande reproductible :

```bash
npm --prefix frontend run types:supabase
```

Le fichier obtenu contient 22 tables, 7 vues et 35 fonctions. Deux générations successives ont produit le même SHA-256 : `0e840472ddf92c6aa391a0ebad88f2cd13345786c6b9c8600d7a722ac4f4ed18`.

`supabase.generated.ts` n’est jamais édité manuellement. `supabaseDatabase.ts` est uniquement une façade de nommage réversible pour les imports actuels.

## Divergences découvertes

1. Le type legacy `SupabaseDatabase` acceptait n’importe quelle table, colonne et RPC avec `any`. Le type généré expose désormais la surface réelle.
2. `Score.id` et `RawScoreRow.id` sont optionnels dans le frontend, mais `scores.id` est requis à l’insertion par le schéma reconstruit.
3. `RawScoreRow.timestamp` est optionnel alors que `scores.timestamp` est requis.
4. `scores.event_id`, `scores.created_at` et `scores.judge_station` sont nullables en base. Plusieurs types frontend les déclarent seulement optionnels, sans accepter explicitement `null`.
5. `AppConfig.heatId` est `number`, tandis que la clé canonique `heats.id` et `scores.heat_id` est `string`.
6. Les lignes et vues de scoring sont redéclarées manuellement dans `scoring.api.ts`, malgré leur présence dans les types générés.
7. La base définit `score numeric(4,2)` avec une contrainte de 0 à 10. Elle accepte donc zéro et jusqu’à deux décimales, contrairement à la règle officielle P2 : 0,1 à 10,0 avec une décimale.
8. Plusieurs vues/RPC historiques filtrent `score > 0`. Zéro est accepté comme fait brut mais généralement exclu des calculs de complétude/qualification.
9. Les contrats legacy utilisent le champ `surfer` pour la couleur. Le contrat P2 le renomme `lycraColor` afin de rendre l’invariant explicite, sans changer la colonne PostgreSQL.
10. Le type d’appel d’interférence persistant reste `INT1 | INT2`. La disqualification est un résultat dérivé et non une nouvelle valeur stockée `DSQ`.

Aucune divergence n’a été corrigée par une migration SQL pendant P2.1/P2.2.

## Casts restants

Dans `frontend/src`, hors fichier généré :

- 165 lignes contiennent le token TypeScript `any` ;
- 46 contiennent explicitement `as any` — sous-ensemble du total précédent ;
- 8 contiennent `as unknown as` ;
- l’inventaire combiné représente 173 lignes.

Concentrations principales : `lib/supabase.ts` (22), `api/modules/heats.api.ts` (20), `hooks/useHeatManager.ts` (17), `lib/logger.ts` (14), `repositories/HeatRepository.ts` (13), `utils/pdfExport.ts` (11). Leur suppression n’est pas incluse automatiquement : chaque cast devra être remplacé au moment de migrer son adaptateur ou consommateur.

## Contrats créés

- `ScoringPolicy` et `OFFICIAL_SCORING_POLICY` ;
- validation des bornes officielles 0,1–10,0 à une décimale ;
- `ScoreFact` avec ordre last-write-wins explicite ;
- `PanelDefinition` limité statiquement à 3 ou 5 ;
- `HeatLineupEntry` et `ParticipantDisplayMetadata`, séparés du score ;
- `WaveResult`, `InterferenceDecision`, `CompetitorHeatResult` et `HeatResultSnapshot` ;
- alias générés pour les lignes critiques de score, override, suppression, interférence, heat, lineup, panel, événement, participant et juge.

## Risques et blocages

- La stack reconstruite est une référence de migrations, pas une preuve que le HP terrain n’a aucune dérive. Une comparaison de schéma en lecture seule avec le HP reste nécessaire.
- Activer `minScore = 0.1` dans le futur moteur sans modifier les écritures legacy créerait deux validateurs différents. P2.3 devra basculer la validation via la façade, avec tests de parité sauf pour cette correction métier approuvée.
- PostgreSQL continuera d’accepter zéro et deux décimales. Cette divergence est volontairement ouverte ; toute contrainte SQL exige une phase et une validation séparées.
- Les nombreux DTO et casts manuels empêchent encore le typage de bout en bout, mais ne bloquent pas la création du moteur pur.
- Les panels legacy autres que 3/5 peuvent encore atteindre les fonctions actuelles. Ils doivent être signalés comme non supportés par P2, sans inventer de calcul de remplacement.

Aucun risque bloquant n’empêche P2.3 si la coexistence temporaire des validateurs et la divergence SQL sont explicitement acceptées.

## Vérifications exécutées

- reconstruction complète de la stack Supabase locale isolée : réussie ;
- génération exécutée deux fois : checksum identique ;
- `tsc --noEmit` : réussi ;
- suite frontend complète : 82 tests réussis sur 18 fichiers ;
- tests du contrat officiel : `0` invalide, `0,1` valide, `10,0` valide, `10,1` invalide et précision supérieure à une décimale invalide ;
- build Vite/PWA : réussi, 2 355 modules transformés ;
- audit réseau P1 : réussi, aucune requête publique sur les cinq routes terrain ;
- syntaxe du générateur et des scripts HP : valide.

Vitest affiche encore l’avertissement sandbox non bloquant `EPERM` pour son WebSocket HMR sur le port 24678 ; le processus termine avec succès et tous les tests passent.
