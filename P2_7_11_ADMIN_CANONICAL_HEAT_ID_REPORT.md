# SURFJUDGING — P2.7.11 — ADMIN CANONICAL HEAT ID SCORING FIX

## A. Scope

Objectif du chantier du 11 août 2026 :

- préserver l’état Mamelles existant ;
- corriger la chaîne Admin qui lisait encore le heat courant sous une identité courte `r1_h1` ;
- revalider le bundle field réellement servi sur le LAN ;
- certifier ensuite, si le chemin redevenait canonique, une seule nouvelle note réelle :
  - `J2 / J1MAIMOUNA / ROUGE / V1 / 7.50`.

Aucune suppression, aucun reset, aucune clôture, aucune qualification, aucune modification ACL/RLS, aucune réparation SQL manuelle n’ont été effectués.

## B. Starting state preserved

État de départ conservé :

- event_id `10`
- event `MAMELLES OPEN`
- division `JUNIOR`
- round `1`
- heat `1`
- canonical heat_id `mamelles_open_junior_r1_h1`
- status `open`

Score réel préexistant conservé :

- `J1 / CHARLES / ROUGE / V1 / 7.00`
- `judge_identity_id = 5164895e-51e9-42f2-9583-80a3e36cc435`

## C. Source chain traced

Chaîne Admin du résultat canonique :

- page : `frontend/src/pages/AdminPage.tsx`
- composant : `frontend/src/components/AdminInterface.tsx`
- panel visuel : `frontend/src/components/AdminHeatResultSnapshotPanel.tsx`
- stockage config : `frontend/src/stores/configStore.ts`
- helpers heat id : `frontend/src/utils/heat.ts`
- lectures heat-scopées :
  - `frontend/src/hooks/useHeatParticipants.ts`
  - `frontend/src/api/modules/heats.api.ts`
  - `frontend/src/api/modules/scoring.api.ts`
- subscriptions realtime :
  - `frontend/src/lib/sharedHeatTableSubscriptions.ts`

## D. Root causes found

### 1. Short heat id emitted too early

Avant correctif, l’Admin lançait encore certaines lectures alors que le contexte DB canonique n’était pas complètement rétabli. Cela permettait à un heat courant de dériver temporairement vers `r1_h1`.

Source principale confirmée :

- `AdminPage.tsx`
  - `useHeatParticipants(currentHeatId)` s’exécutait avant verrou complet du contexte canonique.
  - avec `competition=''` et `division=''`, `getHeatIdentifiers(...).normalized` pouvait donner `r1_h1`.

### 2. Scores bloqués par `score_overrides`

Dans `AdminInterface.tsx`, la lecture du panneau de correction faisait échouer tout le refresh si `score_overrides` renvoyait `401`.

Effet réel :

- la requête `scores` canonique pouvait réussir ;
- mais l’Admin restait visuellement faux/stale faute d’accepter les scores quand `score_overrides` était refusé.

## E. Code changes applied

Modifications appliquées :

- `frontend/src/components/AdminInterface.tsx`
  - prop `canonicalHeatId`;
  - priorité au heat id canonique ;
  - garde `hasCanonicalHeatContext` ;
  - découplage des lectures `scores` / `score_overrides` ;
  - abonnement `subscribeToHeatScores(...)` ;
  - blocage des lectures heat-scopées tant que le contexte canonique n’est pas prêt ;
  - `resolveEventIdForCurrentHeat()` ne sonde plus `fetchHeatMetadata(heatId)` hors contexte canonique.

- `frontend/src/pages/AdminPage.tsx`
  - passage de `canonicalHeatId={currentHeatId}` à `AdminInterface` ;
  - `useHeatParticipants(...)` ne s’exécute plus tant que :
    - `loadedFromDb=true`
    - `configSaved=true`
    - `competition/division` sont présents
    - `currentHeatId !== 'r1_h1'`.

- `scripts/p2_7_11_admin_canonical_probe.mjs`
  - script Playwright dédié au contrôle field live ;
  - captures Admin/J1/J2/Display ;
  - réseau, console, localStorage, IndexedDB, accessibilité ;
  - injection conditionnelle de la note J2.

