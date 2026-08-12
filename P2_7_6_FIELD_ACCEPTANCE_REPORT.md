# SURFJUDGING — P2.7.6 FIELD ACCEPTANCE REPORT

## A. Environment

```text
date: 2026-08-11 (Africa/Dakar)
hostname: MacBook-Pro-de-Rene
LAN IP: 192.168.1.41
frontend: nginx:alpine, port 8080
Supabase/API: Kong/PostgREST, port 8000
PostgreSQL: 15.1, port 5432, database postgres
Realtime: supabase/realtime:v2.25.50, internal Docker service via Kong
priority UI: http://192.168.1.41:8080/priority
priority physical endpoint: http://priority.local
```

Services actifs observés : `postgres` healthy, `kong` healthy, `auth`, `realtime`, `rest`, `storage`; `studio` était unhealthy mais n'appartient pas au chemin terrain opérateur. Le conteneur frontend `surfjudging` a été démarré par le lanceur officiel.

URLs réellement testées :

```text
ADMIN:    http://192.168.1.41:8080/admin
JUDGE:    http://192.168.1.41:8080/judge
DISPLAY:  http://192.168.1.41:8080/display
PRIORITY: http://192.168.1.41:8080/priority
API:      http://192.168.1.41:8000/rest/v1/
```

Toutes répondent HTTP 200 depuis l'hôte LAN. Aucune instance de navigateur contrôlable n'était disponible ; HTTP 200 ne certifie donc pas le rendu interactif.

La release servie déclare `deploymentMode=field`, `releaseId=unreleased`, révision `977128bc23f8ba6ddc13515e1c3d5a3f0bac377c`, schéma attendu `20260810222000_judges_authoritative_field_registry`.

## B. Field architecture tested

```text
nginx Field :8080
  → bundle Field/PWA local
  → URL API dynamique http://<hostname LAN>:8000
  → Kong :8000
  → PostgREST / Realtime
  → PostgreSQL 15 local
```

La DB répond `get_authoritative_deployment_mode() = field`. En connexion SQL directe, `is_local_database() = true`. Le rôle `anon` possède `EXECUTE` sur `upsert_heat_config_runtime`.

Le détecteur `is_local_database()` inspecte `request.headers.host` : domaine `*.supabase.co`/`*.supabase.net` → non local ; absence d'en-têtes, hôte LAN ou autre hôte → local.

## C. Internet-off status

**SIMULATED / STATIC VALIDATION — PARTIAL.** La liaison WAN n'a pas été réellement coupée.

Le bundle Field est intégralement servi localement et le chemin Supabase Field sélectionne l'API LAN. Les références Internet trouvées sont :

- Supabase Cloud : présente dans le bundle pour le mode Cloud, non sélectionnée en mode Field — EXPECTED/NON-BLOCKING.
- Sentry : référence compilée, initialisation désactivée en mode local — EXPECTED/NON-BLOCKING.
- N8N `automation.surfjudging.cloud` : chemin optionnel derrière configuration de webhook — EXPECTED/NON-BLOCKING pour le jugement local.
- Google Sheets : import participants explicite et à la demande — EXPECTED/NON-BLOCKING après import préalable.
- Stripe / liens Supabase : parcours Cloud hors compétition locale — EXPECTED/NON-BLOCKING.
- `priority.local` : dépendance LAN physique, pas Internet — EXPECTED.

Aucune police ou image CDN bloquante n'a été identifiée dans le chemin principal. Une vraie coupure WAN multi-appareils reste requise.

## D. Test data

Un dump applicatif pré-test a été créé dans le conteneur PostgreSQL :

```text
/tmp/p2_7_6_before_acceptance_public.dump
```

