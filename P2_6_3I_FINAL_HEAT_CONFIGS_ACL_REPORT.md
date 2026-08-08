# P2.6.3I — Final Heat Configs ACL Reconciliation

Date : 2026-08-08

## Conclusion

`DB_CLOUD_MAC_SYNC_READY`

`SCHEMA_SYNC = TRUE`

Cloud, Mac Event Box et reconstruction vierge sont au stamp `20260808170000`. La matrice ACL pertinente de `public.heat_configs`, les droits d'exécution de la RPC runtime, la présence des RPC runtime/safe v2 et l'activation RLS sont alignés.

Aucun frontend n'a été déployé. L'artefact produit est seulement préparé pour une phase de déploiement explicitement séparée.

## Migration 170000

Fichier : `backend/supabase/migrations/20260808170000_finalize_heat_configs_acl.sql`.

La migration monotone :

- révoque uniquement `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` à `anon` et `authenticated`;
- révoque uniquement l'EXECUTE explicite de `anon` sur `upsert_heat_config_runtime`;
- réaffirme `SELECT` pour `anon/authenticated`;
- réaffirme l'EXECUTE RPC pour `authenticated/service_role`;
- ne touche ni aux policies RLS, ni au owner, ni à `service_role ALL`;
- n'utilise pas `REVOKE ALL`.

Assertions : `backend/supabase/tests/p2_6_3i_final_heat_configs_acl.sql`.

## Compatibilité MAINTAIN

| Cible | PostgreSQL | MAINTAIN reconnu |
|---|---|---:|
| Cloud | 17.6, confirmé par l'en-tête du dump logique | oui |
| Mac Event Box | 17.6 | oui |
| stack vierge isolée | 17.6 | oui |

Sur PostgreSQL 17, `MAINTAIN` apparaît avec la lettre ACL `m`. Le baseline Mac contenait `anon=rm` et `authenticated=rm`; l'absence antérieure dans `information_schema.role_table_grants` ne signifiait donc pas absence de droit effectif. La migration utilise la syntaxe directe, valide sur les trois cibles.

## Baseline avant 170000

Cloud et Mac étaient au stamp `20260808160000`.

- Cloud : anciens droits auxiliaires `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` pour `anon/authenticated`, plus EXECUTE RPC pour `anon`.
- Mac : `MAINTAIN` effectif pour `anon/authenticated`, sans les trois autres droits auxiliaires ni EXECUTE RPC anon.
- `INSERT/UPDATE/DELETE` étaient déjà refusés aux deux rôles sur les deux cibles.

Aucune autre divergence pertinente n'a été découverte.

## Validation Cloud-like et stack vierge

Une stack isolée `surfjudging_p263i`, ports `593xx`, a servi aux deux validations.

### Cloud-like

Séquence réelle testée :

1. état historique `GRANT ALL` à `anon/authenticated` et EXECUTE anon;
2. application de `160000`;
3. application de `170000`;
4. assertions finales.

Résultat : PASS. Le premier montage, qui avait placé par erreur `GRANT ALL` après `160000`, a correctement échoué sur `INSERT`; il a été jeté puis rejoué dans l'ordre historique exact ci-dessus.

### Reconstruction vierge

- toutes les migrations : PASS;
- stamp final : `20260808170000`;
- RPC `upsert_heat_config_runtime` : présente;
- RPC `bulk_upsert_heats_safe_v2` : présente;
- assertions ACL/RPC/RLS : PASS;
- lectures publiques/authenticated et écritures runtime via RPC : PASS.

## Backups

### Mac avant 170000

- fichier : `backups/p2_6_3i_mac_pre170000_20260808.dump`;
- taille : 715960 octets;
- SHA-256 : `19eaa6d7d6715827fb89f26efd9a6d40140eb127e538aa5e17f2e768b47c9e53`.

### Cloud avant 170000

| Fichier | Taille | SHA-256 |
|---|---:|---|
| `p2_6_3i_cloud_pre170_schema.sql` | 239735 | `5c61d07c2aee456d9b03b9c587be42664bfd875b7a1170590a00eab12a95ea30` |
| `p2_6_3i_cloud_pre170_data.sql` | 1752626 | `70260535deb8018539d2a6ae45514337adc0462688f7154b5bc81d65a9a7455d` |
| `p2_6_3i_cloud_pre170_roles.sql` | 358 | `4350a72b5ec109888e740c17f3eb4da2fcd95ab73af26499538ed0bf615db543` |

