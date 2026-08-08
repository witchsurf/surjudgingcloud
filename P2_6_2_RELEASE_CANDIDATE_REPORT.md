# P2.6.2 — Release candidate cleanup + deployment package

Date : 8 août 2026  
Objet : préparer une release Cloud + HP traçable, sans push, déploiement ou mutation d'une base distante.

## Conclusion

**RELEASE_CANDIDATE_READY**

Le candidat P2.5.7 est matérialisé par un commit local, un RELEASE_ID déterministe, un artefact frontend unique et un package de trois migrations précisément identifié. Aucun push et aucun déploiement Cloud/HP n'ont été effectués.

## Identité de release

| Élément | Valeur |
|---|---|
| Commit complet | `36dba46dcd639c9ae7001291f76ba863fc8b0ff1` |
| Commit court | `36dba46dcd63` |
| Message | `release: surfjudging p2.5.7 safe offline planning` |
| RELEASE_ID | `surfjudging-2026.08.08-p2.5.7-36dba46dcd63` |
| Branche locale | `agent/multi-podium-readiness` |
| Version package | `0.0.0` |
| Push | non effectué |

`frontend/vite.config.ts` accepte maintenant `SURFJUDGING_RELEASE_ID` comme identifiant de build prioritaire, avec compatibilité `SURFJUDGING_BUILD_ID` conservée.

## A — Inventaire Git complet

L'état initial comportait 157 entrées Git logiques. Le développement des répertoires non suivis donnait 241 fichiers. Après classification, le commit contient 231 chemins : 228 éléments issus du workspace initial et trois éléments de packaging créés pendant ce lot (`.gitignore`, la checklist, et l'alias RELEASE_ID dans `vite.config.ts`).

L'inventaire machine exact inclus est reproductible avec :

```bash
git diff-tree --no-commit-id --name-status -r 36dba46dcd639c9ae7001291f76ba863fc8b0ff1
```

### Matrice exhaustive par famille de chemins

Chaque chemin initial appartient exactement à l'une des lignes ci-dessous. Les répertoires indiqués couvrent tous leurs fichiers développés ; le commit ci-dessus constitue la liste path-par-path normative.

