# P2 — carte des contrats de données

## Sources

- Schéma persistant : `frontend/src/types/supabase.generated.ts`, généré sans édition manuelle depuis la stack Supabase CLI locale reconstruite.
- Alias de lignes persistées : `frontend/src/types/database.ts`.
- Contrats métier purs d’un heat : `frontend/src/domain/scoring/contracts.ts`.
- Façade de compatibilité : `frontend/src/types/supabaseDatabase.ts` conserve le nom `SupabaseDatabase` utilisé par le client actuel.

## Frontières

| Couche | Identité et responsabilité |
|---|---|
| PostgreSQL/Supabase | Lignes, nullabilité, colonnes, arguments et retours RPC |
| Adaptateur futur | Conversion explicite snake_case ↔ contrats métier ; aucune règle de calcul |
| Domaine heat | Lycra, panel 3/5, notes, vagues, interférences et résultat du heat |
| Affichage | Participant, nom, pays et club résolus séparément à partir du lineup |

Une note métier utilise `lycraColor` comme identité canonique. `ParticipantDisplayMetadata` ne peut pas devenir la clé d’agrégation des scores.

## Politique officielle P2

- score de 0,1 à 10,0 ; une décimale ;
- moyenne de vague arrondie à deux décimales avant le total ;
- deux meilleures vagues complètes ;
- panels supportés : trois ou cinq juges ;
- à cinq juges, une occurrence min et une occurrence max seront retirées par le moteur P2.3 ;
- last-write-wins déterministe : `timestamp`, puis `createdAt`, puis `id` stable ;
- classement et interférences conservent le comportement caractérisé en P0.

Le validateur et le moteur legacy acceptent encore zéro. Ils ne sont pas modifiés en P2.1/P2.2 afin de permettre la comparaison demandée avant P2.3.
