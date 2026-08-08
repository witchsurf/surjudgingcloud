# P2.6.1 — Cloud + HP deployment synchronization

Date : 8 août 2026
Lot : synchronisation de déploiement uniquement, sans changement métier.

## Conclusion

**DEPLOYMENT_BLOCKED**

Deux préconditions impératives ne sont pas réunies :

1. l'accès SSH prévu au HP `admin-surfjudging@10.0.0.10` est refusé pour la clé disponible sur ce Mac ;
2. le workspace candidat n'est pas une release traçable : HEAD `cacc7f7` avec 157 chemins non commités (`55` modifiés et `102` non suivis), comprenant plusieurs lots P2 validés mais aussi des artefacts, rapports et fichiers temporaires.

Conformément à la décision opérateur, les opérations ont été arrêtées avant backup, migration ou déploiement. Cloud et HP restent divergents du candidat P2.5.7, mais aucune donnée métier n'a été modifiée.

## A — Candidat et release cible

| Élément | Observation |
|---|---|
| HEAD Git | `cacc7f7efb847de867a98ec3a9f9f17ac9ad5950` |
| Commit | `p1: restrict health probes to approved LAN hosts` |
| Date du commit | `2026-08-05T19:47:24Z` |
| Workspace | 55 fichiers modifiés, 102 non suivis |
| Release ID | **non attribué** : il serait trompeur avant création d'un commit/release propre |
| Version package | `0.0.0` |
| Build candidat local P2.5.7 | validé au lot précédent, mais issu du workspace non commité |
| Migrations minimales | `20260808090000`, `20260808110000`, `20260808130000` |
| RPC cible | `bulk_upsert_heats_safe_v2` |

Les changements P2 validés sont présents dans le workspace, mais l'état contient également des PDF exportés, des artefacts de tests, des fichiers `.temp`, des rapports et d'autres fichiers non suivis. Aucun reset, nettoyage ou commit automatique n'a été effectué afin de ne rien perdre et de ne pas sélectionner arbitrairement le contenu d'une release.

## B — Traçabilité du workspace

L'état actuel ne satisfait pas la règle « ne pas déployer un workspace ambigu ». Un commit de release doit sélectionner explicitement :

- les sources frontend et tests validés P0–P2.5.7 ;
- les trois migrations validées de planning sûr ;
- les scripts et documents opérationnels validés ;
- en excluant les dumps, PDF générés, caches `.temp`, `dist-xlsx-spike` et autres artefacts qui ne font pas partie du produit.

Cette sélection n'a pas été faite dans ce lot bloqué. Aucun changement existant n'a été écrasé.

## C — Cloud avant mutation

| Contrôle | Résultat |
|---|---|
| Frontend | `https://surfjudging.cloud`, HTTP 200 |
| Bundle | `index-BL7ppu5I.js` |
| CSS | `index-B-L5X5N4.css` |
| Dernière modification HTML observée | 15 juillet 2026 |
| PWA XLSX | aucun `xlsxParser-*.js` trouvé dans `sw.js` |
| Release ID visible | absent/non déterminé |
| Version schéma Cloud | non lisible : résolution DNS du domaine Supabase en échec pendant trois tentatives |
| RPC safe v2 | non vérifiée côté Cloud |

Le Cloud sert donc également une version antérieure au workflow XLSX/P2.5.7. Aucune mutation Cloud n'a été lancée.

## D — HP avant mutation

| Contrôle | Résultat |
|---|---|
| HP réel | `10.0.0.10` |
| Ping | 3/3, moyenne 4,862 ms |
| Frontend | `http://10.0.0.10:8080`, HTTP 200 |
| Bundle | `index-BYhE1xWF.js` |
| CSS | `index-CYPhPhik.css` |
| Supabase | `http://10.0.0.10:8000`, HTTP 200, PostgREST 11.2.0 |
| Stamp schéma | `20260727210000_add_event_operations_health` |
| RPC safe v2 | non présente dans l'état de schéma attendu ; marqueur absent du bundle |
| PWA XLSX | aucun `xlsxParser-*.js` trouvé dans `sw.js` |
| Routes | `/admin`, `/chief-judge`, `/participants`, `/judge`, `/priority`, `/display` : HTTP 200 |
| Lecture DB | endpoint REST `events` : HTTP 200 |
| Conteneurs | non inspectables sans SSH |

Les migrations `20260808090000`, `20260808110000` et `20260808130000` ne sont pas installées d'après le stamp runtime.

## E — Accès HP

La tentative conforme au runbook :

```text
ssh -o BatchMode=yes admin-surfjudging@10.0.0.10
```

retourne `Permission denied (publickey,password)`.

Le répertoire SSH de ce Mac ne contient pas de clé utilisateur standard ; sa configuration inclut uniquement la configuration Colima. Aucune clé privée n'a été recherchée hors des emplacements prévus, copiée, créée ou installée. Aucun contournement de sécurité n'a été tenté.

