# Déploiement de la release P2.5.7 — Cloud + HP

Cette checklist ne déclenche aucun déploiement. Elle impose le même candidat sur Cloud et HP avant toute reprise de P2.6.0.

## Variables opérateur

```bash
export SURFJUDGING_RELEASE_SHA='<SHA_VALIDÉ>'
export SURFJUDGING_RELEASE_ID="surfjudging-2026.08.08-p2.5.7-${SURFJUDGING_RELEASE_SHA:0:12}"
export SURF_HP_HOST='10.0.0.10'
export SURF_HP_USER='admin-surfjudging'
export SUPABASE_PROJECT_REF='xwaymumbkmwxqifihuvn'
```

Ne placer ni mot de passe, ni clé privée, ni URL contenant des credentials dans ce fichier ou dans Git.

## PREDEPLOY

- [ ] `git status --short` ne montre aucun changement produit non expliqué.
- [ ] `git rev-parse HEAD` égale `SURFJUDGING_RELEASE_SHA`.
- [ ] L'accès opérateur Cloud est confirmé.
- [ ] `ssh "$SURF_HP_USER@$SURF_HP_HOST" true` fonctionne avec une clé autorisée.
- [ ] Le projet Supabase Cloud vérifié est `xwaymumbkmwxqifihuvn`.
- [ ] Le mécanisme de snapshot/backup Cloud est confirmé dans la console opérateur.
- [ ] Le backup Cloud est terminé et son identifiant est consigné hors Git.
- [ ] `./scripts/hp-ops.sh backup --home --host "$SURF_HP_HOST" --event-id <ID>` a produit le dump HP.
- [ ] La taille, le chemin et le SHA-256 du dump HP sont consignés hors Git.
- [ ] Les trois SHA-256 de migrations correspondent au rapport de release.
- [ ] L'ancien hash frontend Cloud et l'ancien hash frontend HP sont consignés pour rollback.
- [ ] Aucun événement réel n'est utilisé pour le smoke de mutation.

STOP immédiat si un backup manque, si la liste des migrations en attente contient un autre fichier, ou si l'une des deux cibles est inaccessible.

## DB CLOUD

Ne pas utiliser une commande qui appliquerait silencieusement d'autres migrations. Avec une URL PostgreSQL Cloud fournie par l'opérateur dans `CLOUD_DATABASE_URL`, exécuter explicitement et dans cet ordre :

```bash
psql "$CLOUD_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/supabase/migrations/20260808090000_planning_safety_preflight.sql
psql "$CLOUD_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/supabase/migrations/20260808110000_safe_planning_inactive_payload.sql
psql "$CLOUD_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/supabase/migrations/20260808130000_atomic_safe_planning_heat_configs.sql
```

- [ ] Stamp runtime : `20260808130000_atomic_safe_planning_heat_configs`.
- [ ] `bulk_upsert_heats_safe` existe.
- [ ] `bulk_upsert_heats_safe_v2` existe avec la signature attendue.
- [ ] `authenticated` et `service_role` ont EXECUTE sur v2.
- [ ] Aucun INSERT/UPDATE direct `authenticated` sur `heat_configs`.
- [ ] La contrainte `heats.status` accepte temporairement `open` comme documenté.
- [ ] Lint DB relu ; aucun nouvel avertissement par rapport au candidat local.

## DB HP

Depuis le poste autorisé, obtenir l'URL PostgreSQL locale du conteneur selon le runbook, puis appliquer explicitement les mêmes trois fichiers dans le même ordre. Ne pas appeler un refresh global si son delta contient d'autres migrations.

- [ ] Les trois commandes terminent avec `ON_ERROR_STOP=1`.
- [ ] Les mêmes contrôles de stamp, RPC, signature, grants et statut que Cloud sont verts.
- [ ] Le frontend n'a pas encore été ouvert pour une mutation métier.

## ARTEFACT FRONTEND UNIQUE

Construire une fois depuis le commit validé :

