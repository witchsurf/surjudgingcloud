# P2.5.6l — Enable Safe Offline Planning Persistence

Date : 2026-08-08
Périmètre : activation de la persistance du workflow CSV/XLSX H4 exclusivement via la RPC atomique v2. P2.5.7 non commencé.

## Conclusion

**SAFE_OFFLINE_PLANNING_UI_READY**

Le workflow recommandé H4 peut maintenant créer un planning sur Supabase HP local sans Internet. La création n'est possible qu'après un parse valide, une preview, un événement valide et un preflight explicitement `SAFE`. Le clic passe uniquement par `persistPlanningImportSafely` jusqu'à `bulk_upsert_heats_safe_v2`. Aucun fallback v1 ou legacy n'existe dans ce chemin.

La conclusion couvre les tests locaux automatisés et le smoke Chromium PWA. Le smoke sur le véritable HP et Safari/WebKit restent des validations terrain ouvertes.

## Chemin UI final

```text
PlanningImportPanel
→ persistPlanningImportSafely
→ HeatPlanningRepository.createWithEntries
→ PlanningSafetyRepository.persistSafePlanning
→ persistSafePlanningRpc
→ bulk_upsert_heats_safe_v2
```

Le composant ne dépend directement d'aucun repository, table Supabase, RPC ou store participants. Il ne réalise aucun upsert participants/configs lui-même.

Audit statique :

- aucun appel H4 à `bulk_upsert_heats` ;
- aucun appel H4 à `bulk_upsert_heats_safe` v1 ;
- aucun fallback si v2 manque ;
- aucun appel direct à `participantRepository` ;
- aucune écriture directe `heat_configs` ;
- aucune activation de heat, écriture scoring, modification du pointeur actif ou démarrage timer.

## Conditions du bouton

Le bouton « Créer les heats sur cet événement » est actif uniquement si toutes les conditions sont vraies :

- `parseResult.input !== null` ;
- preview bracket présente ;
- `eventId` entier positif ;
- catégorie non vide ;
- format sélectionné ;
- dernier preflight serveur exactement `SAFE` ;
- aucune persistance en cours ;
- aucune persistance déjà réussie pour cette preview.

États :

| Preflight | Bouton |
|---|---|
| `SAFE` | actif |
| `BLOCKED` | désactivé |
| `UNKNOWN` | désactivé |
| `CHECKING` / erreur réseau | désactivé |

Le frontend ne suppose jamais `SAFE`. La RPC v2 reste l'autorité finale après la confirmation.

## Confirmation opérateur

Une confirmation dédiée affiche avant toute écriture :

- événement ;
- catégorie ;
- nombre de participants ;
- nombre de heats ;
- format ;
- valeur `overwrite` ;
- état `SAFE` ;
- nombre de heats existants ciblés.

Avec `overwrite=true`, l'avertissement indique que tous les heats préparatoires existants de la catégorie seront remplacés, mais que les données sportives bloquent l'opération.

Avec `overwrite=false`, l'UI précise que des collisions d'ID propres peuvent être remplacées. Ce mode n'est jamais présenté comme entièrement non destructif.

Changer `overwrite` invalide le SAFE précédent et relance le preflight avec la nouvelle valeur.

## Concurrence et erreurs

- `PERSISTING` désactive le bouton ;
- un verrou synchrone par `ref` empêche deux soumissions avant même le prochain rendu React ;
- après succès, aucune réécriture automatique ;
- une nouvelle preview réinitialise explicitement l'état de persistance ;
- `PGRST202` affiche : « Le serveur local doit être mis à jour avant de créer les heats » ;
- aucun appel v1/legacy n'est tenté après `PGRST202` ;
- `HEAT_PLANNING_BLOCKED` apparu entre preflight et clic bascule l'UI en `BLOCKED`, conserve la preview et invite à relancer le contrôle ;
- les autres erreurs indiquent que les participants peuvent avoir été upsertés avant le refus du planning.

## Succès et rafraîchissement

Le succès affiche « Planning créé avec succès » avec catégorie, nombre de heats, participants et timestamp.

Le panel conserve la preview correspondant aux lignes persistées. Il notifie `ParticipantsPage`, qui rafraîchit sa liste visible à partir des participants canoniques confirmés. Les écrans de heats relisent leurs données à leur navigation habituelle ; aucun nouveau cache ou rechargement brutal n'est introduit.

Aucun heat n'est activé. Aucun timer ne démarre. Aucun `active_heat_pointer` n'est écrit.

Le nom de l'événement déjà chargé dans `MyEvents` est maintenant transmis dans l'URL moderne puis au panel. Cela évite d'ajouter un grant direct de lecture/écriture pour contourner les droits locaux. Si le nom n'est pas disponible, le service tente la lecture repository existante et échoue explicitement si l'événement reste introuvable.

## Participants hors transaction

Le résidu P2.5.6k est inchangé :

```text
participants upsert
→ résolution des IDs
→ RPC planning atomique v2
```

