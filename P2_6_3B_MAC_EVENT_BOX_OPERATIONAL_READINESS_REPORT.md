# P2.6.3B — Mac Event Box Operational Readiness

Date : 2026-08-08 (Africa/Dakar)

## Conclusion

**MAC_EVENT_BOX_BLOCKED**

Le lot reste arrêté à la barrière PREDEPLOY Cloud, conformément à la consigne : aucun déploiement ne doit être tenté sans sauvegarde vérifiable.

Après confirmation opérateur de `CLOUD_BACKUP_VERIFIED = TRUE`, l'étape DB Cloud a été autorisée. Elle s'est arrêtée sur la première migration, sans exécuter les deux suivantes et sans déployer le frontend.

GitHub et la véritable identité Supabase sont accessibles. Après restauration opérateur, le projet cible est désormais `ACTIVE_HEALTHY` et l'inventaire des migrations distantes fonctionne. Aucun backup physique n'est toutefois listé et PITR reste désactivé ; l'application des trois migrations validées demeure donc interdite par la barrière PREDEPLOY.

## Contrôles effectués

### GitHub

| Contrôle | Résultat |
|---|---|
| Authentification `gh` | OK |
| Compte actif | `witchsurf` |
| Droits utiles | `repo`, `workflow` |
| Dépôt distant | `witchsurf/surjudgingcloud` |
| Workflow | `Deploy to VPS`, actif |
| Secrets de déploiement | noms VPS présents ; valeurs non consultées |
| `origin/main` | `b544e5e89e2b3cd2f00bcab418276d6cd3992b97` |
| Release cible présente sur une branche distante | non constatée |
| Branche locale | en avance de 7 commits sur sa branche distante |

La connexion GitHub seule ne donne pas un accès contrôlable au backup ou au schéma Supabase Cloud. Déclencher le workflow maintenant contournerait la barrière PREDEPLOY.

### Supabase Cloud

Les deux lectures non mutantes suivantes ont échoué avant toute opération distante :

- inventaire des projets ;
- inventaire des migrations du projet lié.

La première identité authentifiée n'avait pas les droits sur la cible. Après reconnexion avec la véritable identité opérateur, le projet `xwaymumbkmwxqifihuvn` nommé `surfjudging.cloud` est bien listé et lié au dépôt. Après intervention opérateur, son état retourné par la plateforme est `ACTIVE_HEALTHY`.

État backup retourné par la plateforme :

- `backups: null` ;
- `pitr_enabled: false` ;
- `walg_enabled: true`, sans point de sauvegarde disponible dans la réponse ;
- région `eu-west-1`.

La lecture des migrations liées réussit. Le Cloud est aligné avec les migrations locales jusqu'à `20260727210000`. Les trois seules migrations locales absentes du Cloud sont exactement :

1. `20260808090000_planning_safety_preflight.sql` ;
2. `20260808110000_safe_planning_inactive_payload.sql` ;
3. `20260808130000_atomic_safe_planning_heat_configs.sql`.

Aucune n'a été appliquée. Aucun secret n'a été affiché ou recherché agressivement.

### Échec contrôlé de la migration Cloud

Les trois empreintes SHA-256 ont été revérifiées et le dry-run ne proposait exactement que les trois migrations autorisées. L'exécuteur Supabase CLI, utilisé via son canal DB authentifié avec arrêt immédiat sur erreur, a commencé `20260808090000_planning_safety_preflight.sql` puis a échoué à son statement 3 :

```text
ERROR: operator does not exist: uuid = text (SQLSTATE 42883)
```

Expression concernée : comparaison de `public.scores.id` avec `public.score_overrides.score_id` dans `get_heat_planning_safety_inventory`. Le schéma Cloud expose ici une divergence de types non reproduite par la stack locale validée.

Conséquences observées :

- `20260808090000` n'est pas enregistrée dans l'historique distant ;
- `20260808110000` n'a pas été exécutée ;
- `20260808130000` n'a pas été exécutée ;
- le frontend n'a pas été déployé ;
- le stamp final, les RPC safe/v2, signature et grants cibles ne peuvent pas être validés ;
- aucune correction SQL improvisée n'a été appliquée.

L'exécution de migration est transactionnelle selon le chemin CLI utilisé, mais l'état structurel après rollback devra être explicitement vérifié lors du futur lot de correction avant toute nouvelle tentative.

| Précondition Cloud | État |
|---|---|
| Session CLI Supabase | OK, identité opérateur correcte |
| Projet cible | visible, lié et `ACTIVE_HEALTHY` |
| Accès DB du projet cible | OK en lecture des migrations |
| Backups physiques | aucun backup listé |
| PITR | désactivé |
| Projet Cloud vérifié | NON |
| Backup/snapshot Cloud vérifié | NON |
| Frontend Cloud relevé dans ce lot | NON |
| Version DB Cloud relevée | NON |
| RPC/grants relevés | NON |
| Migrations appliquées | AUCUNE |
| Frontend déployé | NON |
| Workflow GitHub déclenché | NON |

## Matrice Cloud / Mac au point d'arrêt

| Élément | Cloud | Mac | Match |
|---|---|---|---|
| Commit code | non vérifié | `36dba46dcd639c9ae7001291f76ba863fc8b0ff1` pour l'artefact | non prouvé |
| RELEASE_ID | non vérifié | `surfjudging-2026.08.08-p2.5.7-36dba46dcd63` | non prouvé |
| Schéma | non lisible | `20260808130000_atomic_safe_planning_heat_configs` | non prouvé |
| RPC safe v2 | non lisible | présente, signature validée | non prouvé |
| Chunk XLSX | non relevé | présent | non prouvé |

```text
CODE_SYNC = TRUE (artefact Mac)
SCHEMA_SYNC = TRUE (Mac)
CLOUD_MAC_RELEASE_MATCH = FALSE / NON PROUVÉ
```

## Actions volontairement non exécutées

- aucun push GitHub ;
- aucun merge vers `main` ;
- aucun déclenchement de GitHub Actions ;
- aucun backup ou snapshot prétendu ;
- aucune migration Cloud ;
- aucun déploiement frontend ;
- aucune synchronisation de données compétition ;
- aucune nouvelle release ;
- aucune modification du Mac, de sa veille, de ses volumes ou de sa stack ;
- aucun test sur tablette ou ESP32 après la barrière d'arrêt.

## Condition de reprise

Depuis le dashboard Supabase du projet `xwaymumbkmwxqifihuvn` :

1. créer ou confirmer un backup/snapshot exploitable avant toute migration ;
2. seulement ensuite reprendre, sans exposer les secrets, les contrôles suivants :

   - confirmer le backup/snapshot et sa date ;
   - relever migrations, version runtime, RPC, signature et grants ;
   - appliquer uniquement les migrations manquantes dans l'ordre validé ;
   - déployer le frontend de la release cible.

La reprise doit recommencer exactement au PREDEPLOY Cloud de P2.6.3B. Les autres sous-parties opérationnelles restent en attente de ce garde-fou.

Depuis l'échec contrôlé, une reprise exige désormais une validation séparée de compatibilité SQL `uuid`/`text` pour `scores.id` et `score_overrides.score_id`, des tests sur une reproduction du schéma Cloud, puis une nouvelle autorisation explicite. Il ne faut pas relancer le package inchangé.
