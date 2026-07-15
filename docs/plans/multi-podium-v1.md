# Plan Multi-Podium V1

## Objectif

Permettre a l'application de gerer deux series en parallele sur site, avec deux podiums separes. Chaque podium doit avoir sa propre serie en cours, ses juges, son juge priorite, son timer, son display et son boitier ESP32 priorite si utilise.

## Baseline: V0 Terrain Stable

La version actuelle est consideree comme la **V0 terrain stable**.

La V0 doit rester fonctionnelle pendant toute l'evolution :
- un evenement;
- un heat actif par evenement;
- un groupe de juges;
- une interface juge priorite;
- un display;
- un flux HP/LAN avec `./event-box` et `./beach`;
- une synchronisation Cloud -> HP avant event, puis HP -> Cloud apres event.

Toute evolution multi-podium doit etre additive et compatible avec la V0. Si aucun podium n'est precise, l'application doit se comporter comme aujourd'hui, avec un podium implicite `A`.

## Principe Cible

Le nouveau modele introduit une dimension `podium_id` ou `area_id`.

```text
Event
  Podium A
    heat actif A
    juges A
    juge priorite A
    timer A
    display A
    ESP32 A

  Podium B
    heat actif B
    juges B
    juge priorite B
    timer B
    display B
    ESP32 B
```

Les scores restent attaches au `heat_id`. C'est l'invariant principal a conserver pour eviter tout melange de notes.

## Changements De Donnees

### Active Heat Pointer

Aujourd'hui, `active_heat_pointer` represente un heat actif par evenement. Pour V1, il doit representer un heat actif par evenement et par podium.

Modele cible :
- `event_id`
- `event_name`
- `podium_id`
- `active_heat_id`
- `updated_at`

Contrainte cible :
- unique `(event_id, podium_id)`

Compatibilite V0 :
- si `podium_id` est absent, utiliser `A`.

### Heat Realtime Config

`heat_realtime_config` reste indexe par `heat_id`. Il stocke deja le timer, le statut et `config_data`.

A ajouter ou deriver :
- podium courant du heat lorsqu'il est lance;
- config de juges par podium;
- priorite par heat, deja compatible car stockee dans `config_data`.

### ESP32 Priority RPC

La fonction actuelle `get_active_priority()` prend le dernier heat modifie. Ce comportement n'est pas compatible multi-podium.

Modele cible :

```sql
get_active_priority(p_event_id bigint, p_podium_id text)
```

Fallback V0 :
- `p_podium_id = 'A'` par defaut;
- event courant resolu comme aujourd'hui seulement si necessaire.

## Routes Frontend Cibles

Routes V0 conservees :
- `/judge`
- `/priority`
- `/display`

Routes V1 recommandees :
- `/judge?eventId=17&podium=A&position=J1`
- `/judge?eventId=17&podium=B&position=J1`
- `/priority?eventId=17&podium=A`
- `/priority?eventId=17&podium=B`
- `/display?eventId=17&podium=A`
- `/display?eventId=17&podium=B`
- `/overlay?eventId=17&podium=A`
- `/overlay?eventId=17&podium=B`

Sans parametre `podium`, la valeur par defaut est `A`.

## Admin

L'admin doit pouvoir :
- declarer les podiums actifs (`A`, `B`);
- affecter une serie a un podium;
- lancer/pauser/terminer le timer du podium A sans toucher au podium B;
- generer les liens kiosque de juges par podium;
- generer les liens de priorite par podium;
- generer les liens display/overlay par podium;
- voir en un coup d'oeil les deux heats actifs.

## Juges

Chaque tablette juge doit etre liee a :
- un evenement;
- un podium;
- une position de juge (`J1`, `J2`, etc.);
- une identite de juge si l'auth juge est active.

Les stations peuvent porter le meme nom sur deux podiums (`J1` sur A et `J1` sur B) tant que le `heat_id` differe. Les scores doivent continuer a etre filtres par `heat_id`.

Regle terrain obligatoire :
- une meme identite officielle de juge ne peut etre active que sur un seul podium a la fois;
- un juge ne peut pas etre affecte deux fois dans le meme panel;
- les postes techniques (`J1`, `J2`, etc.) peuvent exister sur chaque podium, mais ils doivent pointer vers des juges officiels differents si les podiums tournent en parallele.

## Priorite

Chaque podium a son juge priorite dedie.

La priorite reste stockee par heat dans `heat_realtime_config.config_data.priorityState`. Le point critique est que `/priority` doit suivre le heat actif du bon podium.

## Display Et Overlay

Chaque display doit lire le heat actif de son podium.

Options :
- un display par podium;
- un display combine affichant les deux podiums cote a cote, a traiter comme une evolution ulterieure.

Pour V1, prioriser un display separe par podium.

## ESP32

Chaque boitier ESP32 priorite doit savoir quel podium il sert.

Options de configuration :
- constante compilee `PODIUM_ID = "A"` ou `"B"`;
- page web de configuration ESP32 pour changer le podium;
- parametre stocke en `Preferences`.

Pour V1 terrain, commencer simple :
- boitier A flashe/configure en `A`;
- boitier B flashe/configure en `B`.

## Scripts HP / Sync

Le HP reste source de verite pendant l'evenement.

La sync HP -> Cloud doit transporter :
- les deux active heat pointers;
- les heat configs des deux podiums;
- les scores de tous les heats;
- les priorites et timers par heat.

