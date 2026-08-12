# SURFJUDGING — P2.7.7 MAMELLES BROWSER ACCEPTANCE REPORT

## A. Playwright installation

État au terme de la reprise du 11 août 2026 : **LOADED — NO BROWSER BACKEND AVAILABLE**.

La session a bien été rechargée. `codex mcp list` expose désormais :

```text
node_repl  enabled
playwright enabled
```

Le catalogue d'outils de la session contient aussi les commandes `mcp__playwright__browser_*`. La connexion navigateur conforme a ensuite été tentée réellement sur `http://192.168.1.41:8080/admin`. Elle échoue avant toute navigation avec :

```text
No browser is available
```

Le diagnostic prescrit par le runtime confirme :

```text
agent.browsers.list() = []
```

La consigne de reprise imposant un arrêt immédiat si Playwright n'est pas réellement invocable, aucune opération Mamelles n'a été exécutée.

Configuration inspectée avant modification : `codex mcp list` ne contenait que `node_repl` actif et `computer-use` désactivé. Aucun fichier `.codex/config.toml` projet n'existait. La configuration globale existante n'a pas été écrasée.

Commande additive utilisée :

```text
codex mcp add playwright -- npx -y @playwright/mcp@latest
```

Résultat :

```text
name: playwright
transport: stdio
command: npx
args: -y @playwright/mcp@latest
enabled: true
```

Le paquet officiel répond à `--help`. Playwright 1.58.0 et ses navigateurs sont présents : Chromium, Chromium headless shell et ffmpeg dans le cache Playwright local.

Le rechargement de session a donc résolu l'exposition des outils, mais pas la disponibilité d'un backend navigateur contrôlable.

## B. Browser capability

```text
PLAYWRIGHT MCP: FAIL (outils chargés, aucun backend navigateur disponible)
BROWSER NAVIGATION: FAIL / BLOCKED
SCREENSHOT: FAIL / BLOCKED
CONSOLE INSPECTION: FAIL / BLOCKED
NETWORK INSPECTION: FAIL / BLOCKED
LOCAL STORAGE: FAIL / BLOCKED
INDEXEDDB: FAIL / BLOCKED
```

La tentative réelle de sélection sur `http://192.168.1.41:8080/admin` et l'inventaire de diagnostic retournent tous deux l'absence de navigateur. Aucun fallback standalone n'a été utilisé pour éviter de prétendre avoir validé le MCP.

## C. Mamelles event selected

```text
event_id: 10
competition: MAMELLES OPEN
organizer: LARAISE
date: 2026-08-10
status: pending
active pointer: podium A → mamelles_open_benjamin_r1_h1
```

Un seul événement Mamelles existe. Aucun doublon n'a été créé.

## D. Category selected

Catégorie recommandée pour la reprise navigateur : **JUNIOR**.

Motifs :

- six participants existants ;
- Round 1 avec deux heats de trois surfeurs ;
- Round 2/finale avec un heat de quatre places qualifiées ;
- aucun score existant ;
- aucune affectation juge existante ;
- progression complète courte mais réelle, adaptée à une première certification persistante.

CADET constitue une bonne seconde progression mais comporte 4 heats R1, 2 heats R2 et 1 finale. BENJAMIN n'est pas retenu : il possède déjà 12 scores persistants et le pointeur podium A le référence.

## E. Existing starting state

Catégories Mamelles :

```text
BENJAMIN: 8 participants, R1=2 heats, R2=1 heat, 12 scores existants
CADET: 13 participants, R1=4 heats, R2=2 heats, R3=1 heat
JUNIOR: 6 participants, R1=2 heats, R2=1 heat
MINIME: 4 participants, R1=1 heat
ONDINE OPEN: 5 participants, R1=1 heat
ONDINE U16: 6 participants, R1=2 heats, R2=1 heat
OPEN: 20 participants, R1=5 heats, R2=3 heats, R3=2 heats, R4=1 heat
```

JUNIOR R1 H1 :

```text
RED: Babacar Sene
WHITE: Mouhamed Diawara
YELLOW: Buye Assane Gueye
status: open, inactive
scores: 0
assignments: 0
```

JUNIOR R1 H2 :

```text
RED: Issa Ndoye
WHITE: Djibril Sarr (Mbaye Dip)
YELLOW: omar ngalla ndoye
status: open, inactive
scores: 0
assignments: 0
```