| Path ou famille exhaustive | Statut initial | Catégorie | Lot d'origine | Release | Justification |
|---|---|---|---|---:|---|
| `frontend/src/domain/scoring/**` | `??` | SOURCE PRODUIT VALIDÉE + TEST VALIDÉ | P2.1–P2.4 | oui | contrats, moteur, façade legacy, shadow, snapshots, panel et parité |
| `frontend/src/repositories/contracts/**` | `??` | SOURCE PRODUIT VALIDÉE | P2.5.1–P2.5.7 | oui | contrats canoniques purs |
| `frontend/src/repositories/internal/**` | `??` | SOURCE PRODUIT VALIDÉE | P2.5.2b/d | oui | identité WAL score/override et mappings |
| `frontend/src/repositories/*.ts` | `M/??` | SOURCE PRODUIT VALIDÉE | P2.5.2–P2.5.7 | oui | implémentations, caches et registre |
| `frontend/src/repositories/__tests__/**` | `??` | TEST VALIDÉ | P2.5 | oui | contrats, architecture, lifecycle, planning et WAL réel |
| `frontend/src/api/modules/*.ts` | `M/??` | SOURCE PRODUIT VALIDÉE | P2.4a–P2.5.7 | oui | adaptateurs Supabase étroits et parsers |
| `frontend/src/api/modules/__tests__/**` | `??` | TEST VALIDÉ | P2.5 | oui | payloads, fallbacks et critères d'erreur |
| `frontend/src/api/supabaseClient.ts` | `M` | SOURCE PRODUIT VALIDÉE | P2.5.7 | oui | façade de rollback dépréciée |
| `frontend/src/domain/planningImport/*.ts` | `??` | SOURCE PRODUIT VALIDÉE | P2.5.6h | oui | contrat et normalisation CSV offline |
| `frontend/src/domain/planningImport/__fixtures__/**` | `??` | TEST VALIDÉ | P2.5.6h1 | oui | fixtures de caractérisation |
| `frontend/src/domain/planningImport/__tests__/**` | `??` | TEST VALIDÉ | P2.5.6h/P2.5.7 | oui | règles et architecture import |
| `frontend/src/adapters/planningImport/*.ts` | `??` | SOURCE PRODUIT VALIDÉE | P2.5.6h3/h4 | oui | parseurs CSV/XLSX offline |
| `frontend/src/adapters/planningImport/__tests__/**` | `??` | TEST VALIDÉ | P2.5.6h3/h4 | oui | XLSX synthétique et Competition X réel |
| `frontend/src/services/persistPlanningImportSafely.ts` | `??` | SOURCE PRODUIT VALIDÉE | P2.5.6l | oui | unique orchestration safe v2 |
| `frontend/src/services/__tests__/**` | `??` | TEST VALIDÉ | P2.5.6l | oui | persistance sûre et blocages |
| `frontend/src/components/PlanningImportPanel.tsx` | `??` | SOURCE PRODUIT VALIDÉE | P2.5.6h4–l | oui | UI offline preview/preflight/confirmation |
| `frontend/src/components/AdminHeatResultSnapshotPanel.tsx` | `??` | SOURCE PRODUIT VALIDÉE | P2.4 | oui | snapshot canonique admin |
| autres `frontend/src/components/*.tsx` listés par le commit | `M` | SOURCE PRODUIT VALIDÉE | P2.4–P2.5.7 | oui | consommateurs migrés et intégration planning |
| `frontend/src/components/__tests__/**` | `??` | TEST VALIDÉ | P2.4/P2.5.6 | oui | UI scoring/import et Competition X |
| `frontend/src/pages/*.tsx` listés par le commit | `M` | SOURCE PRODUIT VALIDÉE | P2.4/P2.5.7 | oui | snapshots, panel et suppression façade globale |
| `frontend/src/pages/__tests__/**` | `??` | TEST VALIDÉ | P2.4 | oui | Display et overlays |
| `frontend/src/hooks/*.ts` listés par le commit | `M` | SOURCE PRODUIT VALIDÉE | P2.5 | oui | consommateurs repository/lifecycle |
| `frontend/src/hooks/__tests__/**` | `??` | TEST VALIDÉ | P0/P2.5 | oui | timer et recovery |
| `frontend/src/stores/configStore.ts`, `scoreWalExecutor.ts` | `M` | SOURCE PRODUIT VALIDÉE | P2.5.2/P2.5.7 | oui | frontière WAL et suppression façade globale |
| `frontend/src/stores/__tests__/**`, `frontend/src/lib/__tests__/**` | `??` | TEST VALIDÉ | P0/P2.5 | oui | ordre/idempotence/coordinator |
| `frontend/src/lib/sharedRealtimeSubscriptions.ts` | `M` | SOURCE PRODUIT VALIDÉE | P2.5.7 | oui | import étroit, Realtime inchangé |
| `frontend/src/types/database.ts`, `supabase.generated.ts`, `supabaseDatabase.ts` | `M/??` | SOURCE PRODUIT VALIDÉE | P2.1 | oui | types Supabase reproductibles et compatibilité |
| `frontend/src/utils/*.ts` listés par le commit | `M/??` | SOURCE PRODUIT VALIDÉE | P0–P2.5.7 | oui | scoring legacy, ranking heat, PDF et utilitaires lifecycle |
| `frontend/src/utils/__tests__/**`, `frontend/src/__tests__/**` | `M/??` | TEST VALIDÉ | P0–P2.5.7 | oui | caractérisation métier, routes et non-duplication |
| `frontend/package.json`, `frontend/package-lock.json` | `M` | SOURCE PRODUIT VALIDÉE | P2.1/P2.5.6h3 | oui | types Supabase et dépendance XLSX figée |
| `package.json`, `package-lock.json` | `M` | SOURCE PRODUIT VALIDÉE | P0/P2.1 | oui | CLI Supabase reproductible et intégrations PostgreSQL |
| `frontend/scripts/h4-offline-smoke.mjs` | `??` | SCRIPT OPÉRATIONNEL VALIDÉ | P2.5.6l | oui | smoke PWA offline réel |
| `scripts/generate-supabase-types.sh` | `??` | SCRIPT OPÉRATIONNEL VALIDÉ | P2.1 | oui | génération reproductible |
| `scripts/p0-integration-tests.mjs` | `??` | SCRIPT OPÉRATIONNEL VALIDÉ | P0 | oui | intégration DB isolée |
| trois `backend/supabase/migrations/20260808*.sql` | `??` | MIGRATION SQL VALIDÉE | P2.5.6i/k | oui | package DB exact |
| `backend/supabase/tests/*.sql` | `??` | TEST VALIDÉ | P2.5.6i–k | oui | assertions transactionnelles avec rollback |
| `backend/supabase/config.toml`, `.gitignore` | `??` | SOURCE PRODUIT VALIDÉE | P0/P2.6.2 | oui | stack locale reproductible, sans secret |
| `docs/p2-data-contract-map.md` | `??` | DOCUMENTATION À CONSERVER | P2.1/P2.5 | oui | carte des contrats |
| `docs/DEPLOY_RELEASE_P2_5_7.md` | nouveau | DOCUMENTATION À CONSERVER | P2.6.2 | oui | checklist Cloud/HP |
| `ARCHITECTURE_CURRENT.md`, `DATA_MODEL_CURRENT.md`, `DEPENDENCIES_AUDIT.md`, `MIGRATION_PLAN.md` | `??` | DOCUMENTATION À CONSERVER | P0 | oui | bases de l'audit validé |
| `codex_surfjudging_local_spec.json` | `??` | DOCUMENTATION À CONSERVER | spécification | oui | source de périmètre locale |
| `P0_*REPORT.md`, `P2_*REPORT.md` présents dans le commit | `??` | RAPPORT DE LOT | P0–P2.6.1 | oui | décisions, parité et risques nécessaires à l'audit |
| `.gitignore` | nouveau | DOCUMENTATION À CONSERVER | P2.6.2 | oui | exclusions ciblées sans suppression |
| `backend/supabase/.temp/*` | `M/??` | TEMPORAIRE / CACHE | runtime Supabase CLI | non | versions, pooler, secrets et état local |
| `supabase/.temp/linked-project.json` | `??` | TEMPORAIRE / CACHE | runtime CLI | non | lien local de projet |
| `frontend/dist/` | ignoré | ARTEFACT GÉNÉRÉ | build | non Git | livré séparément par archive hashée |
| `frontend/dist-xlsx-spike/` | `??` | ARTEFACT GÉNÉRÉ | P2.5.6h3 | non | bundle de mesure, remplacé par implémentation finale |
| `frontend/src/spikes/xlsxBundleEntry.ts`, `frontend/vite.xlsx-spike.config.ts` | `??` | TEMPORAIRE / CACHE | P2.5.6h3 | non | harness de spike, non produit |
| `Export_PDF_Complet_Event33.pdf`, `Rapport_Event33.pdf` | `??` | DUMP / EXPORT | export local | non | données/export non nécessaires à la release |
| `artifacts/*.pdf`, `artifacts/*.png` | `??` | ARTEFACT GÉNÉRÉ | validation locale | non | rapports binaires et capture |