La logique Cloud -> HP avant event ne doit pas effacer les donnees terrain sans confirmation explicite.

## Phasage Propose

### Phase 0: Gel V0

- Documenter la V0 comme mode stable.
- Ajouter des tests/regressions sur le comportement actuel.
- Verifier que `podium=A` implicite ne change rien.

Etat initial pose:
- `podium=A` est le fallback officiel pour conserver le comportement V0.
- Les routes existantes restent valides sans parametre `podium`.

### Phase 1: Modele DB

- Ajouter `podium_id` a `active_heat_pointer`.
- Migrer les lignes existantes en `podium_id='A'`.
- Ajouter la contrainte unique `(event_id, podium_id)`.
- Adapter les RPC d'upsert active heat.

Etat initial pose:
- Migration ajoutee: `20260715090000_add_podium_to_active_heat_pointer.sql`.
- `upsert_active_heat_pointer` accepte `p_podium_id`, avec wrapper legacy pour la signature V0.
- Les helpers frontend acceptent `podiumId`, avec `A` par defaut.
- Les subscriptions `active_heat_pointer` filtrent par podium.
- Les scripts de sync HP/Cloud ont ete prepares pour conserver plusieurs pointeurs par evenement.

### Phase 2: Runtime Frontend

- Lire `podium` depuis l'URL.
- Propager `podiumId` dans les stores et subscriptions.
- Adapter `/judge`, `/priority`, `/display`, `/overlay`.
- Garder le fallback `A`.

### Phase 3: Admin Terrain

- Ajouter le selecteur de podium.
- Lancer une serie sur A ou B.
- Generer les liens kiosque par podium.
- Afficher deux panneaux d'etat live.

Etat initial pose:
- Le panneau d'acces admin propose un selecteur `Podium A / Podium B`.
- Les liens `/judge`, `/priority` et `/display` generes par l'admin incluent `podium=A/B`.
- Les liens directs `J1` a `J5` incluent aussi le podium.
- Les ecritures V0 existantes vers `active_heat_pointer` restent explicitement sur `podium=A`.
- Le bouton `Affecter le heat courant` ecrit le heat courant dans `active_heat_pointer` pour le podium selectionne.
- Les tablettes `podium=B` ignorent le signal global `event_last_config` et suivent le pointeur actif du podium B.

Mode d'emploi provisoire V1:
1. Dans l'admin, selectionner le heat a utiliser.
2. Dans le panneau d'acces, choisir `Podium A` ou `Podium B`.
3. Cliquer `Affecter le heat courant`.
4. Distribuer les liens juges/priorite/display generes pour ce podium.

### Phase 4: ESP32

- Adapter `get_active_priority` avec `event_id` et `podium_id`.
- Ajouter `PODIUM_ID` cote firmware.
- Tester deux ESP32 en parallele sur le LAN HP.

Etat initial pose:
- Migration ajoutee: `20260715093000_get_active_priority_by_podium.sql`.
- `get_active_priority(p_event_id, p_podium_id)` lit le pointeur actif du podium demande.
- `get_active_priority(p_podium_id)` permet a un boitier ESP32 de lire son podium sans connaitre l'event courant.
- Le daemon HP SSE accepte `/priority/sse?podium=A` et `/priority/sse?podium=B`, puis isole les flux par podium.
- Le firmware ESP32 expose `PODIUM_ID`; flasher un boitier en `A` et l'autre en `B`.
- Le polling cloud de l'ESP32 appelle `get_active_priority?p_podium_id=A/B`.

### Phase 5: Sync Et Validation Terrain

- Verifier Cloud -> HP et HP -> Cloud avec deux podiums.
- Tester deux series simultanees :
  - notes podium A;
  - notes podium B;
  - priorite A;
  - priorite B;
  - timers independants;
  - displays independants;
  - cloture et resultats.

### Phase 6: Verrous Juge / Podium

- Bloquer l'affectation d'une meme identite officielle sur deux podiums actifs.
- Bloquer l'affectation d'une meme identite officielle deux fois dans un meme heat.
- Remonter l'erreur cote admin avant le demarrage.
- Garder le verrou cote base pour proteger le cloud, le HP et les sync offline.

Etat initial pose:
- Migration ajoutee: `20260715103000_lock_judge_to_single_active_podium.sql`.
- Trigger sur `active_heat_pointer`: impossible d'activer un heat si un juge officiel est deja actif sur un autre podium du meme evenement.
- Trigger sur `heat_judge_assignments`: impossible de modifier une affectation active qui creerait un conflit podium.
- Trigger sur `heat_judge_assignments`: impossible de mettre la meme identite officielle deux fois dans le meme panel.
- L'admin grise les juges deja pris et bloque le demarrage si une collision subsiste.

## Risques

- Un pointeur actif global non migre peut faire basculer toutes les tablettes sur le meme heat.
- Un ESP32 sans `podium_id` peut afficher la priorite du mauvais podium.
- Les liens kiosque doivent etre explicites, sinon deux `J1` peuvent preter a confusion.
- Le live display public peut devenir ambigu si on ne separe pas les URLs.

## Decision

On garde la V0 comme socle stable et on implemente V1 en compatibilite ascendante. La regle simple :

> sans `podium`, comportement V0; avec `podium=A/B`, comportement multi-podium.