JUNIOR R2 H1 possède quatre places non résolues : deux `QUALIFIÉ R1-H1` et deux `QUALIFIÉ R1-H2`.

Juges officiels disponibles :

```text
CHARLES    → 5164895e-51e9-42f2-9583-80a3e36cc435
J1MAIMOUNA → 442df135-52cb-4037-895f-5a174de825ca
JKHADIJA   → c724401b-46ba-4b3e-8227-d8c46110eb2e
```

Backup d'urgence créé avant toute mutation :

```text
/tmp/p2_7_7_before_mamelles_browser_test_public.dump
```

## F. Round-by-round progression

**BLOCKED BEFORE FIRST MUTATION.** Aucun heat Mamelles n'a été configuré, scoré, fermé ou avancé pendant ce tour, car le navigateur MCP n'était pas invocable.

Point de reprise prévu : `MAMELLES OPEN → JUNIOR → Round 1 → Heat 1` via `/admin`.

## G. Realtime observations

Non testé dans P2.7.7 : aucune saisie navigateur n'a eu lieu.

## H. Refresh/reconnect results

Non testé : navigateur indisponible dans la session active.

## I. Display results

Non testé.

## J. Priority results

Non testé.

## K. Heat history diagnostic

Non modifié et non retesté. Le constat P2.7.6 reste à investiguer par le workflow UI de clôture.

## L. Final ranking

Non disponible : progression non commencée.

## M. Database consistency

Audit strictement read-only effectué. Les données Mamelles observées sont restées inchangées. Aucun nettoyage, reset ou restore n'a été exécuté.

## N. Screenshots/artifacts

Aucune capture produite, puisque ni Playwright MCP ni le navigateur intégré n'étaient invocables. Le dossier d'artefacts ne doit être créé qu'au moment de la première capture réelle.

## O. Problems discovered

### P277-01 — BLOCKER — MCP chargé mais aucun backend navigateur disponible

```text
scenario: reprendre la session puis sélectionner un navigateur pour l'URL LAN /admin
expected: backend navigateur sélectionné, navigation et snapshot possibles
observed: outils Playwright chargés, mais sélection = "No browser is available" et inventaire = []
probable layer: connexion/disponibilité du backend navigateur Codex
reproducible: yes dans la reprise du 11 août 2026
next action: rendre un backend navigateur disponible dans la session, puis reprendre sans modifier Mamelles avant validation
```

Ce blocage est environnemental et non un défaut Surfjudging. Il empêche néanmoins toute validation browser-driven demandée.

## P. Files modified

- configuration globale Codex : ajout de `[mcp_servers.playwright]` via le CLI officiel ;
- `P2_7_7_MAMELLES_BROWSER_ACCEPTANCE_REPORT.md`.

Aucun fichier applicatif, migration, ACL, RLS, scoring, planning, Realtime, WAL ou PWA n'a été modifié.

## Q. DB data intentionally preserved

Toutes les données Mamelles préexistantes ont été préservées exactement. Aucune nouvelle donnée Mamelles n'a été créée ou mise à jour dans ce tour.

Le backup est emergency-only et n'a pas été restauré.

## R. FINAL VERDICT

# MAMELLES CATEGORY BLOCKED

La progression est volontairement arrêtée avant la première mutation. Le serveur MCP et ses outils sont maintenant chargés, mais aucun backend navigateur n'est disponible. La preuve exigée — navigation, DOM, console, réseau, storage et screenshots — reste impossible dans cette session.

## P2.7.7A Browser Backend Diagnostic — 11 août 2026

Le serveur `@playwright/mcp` installé est un serveur autonome qui lance son propre navigateur par défaut (mode A). Il supporte aussi `--browser`, `--executable-path`, `--cdp-endpoint` et, séparément, `--extension`. La configuration initiale ne demandait ni Chrome existant, ni extension, ni endpoint Codex.