Données temporaires utilisées : événement `P2.7.6 FIELD ACCEPTANCE TEST`, event `13`, heats `p2_7_6_field_h1` et `p2_7_6_field_h2`, six participants P276. Heat 1 : ROUGE/BLANC/JAUNE, 3 juges, 12 vagues. Heat 2 : BLEU/VERT/ROUGE et panel tourné. Aucune donnée BENJAMIN n'a été touchée.

Toutes les données temporaires ont été supprimées à la fin : événements=0, heats=0, scores=0 pour les identifiants P2.7.6.

## E. Acceptance matrix

| Test | Résultat | Preuve |
|---|---|---|
| Field stack | FAIL | Services actifs, mais le lanceur officiel sort en erreur sur `/RELEASE_ID` |
| Internet independence | PARTIAL | Bundle/API LAN validés statiquement ; WAN non réellement coupé |
| Admin route | PASS | `http://192.168.1.41:8080/admin` HTTP 200 ; interaction non certifiée |
| Judge route | PASS | `http://192.168.1.41:8080/judge` HTTP 200 ; interaction non certifiée |
| Display route | PASS | `http://192.168.1.41:8080/display` HTTP 200 ; rendu non certifié |
| Priority route | PASS | `http://192.168.1.41:8080/priority` HTTP 200 ; rendu non certifié |
| Create Heat | FAIL | Deux heats créés comme fixtures SQL, pas via l'UI Admin |
| Save Config | PASS | RPC anon 204, assignments 201, entries 201 |
| RPC anon | PASS | `upsert_heat_config_runtime` HTTP 204 pendant le SAVE réel API |
| Assignments 3/3 | PASS | J1/J2/J3 exacts en DB |
| Judge UUID identities | PASS | Trois UUID officiels distincts, station ≠ identité |
| Score persistence | PASS | 12/12 scores Heat 1 persistés, puis 1 score Heat 2 |
| Score calculation | PASS | ROUGE V1=7.00, ROUGE V2=6.00 ; autres moyennes cohérentes |
| Realtime J1→Admin | FAIL | Premier burst : canal SUBSCRIBED, 0/4 événements J1 |
| Realtime J2→Admin | FAIL | Premier burst : canal SUBSCRIBED, 0/4 événements J2 |
| Realtime J3→Admin | FAIL | Premier burst : canal SUBSCRIBED, 0/4 événements J3 |
| Admin refresh | FAIL | API restaure 12 scores/config/pointeur ; rendu React non testable |
| Judge refresh | FAIL | Persistance API correcte ; station/session UI non testable |
| Judge reconnect | FAIL | Realtime cold-start défaillant ; session UI non testable |
| Admin reconnect | FAIL | Polling/API récupérable mais reconnexion UI non certifiée |
| No duplicates | PASS | 12 lignes, 12 IDs uniques ; aucun doublon DB |
| Timer | PARTIAL | RPC start/warning simulé/elapsed 204 et état DB correct ; rendu/audio non testés |
| Display updates | FAIL | Premier burst Realtime 0/12 et aucun navigateur disponible |
| Priority UI | FAIL | État priority RPC/DB valide, UI non testée |
| ESP32 physical | NOT TESTED | Aucun matériel accessible |
| Close Heat | FAIL | Clôture métier réussie, mais aucune ligne `heat_history` observée |
| Heat 1→Heat 2 | PASS | RPC normal, H1 closed/inactive, H2 open/active |
| No state contamination | PASS | H2 : 0 score initial, timer null/20, config `{}`, surfers/panel distincts |
| Offline backlog | FAIL | IDB navigateur inaccessible ; absence de backlog non certifiable |
| P2.7.4 regression | PASS | `event_id=0`: 0 ; tests erreur contrôlée/configSaved=false passent |
| P2.7.5 regression | PASS | SAVE anon HTTP 204 puis assignments 3/3 |

## F. Database evidence

Après SAVE Heat 1 :

