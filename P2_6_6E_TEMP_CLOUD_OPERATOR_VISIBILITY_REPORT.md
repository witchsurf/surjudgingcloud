# P2.6.6E — Temporary Cloud frontend and operator visibility

Date: 2026-08-09
Conclusion: **DUAL_MODE_TEST_RELEASE_BLOCKED**

## Résumé

Le contrôle a été arrêté au préflight, avant toute mutation distante. Le frontend de production n'a pas été remplacé, aucune configuration Supabase Auth n'a été modifiée et aucun artefact n'a été déployé.

Le domaine temporaire demandé, `test.surfjudging.cloud`, ne possède actuellement aucun enregistrement DNS résolvable. L'infrastructure versionnée ne contient par ailleurs qu'un service frontend et qu'un routeur Traefik de production pour `surfjudging.cloud` et `www.surfjudging.cloud`. Déployer avec le workflow actuel aurait donc remplacé la production, ce qui est explicitement interdit dans ce lot.

## Préflight observé

| Contrôle | Résultat |
|---|---|
| Résolution DNS `test.surfjudging.cloud` | **FAIL** — aucun A/CNAME résolu |
| Frontend test HTTPS | **FAIL** — hôte non résolvable |
| Frontend production | Inchangé |
| Routeur test isolé dans `infra/docker-compose.yml` | Absent |
| Routeur production existant | `surfjudging.cloud` / `www.surfjudging.cloud` |
| Workflow de déploiement test isolé | Absent |
| Accès Git distant en lecture | Disponible |
| Capacité Git push (dry-run) | Disponible |
| GitHub CLI | Session locale expirée ; non utilisée pour une mutation |

## Architecture minimale requise pour reprendre

La reprise doit utiliser un second service frontend, un second répertoire de release et un second lien symbolique, tous distincts de la production :

- domaine : `test.surfjudging.cloud` ;
- routeur Traefik : hôte test uniquement ;
- conteneur : distinct de `surfjudging` ;
- releases : `/opt/surfjudging-test/releases/<RELEASE_ID>` ;
- lien actif : `/opt/surfjudging-test/current` ;
- artefact : `dist-cloud` préconstruit, sans build sur le VPS ;
- backend : même Supabase Cloud officiel ;
- déploiement : workflow temporaire dédié, sans activation de `/opt/surfjudging/current` et sans recréation du conteneur production.

## Conditions externes de reprise

1. Créer dans la zone DNS de `surfjudging.cloud` un enregistrement pour `test.surfjudging.cloud` pointant vers le même VPS/proxy que la production. Avec Cloudflare, un CNAME `test` vers `surfjudging.cloud` en mode proxifié est adapté.
2. Autoriser `https://test.surfjudging.cloud/**` comme Redirect URL additionnelle dans Supabase Auth. Le Site URL principal ne doit pas être remplacé.
3. Confirmer que ces deux opérations sont effectives. La résolution DNS et le redirect seront alors revérifiés avant tout déploiement.

## Contrôles non exécutés en raison du STOP

- vérification du mode `cloud` sur le site test ;
- absence de la bannière développement ;
- affichage du login magic-link réel ;
- authentification opérateur ;
- création et suppression du storageState temporaire ;
- comparaison PostgREST / repository / UI des 13 événements ;
- refresh et nouveau contexte ;
- freeze du commit ;
- création des artefacts Cloud TEST et Field TEST.

## État requis par la spécification

| Indicateur | État |
|---|---|
| TEMP_CLOUD_FRONTEND | **FAIL** |
| REAL_SUPABASE_SESSION | **FAIL — non testable** |
| EVENTS_VISIBILITY | **FAIL — non testable** |
| FIELD_READY | TRUE (état P2.6.6C inchangé) |
| CLOUD_TEST_READY | TRUE (backend P2.6.6C inchangé ; frontend temporaire non qualifié) |
| CLOUD_PRODUCTION_PAYMENT_READY | FALSE |
| Commit de freeze | Non créé |
| RELEASE_ID | Non créé |
| Hash artefact Cloud | Non créé |
| Hash artefact Field | Non créé |

## Garanties de non-mutation

- aucun déploiement production ;
- aucune modification DNS effectuée depuis le dépôt ;
- aucune modification Supabase Auth ;
- aucune ligne événement modifiée ;
- aucun storageState ni token créé ou journalisé ;
- aucun commit, push ou nouveau RELEASE_ID ;
- aucune logique métier modifiée.
