# P2.5.3 — Participants et juges

## Conclusion

Les chemins participants et juges utilisent désormais leurs repositories canoniques. `ParticipantRepository` implémente `ParticipantRepositoryContract`; le nouveau `JudgeRepository` implémente `JudgeRepositoryContract`. Les modules API restent les adaptateurs Supabase internes et `api/supabaseClient` demeure inchangé comme façade de compatibilité.

P2.5.4 et `HeatRepository` n’ont pas été commencés.

## Architecture obtenue

```text
pages / composants
        ↓
ParticipantRepository | JudgeRepository
        ↓
api/modules/participants.api | api/modules/judges.api
        ↓
Supabase
```

Les contrats et DTO publics restent dans `repositories/contracts`. Aucun type PostgREST ou nom de colonne snake_case ne remonte vers les nouveaux consommateurs.

## Types unifiés

### ParticipantRecord

La seule définition publique canonique est `repositories/contracts/participants.ts` :

- `id` ;
- `eventId` ;
- `category` ;
- `seed` ;
- `name` ;
- `country` ;
- `license`.

La définition dupliquée de `ParticipantRepository.ts` a été supprimée. `participants.api.ts` conserve seulement un type de ligne Supabase interne non exporté, nécessaire au mapping `event_id → eventId`.

L’ordre Supabase existant reste `category ASC`, puis `seed ASC`. Le repository mappe les lignes sans les retrier, ce qui conserve l’ordre et les identités événement/catégorie/seed.

### JudgeRecord

`JudgeRepository` mappe la ligne interne legacy vers le DTO canonique :

- `personal_code → personalCode` ;
- `certification_level → certificationLevel` ;
- `created_at → createdAt` ;
- valeurs email/téléphone/certification absentes normalisées à `null`.

Les entrées create/update sont reconverties vers les clés Supabase historiques sans modifier les valeurs ni les fallbacks.

## Sous-lots

### A. Lectures participants

`listByEvent` délègue à `participants.api.fetchParticipants`, conserve l’ordre catégorie/seed et retourne le DTO canonique.

Consommateurs migrés :

- `ParticipantsStructure` ;
- `GenerateHeatsPage` ;
- `AdminInterface` ;
- type des propriétés de `ParticipantsTable`.

### B. Mutations participants

`upsertMany`, `update` et `delete` délèguent aux fonctions API existantes. Sont conservés :

- conflit `event_id,category,seed` ;
- payload et valeurs nulles existants ;
- absence d’opération pour un import vide ;
- mêmes erreurs Supabase observables.

`ParticipantsStructure` appelle maintenant ces méthodes canoniques.

### C. Lectures juges

`listActive`, `getById` et `validateCode` adaptent les fonctions existantes. `validateCode` conserve son comportement historique : une erreur de validation retourne `null`.

Consommateurs migrés :

- `JudgeSelectorSection` ;
- `JudgeLogin` ;
- `AdminInterface`.

### D. Mutations juges

`create`, `update` et `deactivate` réutilisent les fonctions API existantes. Le fallback fédération `FSS`, l’activation à la création et les erreurs restent inchangés.

La création de juge dans `AdminInterface` utilise désormais `personalCode` au contrat public, puis le repository le mappe vers `personal_code`.

### E. updateEventDisplayName

`JudgeInterface` appelle `judgeRepository.updateEventDisplayName` en dernier sous-lot. Le repository délègue à l’adaptateur API historique.

## Compatibilité JSON legacy events.judges

Le type explicite ajouté est :

```ts
type LegacyEventJudge =
  | string
  | {
      id: string;
      name?: string;
      identity_id?: string;
    };
```

`parseLegacyEventJudges` accepte :

- tableaux de strings ;
- tableaux d’objets ;
- tableaux mixtes ;
- objets avec ou sans `name` ;
- objets avec ou sans `identity_id`.

Les objets valides et leur ordre sont conservés. La fonction pure `updateLegacyEventJudgeDisplayName` reproduit exactement la sérialisation précédente :

- une string ciblée devient `{ id, name }` ;
- un objet ciblé conserve `identity_id` et reçoit/met à jour `name` ;
- un juge absent est ajouté sous `{ id, name }` ;
- les autres éléments restent inchangés.

