# P2.6.0 — Real HP field validation checkpoint

Date : 8 août 2026
Nature : validation terrain uniquement, sans refactor ni correction fonctionnelle.

## Conclusion

**FIELD_BLOCKED**

Le véritable HP/Event Box a finalement été localisé à `10.0.0.10`. Il répond sur le LAN, sert le frontend sur `:8080` et Supabase sur `:8000`. Il n'est toutefois **pas aligné sur le candidat P2.5.7** : sa version runtime de schéma est `20260727210000_add_event_operations_health`, les trois migrations d'août requises ne sont donc pas installées, le bundle servi ne contient aucun marqueur safe-v2 recherché et son service worker ne précache aucun chunk XLSX.

Continuer vers l'import et les mutations terrain dans cet état testerait une ancienne version et serait dangereux. Aucun événement temporaire n'a été créé et aucune base de compétition n'a été modifiée.

## A — Environnement HP

| Contrôle | Résultat |
|---|---|
| Machine de contrôle | `MacBook Pro de René` / `MacBook-Pro-de-Rene` |
| IP machine de contrôle | `192.168.1.16/24` |
| Révision Git locale relevée | `cacc7f7` avec le travail P2 non commité présent dans le workspace |
| Adresse HP réelle observée | `10.0.0.10` |
| Adresse HP terrain attendue | `192.168.1.2` selon le runbook ; non active depuis le réseau courant |
| Adresse HP maison typique | `10.0.0.14` ; le runbook mentionne également `10.0.0.20` dans les exemples SSH |
| Réponse HP | ping 3/3, moyenne 4,862 ms |
| Port frontend réel | `8080`, HTTP 200 |
| Port Supabase réel | `8000`, PostgREST 11.2.0, HTTP 200 |
| URL tablettes observée | `http://10.0.0.10:8080/<route>` |
| Version frontend déployée | ancien bundle `index-BYhE1xWF.js`, date HTTP du HTML : 27 juillet 2026 |
| Migrations présentes sur le HP | migrations P2.5.6i/k requises absentes d'après le stamp runtime |
| Version schéma HP | `20260727210000_add_event_operations_health` |
| SSH | port accessible mais authentification refusée pour la clé disponible sur ce Mac |

Routes passives validées HTTP 200 : `/admin`, `/chief-judge`, `/judge`, `/priority`, `/display`, `/participants`. La sonde REST `events?select=id&limit=1` répond HTTP 200. L'URL de santé Realtime essayée répond 404 : cela ne démontre ni une panne ni une souscription fonctionnelle ; la validation Realtime reste ouverte.

## Migrations et RPC dans le dépôt candidat

Les trois migrations existent dans le workspace candidat :

| Migration | SHA-256 local |
|---|---|
| `20260808090000_planning_safety_preflight.sql` | `c01590076094c186fa07d04d5ef214dfeb7eb97a8da43b844376d05c260b4764` |
| `20260808110000_safe_planning_inactive_payload.sql` | `5c0a216813d78fa75ea10cda58822f056628fec02e584409f38cdbb5be2122b5` |
| `20260808130000_atomic_safe_planning_heat_configs.sql` | `123f40cd54cb415e43940ff485923e2d9747c60f56d6a75f4555e1970b35fb7a` |

La migration locale définit `public.bulk_upsert_heats_safe_v2`, le type Supabase généré la contient et l'adaptateur frontend l'appelle. Cela prouve l'état du candidat local, **pas** son déploiement sur le HP.

## B — Cache PWA et version

Le build candidat local contient :

- `dist/sw.js` ;
- le chunk XLSX `dist/assets/xlsxParser-DTLwrVjw.js` ;
- version package `0.0.0` ;
- build ID injecté à la compilation par `SURFJUDGING_BUILD_ID` ou, à défaut, par timestamp.

Le build P2.5.7 avait été validé avec 48 entrées précachées et le smoke hors ligne avait confirmé le chunk XLSX précaché. Le HP sert actuellement `index-BYhE1xWF.js` et son `sw.js` référence ce bundle mais aucun fichier `xlsxParser-*.js`. La recherche dans le bundle servi ne trouve ni `bulk_upsert_heats_safe_v2`, ni `persistPlanningImportSafely`, ni `PlanningImportPanel`, ni la migration `20260808130000`. L'ancien frontend est donc confirmé ; aucune invalidation de cache n'a été tentée, car le serveur lui-même doit d'abord être déployé/migré.

## C — Événement temporaire

L'événement `P2.6 FIELD VALIDATION` n'a pas été créé, car le HP était inaccessible. Cette décision évite de créer la fixture sur une base locale de développement qui ne serait pas la cible du checkpoint.