```text
Playwright direct launch: PASS
Chromium process: PASS
LAN admin navigation: PASS (HTTP 200, title "Surf Judging System")
Chromium executable: /Users/rene/Library/Caches/ms-playwright/chromium-1208/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
Chromium headless shell: /Users/rene/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-x64/chrome-headless-shell
Google Chrome: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
MCP mode: autonomous Chromium, headless, explicit executable path
MCP server: npx -y @playwright/mcp@latest
Browser backend: configured; session reload pending
Codex reload required: YES
Browser navigation: BLOCKED pending reload and real MCP invocation
DOM snapshot: BLOCKED pending reload
Screenshot: BLOCKED pending reload
Console: BLOCKED pending reload
Network: BLOCKED pending reload
LocalStorage capability: supported by Playwright evaluate; not yet validated in reloaded MCP
IndexedDB capability: supported by page evaluation; not yet validated in reloaded MCP
```

Le lancement direct échoue dans le bac à sable macOS avec `SIGABRT`/`EPERM`, puis réussit sans restriction avec le même binaire. Il ouvre `about:blank`, puis `http://192.168.1.41:8080/admin` avec succès. Cela exclut un défaut du binaire Chromium et une indisponibilité du LAN.

Configuration ciblée appliquée au seul serveur Playwright :

```text
args = -y @playwright/mcp@latest --headless --executable-path <chemin Chromium validé>
```

Fichier de configuration modifié :

```text
/Users/rene/.codex/config.toml
```

Aucun mode extension n'a été installé ou configuré, car le lancement autonome fonctionne. La session courante conserve le processus MCP chargé avant cette modification; une nouvelle session est indispensable pour la validation MCP réelle demandée.

```text
BROWSER BACKEND STILL BLOCKED (CODEX RELOAD REQUIRED)
SURFJUDGING CODE MODIFIED: NO
MAMELLES DATA MODIFIED: NO
```

## P2.7.7A Reprise après redémarrage Codex — 11 août 2026

### Browser backend

**BROWSER BACKEND READY.** La nouvelle session charge bien :

```text
npx -y @playwright/mcp@latest --headless --executable-path /Users/rene/Library/Caches/ms-playwright/chromium-1208/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
```

Validation MCP réelle :

```text
browser open: PASS (about:blank)
LAN /admin: PASS; redirect attendu vers /my-events
page title: Surf Judging System
DOM/accessibility snapshot: PASS
screenshot: PASS
console: PASS (inspection disponible)
network: PASS (inspection disponible)
localStorage: PASS
IndexedDB: PASS (SurfJudging, version 2)
```

Captures :

- `p2-7-7a-admin-initial.png`
- `p2-7-7-blocker-junior-r1h1.png`

### Reprise UI Mamelles

Workflow Admin réel exécuté : `MAMELLES OPEN -> JUNIOR -> Round 1 -> Heat 1`.

Sélections effectuées dans l'UI :

```text
J1 CHARLES
J2 J1MAIMOUNA
J3 JKHADIJA
ROUGE Babacar Sene
BLANC Mouhamed Diawara
JAUNE Buye Assane Gueye
```

Les RPC UI `set_podium_judge_panel` et `activate_heat_on_podium` ont répondu HTTP 200. Le pointeur du podium A et le panel ont donc été conservés tels qu'établis par le workflow. Aucun score n'a été saisi, supprimé ou nettoyé.

### P277-02 — BLOCKER — enregistrement de configuration refusé par RLS

Au clic UI réel sur `SAUVEGARDER`, les lectures restent disponibles mais les écritures directes sont refusées :

```text
PATCH /rest/v1/events?id=eq.10 -> 401 Unauthorized
POST /rest/v1/heats?on_conflict=id -> 401 Unauthorized
POST /rest/v1/heat_configs?on_conflict=heat_id -> 401 Unauthorized

heats: new row violates row-level security policy for table "heats"
heat_configs: permission denied for table heat_configs
```

La lecture de `score_overrides` retourne également HTTP 401 (`permission denied for table score_overrides`). L'UI conserve une configuration locale `configSaved=true`, mais la persistance canonique du heat a échoué. Le bouton `Start` reste inutilisable sans configuration persistée.

Classification : **BLOCKER** pour la progression P2.7.7, car les contextes J1/J2/J3/Display ne peuvent pas être certifiés sans configuration canonique du heat. Arrêt avant toute note et avant toute clôture, conformément au protocole. Aucun contournement SQL, reset ou nettoyage Mamelles n'a été exécuté.

```text
FINAL VERDICT: MAMELLES CATEGORY BLOCKED ON FIELD RLS
BROWSER BACKEND READY: YES
MAMELLES SCORES MODIFIED: NO
MAMELLES DATA CLEANED: NO
```