```text
heats: p2_7_6_field_h1, event_id=13, status=open, is_active=true
heat_configs: judges={J1,J2,J3}, surfers={ROUGE,BLANC,JAUNE}, waves=12
heat_judge_assignments: 3 lignes, event_id=13, aucune event_id=0
active_heat_pointer: event=13, podium=A, heat=p2_7_6_field_h1
```

Identités :

```text
J1 → 442df135-52cb-4037-895f-5a174de825ca → J1MAIMOUNA
J2 → c724401b-46ba-4b3e-8227-d8c46110eb2e → JKHADIJA
J3 → 5164895e-51e9-42f2-9583-80a3e36cc435 → CHARLES
```

Scores Heat 1 : 12 lignes, 12 IDs uniques, chaque `judge_identity_id` correspond à l'affectation de station. Moyennes DB : BLANC V1=8.00, JAUNE V1=5.00, ROUGE V1=7.00, ROUGE V2=6.00. Readiness avant clôture : `can_close=true`, score_count=12, missing_score_count=0, lineup=0, panel=3/3, orphan=0, invalid=0.

## G. Realtime evidence

Premier scénario après connexion :

```text
subscription: SUBSCRIBED
submitted: 12
received: 0
uniqueReceived: 0
DB persisted: 12/12
```

La publication `supabase_realtime` contient `scores`; le slot wal2json est actif. Les logs montrent le démarrage tardif de l'extension postgres CDC après la souscription, `Delete all subscriptions`, et une erreur `DBConnection.ConnectionError tcp recv: closed`. Cela explique probablement la fenêtre où `SUBSCRIBED` est annoncé avant que la réplication ne soit prête.

Reproduction après initialisation, sur Heat 2 actif avec une pause d'une seconde :

```text
subscription: SUBSCRIBED
submitted: 1
received: 1 INSERT
```

Conclusion : Realtime fonctionne une fois chaud, mais le premier burst peut être perdu côté notifications. Les écritures DB ne sont pas perdues et le polling peut restaurer l'état.

## H. Disconnect/reconnect evidence

Les lectures anonymes après transition ont restauré par API : 1 pointeur actif, 2 configs, 6 affectations et 12 scores Heat 1. Cela valide la persistance et la récupération par refresh/polling.

Les sessions UI, la station locale, les reconnexions Judge/Admin et les souscriptions multiples n'ont pas pu être manipulées faute de navigateur. Le défaut cold-start Realtime empêche de certifier ces scénarios.

## I. Heat transition evidence

La clôture non forcée a renvoyé HTTP 200 avec readiness valide et activation de Heat 2 :

```text
Heat 1: closed, inactive, closed_at renseigné, 12 scores conservés
Heat 2: open, active, 0 score initial
active_heat_pointer: p2_7_6_field_h2
```

Panels après `copy_podium_panel_to_heat` :

```text
Heat 1: J1=J1MAIMOUNA, J2=JKHADIJA, J3=CHARLES
Heat 2: J1=CHARLES, J2=J1MAIMOUNA, J3=JKHADIJA
```

Heat 2 ne reprend ni scores, ni timer, ni `priorityState`, ni lineup de Heat 1. En revanche, `heat_history` contenait 0 ligne pour Heat 1 après clôture.

## J. Offline/backlog evidence

Le scénario API n'a déclenché aucune file offline. La file réelle est dans IndexedDB/localStorage du navigateur et n'était pas accessible sans instance navigateur. Les tests du coordinateur offline passent, mais le backlog runtime ne peut pas être certifié à zéro.

## K. Automated tests

```text
targeted acceptance tests: PASS — 10 fichiers, 82 tests
AdminPage.configSave: PASS — 4/4
HeatRepository.assignments: PASS — 3/3
HeatRepository mutations/reads: PASS
Realtime config merge: PASS — 3/3
scoring + 5 judges: PASS
timer: PASS — 3/3
priority: PASS — 1/1
full frontend suite: PASS — 74 fichiers, 434 tests ; 7 skipped
build:field: PASS
typecheck: PASS
bash -n scripts/hp-refresh-stack.sh: PASS
```