Aucune migration ou modification de colonne JSON n’a été effectuée.

## Imports migrés

- `pages/ParticipantsStructure.tsx` → `participantRepository`.
- `components/ParticipantsTable.tsx` → type canonique.
- `components/GenerateHeatsPage.tsx` → `participantRepository`.
- `components/AdminInterface.tsx` → `participantRepository`, `judgeRepository`, DTO canoniques.
- `components/JudgeSelectorSection.tsx` → `judgeRepository`.
- `components/JudgeLogin.tsx` → `judgeRepository`.
- `components/JudgeInterface.tsx` → `judgeRepository.updateEventDisplayName`.

Les exports historiques de `api/supabaseClient` n’ont pas été modifiés. Ils restent disponibles pour rollback et compatibilité, mais aucun consommateur UI identifié ne les utilise encore pour participants/juges.

## Tests ajoutés

### Participants

- `listByEvent` et mapping `event_id → eventId` ;
- ordre catégorie/seed ;
- conservation event/category/seed ;
- `upsertMany` ;
- `update` ;
- `delete`.

### Juges

- `listActive` ;
- `getById` ;
- `validateCode` ;
- `create` ;
- `update` ;
- `deactivate` ;
- `updateEventDisplayName`.

### JSON legacy

- strings ;
- objets ;
- mélange ;
- `identity_id` présent/absent ;
- `name` présent/absent ;
- sérialisation finale string, objet et ajout inchangée.

## Résultats de validation

- TypeScript `tsc --noEmit` : **réussi**.
- Suite complète : **207 tests réussis**, 2 intégrations réelles opt-in ignorées par défaut.
- Build Vite/PWA : **réussi**, 46 entrées précachées.
- Audit réseau P1 : **réussi**, aucune violation statique ou runtime.
- Routes validées : `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display`.
- `git diff --check` : **réussi**.

Le refus WebSocket Vitest sur `0.0.0.0:24678` dans le bac à sable reste non bloquant.

## Casts supprimés et restants

Supprimés dans le périmètre :

- `event.judges as any[]` ;
- callbacks `(j: any)` du traitement des juges legacy ;
- dépendance des composants aux types raw `Judge` et `ParticipantRecord` de `supabaseClient`.

Restants :

- un mapping interne de lignes participants provenant de Supabase vers le type privé `ParticipantRow` ;
- `unknown` et `Record<string, unknown>` dans le parser JSON, utilisés volontairement comme frontière sûre ;
- plusieurs casts `any` préexistants dans `GenerateHeatsPage`, `AdminInterface` et `JudgeInterface`, hors chemins repository participants/juges et non modifiés afin de ne pas élargir P2.5.3.

## Cycles

Aucun nouveau cycle repository/API :

- les repositories importent les modules API ;
- les modules API n’importent jamais les repositories ;
- les contrats ne dépendent ni de Supabase ni de React ;
- les consommateurs importent les repositories, pas les modules API.

Le couplage historique `BaseRepository → lib/supabase/offlineStore` reste commun aux repositories existants. Il n’est pas spécifique à participants/juges et sa modification dépasserait ce lot.

## Rollback

Le rollback est consommateur par consommateur : remettre l’import historique depuis `api/supabaseClient`, puis les clés snake_case attendues par l’UI. Les fonctions API et leurs exports ayant été conservés, aucun rollback SQL ou de données n’est requis.

`ParticipantRepository` conserve également ses alias legacy `fetchParticipants`, `upsertParticipants`, `updateParticipant` et `deleteParticipant` pendant la période de réversibilité.

## Risques ouverts

- Les tests de repository isolent la couche Supabase par mocks ; les comportements SQL restent ceux des modules API inchangés.
- Les entrées JSON invalides hors union legacy sont filtrées par le parser au lieu d’être exposées aux consommateurs. Les formes officiellement observées et demandées sont toutes conservées sans changement.
- `api/supabaseClient` expose encore les fonctions historiques par décision de compatibilité ; leur suppression éventuelle nécessitera un lot séparé.

## Contraintes respectées

Aucun SQL, WAL, scoring, timer, Cloud ↔ HP, ESP32, route P1, `event-box`, `beach` ou format JSON `events.judges` modifié.