- test ajouté :
  - `frontend/src/components/__tests__/AdminInterface.canonicalHeatId.contract.test.ts`

## F. Local validation

Validations locales après patch :

- `npx tsc --noEmit` : PASS
- `npm test -- --run ...canonicalHeatId... configSave ... p2 ...` : PASS
- `25 tests passed`
- `bash -n scripts/hp-refresh-stack.sh` : PASS

## G. Field build / deployment

Release field effectivement servie :

- `surfjudging-2026.08.11-p2.7.11c-admin-canonical`
- date de vérification : `2026-08-11`
- manifest LAN confirmé sur `http://192.168.1.41:8080/deployment-manifest.json`

## H. Browser runtime used

Browser réel utilisé :

- Chromium validé :
  `/Users/rene/Library/Caches/ms-playwright/chromium-1208/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
- base URL :
  `http://192.168.1.41:8080`

Contextes contrôlés :

- `ADMIN`
- `J1`
- `J2`
- `DISPLAY`

## I. Canonical read verification before J2

### Avant correctif final `p2.7.11c`

L’Admin affichait déjà correctement la vague existante `ROUGE V1:7.00*`, mais émettait encore quelques lectures du heat courant en `r1_h1`.

### Après déploiement `p2.7.11c`

Pour le heat courant, les lectures observées sont devenues canoniques :

- `scores?heat_id=eq.mamelles_open_junior_r1_h1`
- `heat_entries?heat_id=eq.mamelles_open_junior_r1_h1`
- `v_heat_lineup?heat_id=eq.mamelles_open_junior_r1_h1`
- `heat_slot_mappings?heat_id=eq.mamelles_open_junior_r1_h1`
- `heats?id=eq.mamelles_open_junior_r1_h1`
- `heat_realtime_config?heat_id=eq.mamelles_open_junior_r1_h1`

Critère vérifié :

- plus aucune lecture du heat courant en `r1_h1`
- score canonique visible côté Admin sur `ROUGE V1:7.00*`

## J. One authorized real J2 score

Soumission réelle effectuée via UI juge :

- station `J2`
- judge `J1MAIMOUNA`
- judge_identity_id `442df135-52cb-4037-895f-5a174de825ca`
- surfer `ROUGE`
- wave `1`
- score `7.50`
- timestamp DB `2026-08-11T22:37:13.991+00:00`

## K. Post-submit convergence

### Judge J2

Affichage J2 après soumission :

- `ROUGE 1 7.5`

### Admin

Affichage Admin après soumission :

- `ROUGE Babacar Sene V1:7.25*`
- `DERNIÈRE NOTE 22:37:13`

### Display

Affichage Display après soumission :

- `BABACAR SENE ... 7.25`

Conclusion :

- la convergence score DB → Admin → Display → Judge est rétablie pour le heat courant sous l’identité canonique.

## L. Database audit

Audit read-only PostgREST après soumission :

```json
[
  {
    "id": "00000000-0000-4000-18fc-019ff2e80286",
    "event_id": 10,
    "heat_id": "mamelles_open_junior_r1_h1",
    "judge_id": "J1",
    "judge_name": "CHARLES",
    "judge_station": "J1",
    "judge_identity_id": "5164895e-51e9-42f2-9583-80a3e36cc435",
    "surfer": "ROUGE",
    "wave_number": 1,
    "score": 7.00
  },
  {
    "id": "00000000-0000-4000-3f99-019ff2f90587",
    "event_id": 10,
    "heat_id": "mamelles_open_junior_r1_h1",
    "judge_id": "J2",
    "judge_name": "J1MAIMOUNA",
    "judge_station": "J2",
    "judge_identity_id": "442df135-52cb-4037-895f-5a174de825ca",
    "surfer": "ROUGE",
    "wave_number": 1,
    "score": 7.50
  }
]
```

Constats :

- `event_id` correct ;
- `heat_id` canonique correct ;
- `judge_station` correcte ;
- `judge_identity_id` correct pour J1 et J2 ;
- aucune écriture `r1_h1` ;
- aucune réparation SQL manuelle.