Le test cinq juges existe et passe : suppression d'un minimum et d'un maximum, moyenne des trois notes restantes (`engine.parity.test.ts`, `scoring.test.ts`).

Vitest affiche `listen EPERM 0.0.0.0:24678` dans le sandbox, sans empêcher les tests de passer.

## L. Problems discovered

### P276-01 — MAJOR — contrôle d'intégrité de démarrage Field en échec

```text
scenario: bash scripts/start-surfjudging-field-mac.sh --no-caffeinate
expected: frontend actif et RELEASE_ID égal à la release attendue
observed: nginx démarre, puis /RELEASE_ID retourne index.html ; script exit 1
evidence: release active sans fichier RELEASE_ID, manifest releaseId=unreleased
probable layer: packaging/release Mac + garde de démarrage
reproducible: yes
recommended next chantier: fiabiliser la production/copie RELEASE_ID et interdire une release `unreleased`
```

### P276-02 — MAJOR — fenêtre de perte Realtime au démarrage à froid

```text
scenario: premier abonné scores, puis 12 écritures immédiatement après SUBSCRIBED
expected: 12 notifications, une par écriture
observed: 0/12 ; les 12 lignes sont en DB. Après warm-up : 1/1 livré
evidence: CDC démarre après subscribe, tcp recv closed, Delete all subscriptions
probable layer: Supabase Realtime self-hosted / readiness CDC / handshake
reproducible: yes on cold start; not reproduced once warm
recommended next chantier: readiness Realtime réelle, warm-up contrôlé et garantie polling immédiate
```

### P276-03 — MAJOR — absence d'archive `heat_history`

```text
scenario: clôture normale Heat 1 avec readiness verte
expected: archive/history correct selon protocole
observed: 0 ligne dans public.heat_history pour Heat 1
evidence: SQL après close_heat_on_podium HTTP 200
probable layer: workflow DB de clôture / contrat historique
reproducible: yes
recommended next chantier: clarifier le contrat d'archive puis ajouter/tester l'écriture atomique si requise
```

Les références Internet optionnelles, Studio unhealthy et les warnings Realtime `execute/3 deprecated` sont classés MINOR/NON-BLOCKING pour le jugement local.

## M. Manual tests still required

- Vraie coupure WAN avec LAN maintenu, sur plusieurs appareils.
- Parcours UI Admin complet, faux succès contrôlé et refresh visuel.
- Trois tablettes Judge : station/identité, refresh, déconnexion/reconnexion et double onglet.
- Display : classement, rafraîchissement et changement de heat visibles.
- Priority UI et ESP32 physique/LED.
- Timer visuel, warning 5 minutes, fin de heat et audio/bips.
- Inspection du backlog IndexedDB réel après scénario offline.
- Vérification des subscriptions nettoyées dans de vrais navigateurs.

## N. Files modified

- `P2_7_6_FIELD_ACCEPTANCE_REPORT.md`

Aucun code, test, scoring, ACL, RLS, migration, WAL, PWA, planning, Realtime ou ESP32 n'a été modifié. Les scripts temporaires du harnais ont été placés dans `/private/tmp`, hors dépôt.

## O. FINAL VERDICT

# NOT FIELD READY

La persistance critique est solide : P2.7.5 passe, assignments 3/3, identités exactes, scores et calculs corrects, transition Heat 1 → Heat 2 propre, tests/build/typecheck verts.

La certification terrain complète échoue néanmoins pour trois raisons : le lanceur officiel refuse la release servie, le premier burst Realtime est perdu malgré `SUBSCRIBED`, et le contrat d'historique de clôture n'est pas satisfait. Les parcours navigateur, le backlog réel, le WAN-off, l'audio et le matériel restent en outre non testés. Ces lacunes empêchent explicitement un verdict `FIELD READY`.