```bash
test "$(git rev-parse HEAD)" = "$SURFJUDGING_RELEASE_SHA"
SURFJUDGING_BUILD_ID="$SURFJUDGING_RELEASE_ID" npm --prefix frontend run build
tar -C frontend -czf "/tmp/${SURFJUDGING_RELEASE_ID}-frontend.tgz" dist
shasum -a 256 "/tmp/${SURFJUDGING_RELEASE_ID}-frontend.tgz"
```

- [ ] `dist/sw.js` précache `xlsxParser-*.js`.
- [ ] Le `RELEASE_ID` est visible dans le bundle/diagnostic opérateur.
- [ ] Les hashes `index-*.js`, `sw.js`, `xlsxParser-*.js` et archive sont consignés.
- [ ] Cette archive exacte, non un second build, est utilisée sur les deux cibles.

## FRONTEND CLOUD

- [ ] Sauvegarder/identifier l'artefact Cloud précédent.
- [ ] Déployer l'archive unique selon la procédure VPS autorisée.
- [ ] Ne pas lancer le workflow GitHub automatique sans autorisation de push/deploy.
- [ ] Vérifier `https://surfjudging.cloud/admin` et le `RELEASE_ID`.

## FRONTEND HP

- [ ] Sauvegarder/identifier le répertoire frontend HP précédent.
- [ ] Copier la même archive par SSH autorisé.
- [ ] Remplacer le frontend selon le runbook sans reconstruire sur le HP.
- [ ] Vérifier `http://10.0.0.10:8080/admin` et le même `RELEASE_ID`.

## PWA INVALIDATION

- [ ] Cloud : nouveau `sw.js`, nouveau bundle et chunk XLSX présents.
- [ ] HP : nouveau `sw.js`, nouveau bundle et chunk XLSX présents.
- [ ] Fermer/réouvrir au moins un navigateur/tablette réellement utilisé.
- [ ] Forcer la mise à jour du service worker si l'ancien contrôle encore la page.
- [ ] Aucun bundle P2.5.6j/k ne reste actif avant création de heats.

## PARITY CHECK

- [ ] `RELEASE_ID` identique Cloud/HP.
- [ ] SHA Git identique Cloud/HP.
- [ ] Hash de l'archive identique Cloud/HP.
- [ ] Stamp schéma identique Cloud/HP.
- [ ] Trois migrations présentes sur les deux cibles.
- [ ] RPC v2 et signature identiques.
- [ ] Grants et status check identiques.
- [ ] Chunk XLSX précaché sur les deux cibles.
- [ ] Planning moderne utilise preview → preflight → safe v2 sans fallback unsafe.

```text
CODE_SYNC = TRUE
SCHEMA_SYNC = TRUE
CLOUD_HP_RELEASE_MATCH = TRUE
```

## SMOKE

Sur Cloud puis HP, sans créer d'événement réel :

- [ ] GET `/`, `/admin`, `/participants`, `/judge`, `/priority`, `/display`.
- [ ] Lecture Supabase REST et diagnostic de base.
- [ ] Présence/signature RPC safe v2.
- [ ] Parsing local de Competition X sans persistance si nécessaire.
- [ ] Aucun appel WAN depuis le health-check HP.

## TEST TEMPORAIRE

Uniquement après parité :

- [ ] Créer un événement temporaire distinct et explicitement nommé sur chaque cible.
- [ ] Appeler preflight puis safe v2.
- [ ] Vérifier `is_active=false` et la persistance transactionnelle de `heat_configs`.
- [ ] Nettoyer immédiatement toutes les lignes temporaires et vérifier les compteurs à zéro.

## ROLLBACK

STOP et rollback si un contrôle critique diverge.

- [ ] Restaurer l'artefact frontend précédent sur la cible concernée.
- [ ] Invalider le service worker correspondant.
- [ ] Ne restaurer aucune base sans procédure R15 séparément validée.
- [ ] En cas d'échec de migration, conserver les logs et demander une décision avant toute restauration.
- [ ] Ne jamais recopier automatiquement Cloud → HP ou HP → Cloud pendant le diagnostic.

P2.6.0 ne reprend qu'après validation intégrale de cette checklist.