### Comptage du commit

| Catégorie | Fichiers inclus |
|---|---:|
| Source produit validée | 107 |
| Tests validés | 74 |
| Migrations SQL validées | 3 |
| Scripts opérationnels validés | 3 |
| Documentation conservée | 7 |
| Rapports de lot | 37 |
| Total | 231 |

Le total normatif est **231 chemins** selon Git. Le classement automatisé est exclusif ; le tableau par familles apporte la justification fonctionnelle.

## B/C/D — Inclusion, exclusions et rapports

Tout le code validé P0–P2.5.7 demandé est inclus : repositories, API modules, moteur scoring, correctifs WAL, panel, lifecycle, planning safety, safe v2, import XLSX/CSV offline, UI, PWA et tests architecturaux.

Les artefacts sont exclus sans suppression physique. `.gitignore` contient des règles ciblées pour les PDF racine, `artifacts/`, `dist-xlsx-spike`, le harness de spike et les `.temp` de lien Supabase. Tous les rapports Markdown architecturaux et de validation P0/P2 sont conservés ; les rapports binaires et captures restent locaux.

## E — Secret scan

Le scan de la sélection exacte indexée a recherché sans afficher les valeurs :

- clés privées PEM ;
- JWT structurés ;
- clés `sb_secret_*` ;
- clés AWS ;
- clés `service_role` assignées ;
- credentials Wi-Fi assignés.

Résultat : **aucun secret détecté dans les fichiers candidats**. Les `.env`, dumps, fichiers `.temp/start-secrets` et credentials runtime sont exclus par Git.

## F — Validations du candidat

| Validation | Résultat |
|---|---|
| `tsc --noEmit` | réussi |
| Vitest complet | 64 fichiers, 365 tests réussis ; 7 opt-in ignorés |
| architecture | incluse, verte |
| WAL score réel | réussi sur Supabase local isolé |
| WAL override réel | réussi sur Supabase local isolé |
| Competition X parser + UI preview | 2/2 réussis ; 62 participants, 7 catégories |
| Competition X persistance atomique | 1/1 réussi, fixture nettoyée |
| build Vite/PWA | réussi, 2 455 modules, 48 entrées précachées |
| audit réseau P1 artefact final | réussi, aucune violation, routes terrain HTTP 200 |
| smoke PWA offline artefact final | réussi : Internet false, LAN Supabase true, 62 participants, 5 heats, 0 actif |
| DB lint local | aucune erreur ; six avertissements historiques dans `fn_infer_heat_slot_mappings_for_heat` |
| SQL preflight | réussi en transaction, rollback |
| SQL readiness | réussi en transaction, rollback |
| SQL atomic safe v2/config | réussi en transaction, rollback |