## D — Import Competition X

Non exécuté sur le HP réel.

Les validations locales précédentes (62 participants, 7 catégories, `Feuil1`, preview et persistance atomique) restent des preuves d'intégration, mais ne remplacent pas le contrôle terrain demandé avec Internet coupé et LAN HP conservé.

À reprendre sur le HP : ouverture de `/participants`, import du fichier inchangé, vérification des previews, preflight SAFE, confirmation, puis comptage DB de `heats`, `entries`, `mappings`, `heat_configs` et contrôle `is_active=false`.

## E — Activation de heat

Non exécutée. Aucun heat n'a été activé par SQL ou par une voie de contournement.

Restent à vérifier via l'UI officielle : unicité du heat actif, pointeur, panel/assignments, statut et `heat_realtime_config`.

## F — Tablettes juges

Non exécuté : aucune tablette n'a pu être reliée à un frontend HP accessible. Les mesures à une puis, si disponible, trois tablettes restent ouvertes.

## G — Scoring

Non exécuté sur le HP. Aucune note de test, correction ou vague n'a été créée. Les tests automatisés P0/P2 et WAL local restent verts, mais ne constituent pas une validation de l'installation terrain.

## H — Timer

Non exécuté sur le HP. Les séquences start, pause, reprise, finish et close, la synchronisation tablettes et l'état `heat_realtime_config` restent à valider physiquement.

## I — Priority / ESP32

Non exécuté. La présence de l'ESP32 n'a pas pu être déterminée. Son absence doit rester non bloquante pour le scoring lors de la reprise du test.

## J — Planning safety réel

Non exécuté. Le scénario critique — score présent puis régénération refusée par preflight et safe v2 sans perte — reste un bloqueur de sortie terrain.

## K — Internet réellement coupé

Non exécuté. L'absence d'accès WAN du build a été couverte par l'audit P1 et les smokes locaux, mais aucune coupure Internet physique avec maintien du LAN HP n'a été réalisée dans ce checkpoint.

Routes à reprendre : `/participants`, `/admin`, `/judge`, `/priority`, `/display`, puis scoring, timer, planning et refresh PWA.

## L — Realtime

Aucune latence terrain mesurée. Restent ouverts :

- note juge → admin ;
- admin → display ;
- timer → tablettes ;
- perte/reprise Wi-Fi ;
- resubscription après reprise.

## M — Backup / restore

Le dépôt contient `scripts/hp-backup.sh` et `scripts/hp-ops.sh`. Aucun restore n'a été tenté. Le dernier dump et son SHA-256 sur le HP sont inaccessibles et n'ont donc pas été vérifiés. R15 reste ouvert.

## N — Nettoyage

Aucune donnée terrain n'ayant été créée :

- aucun événement temporaire à supprimer ;
- aucun score de test ;
- aucun pointeur temporaire ;
- aucun participant fixture ;
- aucun événement réel touché.

## Anomalies et latences

| Élément | Observation |
|---|---|
| Disponibilité HP | accessible à `10.0.0.10` |
| Ping `10.0.0.10` | 3/3, moyenne 4,862 ms |
| Frontend `10.0.0.10:8080` | HTTP 200 ; ancien bundle `index-BYhE1xWF.js` |
| Supabase `10.0.0.10:8000` | HTTP 200 ; PostgREST 11.2.0 |
| Schéma | bloquant : `20260727210000...`, attendu au minimum `20260808130000...` |
| PWA XLSX | bloquant : chunk XLSX absent du précache servi |
| SSH | authentification refusée avec la clé disponible |
| Latences métier/Realtime | non mesurables |

## Condition de reprise

Pour reprendre ce même checkpoint sans changer le code :

1. rétablir l'accès SSH de `admin-surfjudging` depuis ce Mac, ou effectuer le déploiement depuis un poste déjà autorisé ;
2. effectuer, avec validation opérateur, le workflow d'upgrade HP prévu par le runbook pour déployer le frontend P2.5.7 et appliquer les migrations — cette mutation n'a pas été autorisée dans le présent lot de validation ;
3. vérifier le stamp `20260808130000_atomic_safe_planning_heat_configs`, la présence de `bulk_upsert_heats_safe_v2`, le nouveau hash frontend et le précache XLSX ;
4. connecter au moins une tablette au même LAN que `10.0.0.10` ;
5. relancer P2.6.0 depuis la section A, puis effectuer les actions UI avec l'opérateur ;
6. ne déclarer `FIELD_READY` qu'après nettoyage vérifié de l'événement temporaire.

Aucune anomalie majeure n'a été corrigée et aucune phase suivante n'a été commencée.