## M. Realtime / polling observations

Observé côté diagnostics runtime Admin :

- channels :
  - `heat-signals:mamelles_open_junior_r1_h1`
  - `heat-config:mamelles_open_junior_r1_h1`

Observé côté console :

- `score_overrides` continue de répondre `401 permission denied`
- mais l’Admin conserve maintenant les scores et ne reste plus stale

Classification :

- problème `score_overrides` : toujours présent, mais non bloquant pour l’affichage des scores canoniques après correctif.

## N. New issue discovered after second score

Juste après la seconde note réelle, l’Admin est passé à un état inattendu :

- message :
  `HEAT DÉJÀ JUGÉ - RELANCE BLOQUÉE`
- chrono cockpit revenu à :
  - `20:00`
  - bouton `START`

alors que :

- le heat reste `OPEN`
- les 2 notes sont toujours présentes
- l’Admin/Display montrent bien `ROUGE V1:7.25*`

Impact :

- pas de perte de données constatée ;
- mais l’état opératoire du heat devient ambigu immédiatement après la seconde note.

Sévérité proposée :

- `MAJOR`

Raison :

- le bug n’a pas cassé la persistance canonique ;
- mais il change le statut opérationnel perçu du heat et peut bloquer la suite d’un run terrain sans intervention.

## O. Screenshots / artifacts

Artefacts générés :

- `artifacts/p2_7_11_admin_canonical/admin.png`
- `artifacts/p2_7_11_admin_canonical/admin_after_login.png`
- `artifacts/p2_7_11_admin_canonical/admin_after_j2_score.png`
- `artifacts/p2_7_11_admin_canonical/display.png`
- `artifacts/p2_7_11_admin_canonical/display_after_j2_score.png`
- `artifacts/p2_7_11_admin_canonical/j1.png`
- `artifacts/p2_7_11_admin_canonical/j2.png`
- `artifacts/p2_7_11_admin_canonical/j2_after_j2_score.png`
- `artifacts/p2_7_11_admin_canonical/probe.json`

## P. Problems discovered

### P2.7.11-01 — FIXED — CRITICAL

Admin lisait encore le heat courant avec une identité courte `r1_h1` sur une partie de la chaîne de lecture.

Statut :

- corrigé sur le heat courant ;
- validé sur bundle field réellement servi.

### P2.7.11-02 — TOLERATED — MINOR

`score_overrides` renvoie toujours `401 permission denied`.

Statut :

- encore présent ;
- ne bloque plus l’actualisation des scores canoniques.

### P2.7.11-03 — NEW — MAJOR

Après la 2e note réelle, l’Admin passe en :

- `HEAT DÉJÀ JUGÉ - RELANCE BLOQUÉE`
- chrono `20:00`
- bouton `START`

alors que les données de scoring sont bien persistées.

## Q. Mamelles data intentionally preserved

Données Mamelles volontairement conservées :

- J1 / CHARLES / ROUGE / V1 / 7.00
- J2 / J1MAIMOUNA / ROUGE / V1 / 7.50
- heat `mamelles_open_junior_r1_h1`
- affectations juges existantes
- config heat existante

Aucune donnée Mamelles n’a été nettoyée, restaurée ou supprimée.

## R. FINAL VERDICT

# ADMIN CANONICAL SCORING PARTIALLY CERTIFIED

Ce qui est certifié :

- l’Admin lit maintenant le heat courant sous l’identité canonique `mamelles_open_junior_r1_h1` ;
- l’affichage stale initial est corrigé ;
- une seconde note réelle J2 a été soumise via l’UI ;
- persistance DB, Admin, Display et identité juge convergent correctement.

Ce qui bloque la certification complète :

- après cette seconde note, l’Admin bascule dans un état opérationnel incohérent :
  - `HEAT DÉJÀ JUGÉ - RELANCE BLOQUÉE`
  - timer réinitialisé à `20:00`
  - bouton `START`

La suite P2.7.10 ne doit donc pas reprendre automatiquement tant que ce nouveau comportement n’est pas traité.