Limite de tooling : `supabase test db` attend du TAP et retourne « No plan found » pour ces trois scripts SQL procéduraux. Les mêmes fichiers passent avec `psql -v ON_ERROR_STOP=1`, affichent leur notice de succès et font `ROLLBACK`. Aucun échec d'assertion SQL n'est masqué.

## G/H — RELEASE_ID et commit

Le RELEASE_ID est dérivé du commit, pas d'un timestamp seul :

```text
surfjudging-2026.08.08-p2.5.7-36dba46dcd63
```

Le commit local exact est `36dba46dcd639c9ae7001291f76ba863fc8b0ff1`. Aucun push n'a été effectué.

## I — Artefact frontend unique

Archive destinée aux deux cibles :

```text
/tmp/surfjudging-2026.08.08-p2.5.7-36dba46dcd63-frontend.tgz
```

| Fichier | SHA-256 |
|---|---|
| archive frontend | `02e7595f00f5a85a1d78e63b5c3f8f6c087bf36778993f857bca2e738289d171` |
| `dist/index.html` | `d1a37a59c07089b4ec7ffb1aab9b1843f3503beed6dc9368e2628c2659d69af1` |
| `dist/sw.js` | `c133ecc325136ba8e0cc7e9df4eab07d02c212f9a281e42fd36dacf717714a08` |
| `dist/assets/index-CN4fQqgy.js` | `e69bdd9fc8235226f6eded3bc45412e452f186969e3afac9fcd0e0bc5876830f` |
| `dist/assets/xlsxParser-Dl1RhDup.js` | `6156c5b0bc742ac76c68f48411f9e8e67a50a8e700434dc409e923c775ef275d` |

Le RELEASE_ID est retrouvé dans `index-CN4fQqgy.js`. `sw.js` précache `xlsxParser-Dl1RhDup.js`.

## J — Package migrations exact

| Ordre | Migration | SHA-256 |
|---:|---|---|
| 1 | `20260808090000_planning_safety_preflight.sql` | `c01590076094c186fa07d04d5ef214dfeb7eb97a8da43b844376d05c260b4764` |
| 2 | `20260808110000_safe_planning_inactive_payload.sql` | `5c0a216813d78fa75ea10cda58822f056628fec02e584409f38cdbb5be2122b5` |
| 3 | `20260808130000_atomic_safe_planning_heat_configs.sql` | `123f40cd54cb415e43940ff485923e2d9747c60f56d6a75f4555e1970b35fb7a` |

Aucune migration supplémentaire n'appartient au package.

## K/M — Checklist et commandes de déploiement

La checklist complète est `docs/DEPLOY_RELEASE_P2_5_7.md`. Elle contient les barrières PREDEPLOY, backups, DB Cloud/HP, artefact unique, PWA, parité, smoke et rollback.

Le projet Cloud est dérivé de la configuration existante vérifiée : `xwaymumbkmwxqifihuvn`. Les commandes DB utilisent une variable opérateur `CLOUD_DATABASE_URL` et nomment explicitement les trois fichiers ; aucune URL avec credentials n'est enregistrée. Aucun workflow GitHub ni `supabase db push` global n'est lancé automatiquement.

## L — Accès SSH HP

Aucune clé standard privée/publique n'existe actuellement sous `~/.ssh` sur ce Mac. L'opérateur doit, depuis un poste déjà autorisé :

```bash
# Sur ce Mac, uniquement après décision explicite de créer une clé :
ssh-keygen -t ed25519 -C 'surfjudging-release-operator'
cat ~/.ssh/id_ed25519.pub

# Depuis un poste déjà autorisé au HP :
ssh admin-surfjudging@10.0.0.10 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
printf '%s\n' '<CLE_PUBLIQUE>' | ssh admin-surfjudging@10.0.0.10 'cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Puis vérifier `ssh -o BatchMode=yes admin-surfjudging@10.0.0.10 true`. Aucune clé n'a été créée ou installée par ce lot.

## Rollback et blockers de déploiement

La release est prête comme package, mais son déploiement reste interdit tant que :

1. l'accès SSH HP n'est pas rétabli ;
2. les backups Cloud et HP ne sont pas produits/vérifiés ;
3. l'accès opérateur au schéma Cloud n'est pas confirmé ;
4. les anciens artefacts Cloud/HP ne sont pas identifiés pour rollback.

Les fichiers `.temp` Supabase déjà modifiés restent hors commit et n'ont pas été restaurés. Les PDF/artefacts restent physiquement sur disque mais sont ignorés. Aucun déploiement, push ou changement de base distante n'a été effectué.