Un refus de la RPC peut laisser des participants upsertés. L'UI ne prétend pas que rien n'a été écrit dans ce cas. Cette situation reste non destructive pour les données sportives et n'a pas été élargie dans ce lot.

## Competition X — intégration réelle

Le test opt-in utilise le fichier terrain inchangé :

1. événement Supabase local temporaire ;
2. navigateur déclaré `navigator.onLine=false` ;
3. import de `Competition X.xlsx` ;
4. 62 participants et 7 catégories vérifiés ;
5. sélection de catégorie et preview ;
6. preflight réel `SAFE` ;
7. confirmation opérateur ;
8. appel réel de `persistPlanningImportSafely` ;
9. heats, entries, mappings et configs vérifiés ;
10. tous les heats `is_active=false` ;
11. nouvelle preview et nouveau SAFE sur collision propre ;
12. insertion concurrente d'un score ;
13. tentative confirmée ;
14. RPC v2 bloquée ;
15. preview, score et heats existants conservés ;
16. événement temporaire nettoyé.

Résultat : **1/1 passé** sur Supabase local réel.

## Offline LAN et smoke PWA

Le smoke `frontend/scripts/h4-offline-smoke.mjs` a été étendu au workflow complet :

- build production servi localement ;
- service worker actif ;
- chunk XLSX présent dans le précache ;
- tous les domaines autres que le frontend local et Supabase local bloqués ;
- `navigator.onLine=false` ;
- Supabase HP local maintenu accessible ;
- `/participants` ouvert avec l'événement temporaire ;
- fichier Competition X chargé ;
- preview et SAFE ;
- confirmation et création ;
- 5 heats créés pour la catégorie sélectionnée ;
- 0 heat actif ;
- nettoyage final.

Résultat Chromium :

```json
{"ok":true,"browser":"chromium","internet":false,"lanSupabase":true,"xlsxPrecached":true,"participants":62,"heats":5,"active_heats":0}
```

Safari/WebKit n'a pas été exécuté et reste un smoke séparé obligatoire avant généralisation terrain.

## Ancienne DB

Le test d'adaptateur simule l'absence de `bulk_upsert_heats_safe_v2` avec `PGRST202` :

- erreur claire affichée ;
- preview conservée ;
- un seul appel RPC ;
- aucun appel v1 ;
- aucun appel legacy ;
- aucune écriture client de config après l'erreur.

Le nouveau frontend face à une ancienne DB échoue donc fermé.

## Workflow legacy et risque restant

Le CSV/Google Sheets historique reste visible pour rollback, avec un libellé explicite « Import historique ». Le workflow H4 hors ligne est marqué « Workflow recommandé ».

Les écrans historiques de génération passent actuellement par `HeatPlanningRepository`, donc par la frontière sûre v2. La fonction destructive `deletePlannedHeats` reste exportée dans la façade legacy mais aucun consommateur production direct n'a été trouvé pendant ce réaudit. Elle demeure un risque de rollback et n'a pas été supprimée dans ce lot.

## Tests et validations

- tests UI ciblés H4 : SAFE, BLOCKED, UNKNOWN, confirmation, double clic, succès, v2 absente, blocker concurrent et offline LAN ;
- tests architecturaux : service unique, aucun accès direct table/RPC depuis le panel, aucune activation/timer/scoring ;
- tests ciblés du lot : **17/17 passés** ;
- test UI réel Competition X/Supabase : **1/1 passé** ;
- suite complète : **359 tests passés, 7 opt-in ignorés** ;
- `tsc --noEmit` : passé ;
- build Vite/PWA : passé, 2454 modules ;
- smoke Chromium PWA production : passé ;
- audit réseau P1 : passé, aucune violation ;
- routes P1 inchangées et validées ;
- événements temporaires P2.5.6l restants : 0.

L'avertissement de bind WebSocket Vitest propre au sandbox ne change pas les codes de sortie. Le smoke et l'audit runtime ont été exécutés avec les droits de bind local nécessaires.

## Rollback

- désactiver/revenir sur l'action H4 restaure le mode preview sans toucher au backend ;
- `persistPlanningImportSafely` et la RPC v2 restent séparés du workflow legacy ;
- aucun format CSV/XLSX, schéma métier, scoring, WAL, timer ou route n'a changé ;
- la suppression de la RPC v2 exige d'abord le rollback frontend ;
- aucun fallback automatique vers une RPC moins sûre n'est disponible.

## Risques ouverts

1. smoke réel sur le véritable HP avec l'adressage LAN terrain ;
2. Safari/WebKit sur tablette opérateur ;
3. validation Realtime sur le réseau plage ;
4. participants encore hors transaction serveur ;
5. ancien bundle PWA à invalider pendant le déploiement afin d'éviter une frontière v1 ;
6. fonction legacy `deletePlannedHeats` toujours exportée pour rollback ;
7. P2.5.7 reste bloqué jusqu'à validation explicite de ce rapport.