Condition de reprise : utiliser un poste possédant déjà la clé autorisée ou installer proprement la clé publique de ce Mac depuis un poste déjà autorisé, selon le runbook.

## F — Backup avant migration

Non exécuté, car l'accès SSH HP est indisponible. Par conséquent :

- aucun dump HP créé ;
- aucun SHA-256 HP vérifié ;
- aucune migration HP lancée.

Le mécanisme documenté est `scripts/hp-backup.sh` via `scripts/hp-ops.sh backup`. Le mécanisme de snapshot Cloud n'a pas pu être confirmé par accès opérateur. Aucun restore n'a été tenté. R15 reste ouvert.

## G — Déploiement DB

Non exécuté sur Cloud ni HP. L'ordre requis reste :

1. `20260808090000_planning_safety_preflight.sql` ;
2. `20260808110000_safe_planning_inactive_payload.sql` ;
3. `20260808130000_atomic_safe_planning_heat_configs.sql`.

Les contrôles de signature, grants, contrainte de statut et absence de droits directs sur `heat_configs` restent ouverts sur les deux cibles.

## H — Déploiement frontend

Non exécuté. Aucun `SURFJUDGING_RELEASE_ID` n'a été injecté, car aucune release Git propre n'existe encore. Aucun des deux anciens bundles n'a été remplacé.

## I — PWA et cache

| Cible | Bundle actuel | XLSX précaché | État |
|---|---|---:|---|
| Cloud | `index-BL7ppu5I.js` | non | ancien |
| HP | `index-BYhE1xWF.js` | non | ancien |

Aucune invalidation de cache client n'a été effectuée : le serveur doit d'abord recevoir la nouvelle release. Aucun navigateur terrain n'a été modifié.

## J — Matrice de parité avant déploiement

| Élément | Cloud | HP | Match |
|---|---|---|---:|
| Release ID | absent | absent | non prouvé |
| Git revision déployée | inconnue | inconnue | non prouvé |
| Bundle | `index-BL7ppu5I.js` | `index-BYhE1xWF.js` | **non** |
| Version schéma | non lisible | `20260727210000...` | non prouvé |
| Migrations août | non vérifiées | absentes | non |
| RPC v2/signature | non vérifiée | non disponible dans le schéma installé | non |
| Status check | non vérifié | non vérifié | non prouvé |
| PWA XLSX | absent | absent | oui, mais ancienne capacité |
| Routes principales | frontend accessible | toutes HTTP 200 | partiel |
| Planning sûr P2.5.6l | absent du bundle observé | absent du bundle observé | oui, mais tous deux anciens |

La parité critique avec le candidat n'est pas établie.

## K — Smoke non destructif

Cloud : GET frontend et `/admin` réussis.
HP : frontend, `/admin`, `/participants`, `/judge`, `/priority`, `/display`, alias `/chief-judge` et lecture REST DB réussis.

La sonde directe choisie pour la santé Realtime HP retourne 404 ; cela ne suffit pas à conclure sur Realtime, qui doit être contrôlé via le diagnostic applicatif ou une vraie souscription après synchronisation. Aucun événement n'a été créé.

## L — Test temporaire

Non autorisé avant parité ; donc non exécuté. Zéro fixture et zéro nettoyage métier nécessaire.

## Procédure future obligatoire

Aucun lot fonctionnel ne peut devenir `FIELD_READY` tant que :

```text
CODE_SYNC = TRUE
SCHEMA_SYNC = TRUE
CLOUD_HP_RELEASE_MATCH = TRUE
```

Séquence de reprise, à intégrer au runbook lors du lot de synchronisation effectivement exécutable :

1. sélectionner et committer le candidat validé ;
2. attribuer un `SURFJUDGING_RELEASE_ID` unique ;
3. produire et vérifier les backups Cloud et HP ;
4. appliquer uniquement les trois migrations validées sur Cloud ;
5. appliquer les mêmes migrations sur HP ;
6. construire une fois le frontend depuis la même révision/release ;
7. déployer le même artefact sur Cloud et HP, avec différences d'environnement documentées ;
8. invalider et contrôler les caches PWA ;
9. vérifier la matrice de parité complète ;
10. exécuter les smokes non destructifs puis le test temporaire nettoyable ;
11. reprendre exactement P2.6.0, sans ouvrir de nouvelle phase.

## Rollback

Aucun déploiement n'ayant eu lieu, aucun rollback n'est nécessaire. Les versions Cloud et HP existantes restent intactes. Lors de la reprise, les chemins de rollback devront être matérialisés avant mutation : dump vérifié, artefact frontend précédent identifié et procédure de retour de release documentée.

## Blockers

1. accès SSH HP non autorisé depuis ce Mac ;
2. workspace non commité et ambigu ;
3. mécanisme/snapshot Cloud non vérifié ;
4. DNS Supabase Cloud indisponible pendant le contrôle du schéma ;
5. absence d'une release ID unique et d'un artefact commun Cloud/HP.

Aucun nouveau refactor, changement métier, SQL, déploiement ou mutation de données n'a été effectué.