Les dumps sont non vides. Le dump de rôles a nécessité une seconde commande isolée après que la première chaîne s'est arrêtée à la fin du dump de données.

Le dump Cloud de données post-migration est identique au pré-migration après retrait des marqueurs aléatoires `pg_dump` `restrict/unrestrict` : SHA-256 normalisé commun `8c32b3db868fbb922cc0054574c7bfacd0311b10da03a7a9b98041454b31b083`. Aucune donnée métier n'a changé.

## Matrice finale Cloud/Mac

| Propriété | Cloud | Mac | Parité |
|---|---:|---:|---:|
| stamp | 170000 | 170000 | oui |
| anon SELECT | oui | oui | oui |
| anon INSERT/UPDATE/DELETE | non | non | oui |
| anon TRUNCATE/REFERENCES/TRIGGER/MAINTAIN | non | non | oui |
| anon EXECUTE runtime RPC | non | non | oui |
| authenticated SELECT | oui | oui | oui |
| authenticated INSERT/UPDATE/DELETE | non | non | oui |
| authenticated TRUNCATE/REFERENCES/TRIGGER/MAINTAIN | non | non | oui |
| authenticated EXECUTE runtime RPC | oui | oui | oui |
| service_role table | ALL | ALL | oui |
| service_role EXECUTE runtime RPC | oui | oui | oui |
| runtime RPC | présente | présente | oui |
| safe v2 | présente | présente | oui |
| RLS heat_configs | activé | activé | oui |

Les policies RLS historiques restent différentes par origine, mais n'ont pas été modifiées et ne créent aucune divergence d'ACL effective dans la matrice approuvée.

## Tests fonctionnels et release

- SQL compatibility/ACL : PASS;
- runtime `saveConfiguration` via RPC et update : PASS;
- IndexedDB offline, refresh et replay : PASS;
- frontière `/fix` : PASS;
- WAL score et override réels : PASS;
- planning safe v2 : PASS;
- Competition X repository/UI : PASS;
- Admin/Judge/Display reads : PASS;
- direct writes anon/authenticated : refusés;
- Realtime config : PASS au rerun contrôlé, 891 ms;
- premier essai Realtime : timeout isolé de 10 s, service sain et publication présente, même intermittence caractérisée en P2.6.3H;
- TypeScript `tsc --noEmit` : PASS;
- Vitest complet : 370 PASS, 7 opt-in ignorés;
- architecture/tests P0/P2 : inclus dans la suite, PASS;
- Vite/PWA : PASS, 2456 modules, 48 entrées précachées;
- audit réseau P1 : PASS sur `/admin`, alias `/chief-judge`, `/judge`, `/priority`, `/display`, zéro violation;
- `scripts/hp-refresh-stack.sh` : syntaxe PASS.

## Release

- commit code : `30705d1fc8153659654d676618f17567ba9b849e`;
- RELEASE_ID : `surfjudging-2026.08.08-p2.6.3i-30705d1`;
- build réalisé une seule fois depuis ce commit;
- aucun déploiement Cloud ou Mac du frontend.

## Artefact unique

Fichier : `releases/surfjudging-2026.08.08-p2.6.3i-30705d1-frontend.tar.gz`

| Élément | SHA-256 |
|---|---|
| archive (1581770 octets) | `6b413eae3b68b88fc278be4a85a8772302d85a70fd6a7b39259e95b3edf74b85` |
| `dist/index.html` | `06ad3ca87a07b591a272c781b6f9d2f1ff53d9bfe259357277aa199359074d57` |
| `dist/sw.js` | `7f5130d604f73ceabcebd5f18b05ffb97df92d338b1682af1d14faa878d7b47f` |
| XLSX `xlsxParser-Djmyzu8_.js` | `37c65dbd0a7188dbf795a972f4f26562de727c5767447e6b539bd48896b38ab2` |

Cet artefact est l'unique candidat pour Cloud et Mac Event Box. Son déploiement exige une validation explicite ultérieure.

Conclusion obligatoire : `DB_CLOUD_MAC_SYNC_READY`.
