# P2.6.3A — Mac as Field Event Box

Date de caractérisation : 2026-08-08 (Africa/Dakar)

## Conclusion

**MAC_EVENT_BOX_BLOCKED**

Le Mac exécute correctement le frontend validé et la stack Supabase locale sur le LAN. Les routes terrain, REST, PostgreSQL, Realtime, les migrations, la persistance Docker et l'import hors ligne de `Competition X.xlsx` sont suffisamment caractérisés côté machine.

Il ne peut cependant pas encore être déclaré Event Box officiel :

1. `CLOUD_MAC_RELEASE_MATCH` n'est pas démontré ; aucune synchronisation Cloud n'a été lancée dans ce lot.
2. Les essais obligatoires depuis une vraie tablette (import, saisie juge, refresh, reconnexion Wi-Fi et observation Realtime) n'ont pas été exécutés.
3. La veille système reste réglée à 10 minutes sur secteur.
4. Le bootstrap d'un volume Supabase neuf n'est pas encore reproductible sans interventions techniques manuelles.
5. La restauration complète d'un dump Supabase reste non validée (risque R15).
6. La connectivité réelle de l'ESP32 vers `10.0.0.11` n'a pas été testée.

Aucun changement métier, SQL, WAL, timer, scoring, route ou firmware n'a été réalisé. Aucune nouvelle release n'a été créée.

## A. Stack locale

### Composants démarrés

| Composant | Image / exécution | Port hôte | Résultat |
|---|---|---:|---|
| Frontend terrain | image locale Nginx construite depuis `frontend/dist` | 8080 | HTTP 200 |
| PostgreSQL | `supabase/postgres:15.1.0.147` | 5432 | healthy |
| Kong / API Supabase | `kong:2.8.1` | 8000, 8443 | healthy |
| PostgREST | `postgrest/postgrest:v11.2.0` | via 8000 | REST 200 |
| Auth | `supabase/gotrue:v2.132.3` | via 8000 | health 200 |
| Realtime | `supabase/realtime:v2.25.50` | via 8000 | WebSocket 101 |
| Storage | `supabase/storage-api:v0.40.4` | via 8000 | démarré |
| Postgres Meta | `supabase/postgres-meta:v0.68.0` | interne | healthy |
| Studio | `supabase/studio:20231123-64a766a` | 3000 | répond 307, health Docker `unhealthy` |

Studio n'est pas requis par les tablettes ni par le scoring. Son état doit néanmoins être corrigé ou explicitement exclu du health-check avant certification opérateur.

La stack Supabase provient de `infra/docker-compose-local.yml`. Le compose local ne contient pas le frontend. Le frontend exact a donc été lancé séparément sur 8080. Le compose général n'a volontairement pas été démarré, car il contient des services cloud (Traefik/n8n) non nécessaires au terrain.

### Bootstrap neuf observé

Sur les volumes vierges, le démarrage initial n'a pas été autonome :

- les mots de passe de quatre rôles techniques de l'image n'étaient pas alignés avec la configuration locale ;
- le schéma `_realtime` était absent au premier démarrage ;
- le script versionné de réparation du tenant Realtime supposait ce schéma déjà présent.

Pour cette base locale isolée, les rôles techniques ont été réalignés sans exposer de secret, le schéma technique a été initialisé, puis le script Realtime versionné a été appliqué. Ces opérations persistent dans le volume, mais doivent être automatisées/testées avant de pouvoir reconstruire l'Event Box hors ligne en urgence.

Realtime a aussi tenté un téléchargement IANA tzdata lors de son premier démarrage. Un démarrage entièrement hors Internet exige donc un préchauffage et une validation à froid séparés.

## B. Machine

| Élément | Valeur observée |
|---|---|
| macOS | 26.6 (build 25G72) |
| Architecture | Intel x86_64 |
| CPU | 8 cœurs, 2,4 GHz |
| RAM physique | 64 Go |
| Disque racine | 932 Gio, environ 814 Gio libres |
| Docker client | 29.7.1 |
| Docker Engine | 29.5.2 via Colima |
| Docker Compose | 5.4.0 |
| VM Colima | x86_64, 4 vCPU, 8 Go RAM, virtiofs |
| IP LAN actuelle | `10.0.0.11` sur `en0` |
| Pare-feu macOS | désactivé lors du test |

Le modèle matériel exact n'a pas été retourné par `system_profiler` dans cet environnement. Les ressources disponibles sont néanmoins très supérieures à la charge observée et suffisantes pour 3 à 5 juges, admin, priorité, display et Supabase/Reatime. Cette conclusion de capacité ne remplace pas le test multi-clients réel.

## C. URLs LAN et routes

URLs candidates sur le réseau testé :

- Chef juge : `http://10.0.0.11:8080/admin`
- Alias historique : `http://10.0.0.11:8080/chief-judge`
- Juges : `http://10.0.0.11:8080/judge`
- Priorité : `http://10.0.0.11:8080/priority`
- Display : `http://10.0.0.11:8080/display`
- Participants : `http://10.0.0.11:8080/participants`
- Supabase local : `http://10.0.0.11:8000`
- Studio opérateur, non requis : `http://10.0.0.11:3000`

Toutes les routes frontend ci-dessus ont répondu HTTP 200 depuis le Mac en utilisant son adresse LAN. REST a répondu HTTP 200 sur `10.0.0.11:8000`.

Limite : cette vérification prouve l'écoute LAN, mais pas l'accès depuis un second appareil. Il faut encore confirmer l'isolation Wi-Fi/AP, le routage inter-clients et l'absence de changement d'IP. Une réservation DHCP ou une IP terrain fixe devra être décidée séparément.

## D. Schéma, RPC et Realtime

- 106 migrations sont enregistrées dans `supabase_migrations.schema_migrations`.
- Migration maximale : `20260808130000`.
- Version runtime : `20260808130000_atomic_safe_planning_heat_configs`.
- RPC présente : `bulk_upsert_heats_safe_v2(bigint,text,boolean,jsonb,jsonb,jsonb,jsonb,jsonb)`.
- Le handshake WebSocket via Kong sur `/realtime/v1/websocket` a retourné `101 Switching Protocols`.

Le handshake confirme la disponibilité du transport Realtime. La propagation juge vers admin sur le Wi-Fi plage reste à valider avec un événement actif et deux clients réels.

## E. Release et PWA

Release cible inchangée :

- commit : `36dba46dcd639c9ae7001291f76ba863fc8b0ff1`
- RELEASE_ID : `surfjudging-2026.08.08-p2.5.7-36dba46dcd63`
- bundle principal : `assets/index-CN4fQqgy.js`
- chunk XLSX présent : `assets/xlsxParser-Dl1RhDup.js`
- SHA-256 `index.html` : `d1a37a59c07089b4ec7ffb1aab9b1843f3503beed6dc9368e2628c2659d69af1`
- SHA-256 `sw.js` : `c133ecc325136ba8e0cc7e9df4eab07d02c212f9a281e42fd36dacf717714a08`

L'image locale `surfjudging-field:surfjudging-2026.08.08-p2.5.7-36dba46dcd63` sert exactement le `frontend/dist` validé. Le HEAD du dépôt est `c75ebf9`; son seul écart avec la release est le rapport documentaire `P2_6_2_RELEASE_CANDIDATE_REPORT.md`. Le code exécutable reste donc celui de la release cible.

L'audit réseau P1 est vert : routes `/admin`, `/chief-judge`, `/judge`, `/priority` et `/display` validées, aucune origine publique interdite observée. Le service worker est volontairement désactivé sur origine LAN par le comportement existant ; le chunk XLSX reste embarqué et l'application n'a pas besoin d'un CDN.

`CODE_SYNC = TRUE` côté artefact Mac. `SCHEMA_SYNC = TRUE` côté base Mac. `CLOUD_MAC_RELEASE_MATCH = NON VÉRIFIÉ`, donc la condition d'usage terrain n'est pas satisfaite.

## F. Persistance

Volumes nommés :

- `infra_postgres-data` : PostgreSQL et données Supabase ;
- `infra_storage-data` : objets Storage.

Le test suivant a été réalisé sans `-v` : inventaire avant arrêt, `docker compose down`, redémarrage, puis nouvel inventaire. Les 106 migrations et la version runtime ont été conservées à l'identique. Le frontend séparé est aussi resté disponible.

Commande interdite sur une compétition :

```bash
docker compose down -v
```

## G. Sauvegarde et restauration

Un dump custom non vide a été créé avec le rôle administrateur Supabase local et un checksum SHA-256 a été calculé. Le rôle `postgres` de l'image n'est pas superuser et ne peut pas lire `_realtime`; l'utiliser directement produit un dump vide et doit être proscrit.

La restauration complète dans une base isolée a échoué, y compris depuis `template0` et avec nettoyage, car une fonction Vault (`vault.secrets_encrypt_secret_secret`) est recréée automatiquement puis entre en conflit avec le dump. Les compteurs restaurés n'ont donc pas été validés. Le risque de restauration complète Supabase R15 reste ouvert.

Procédure minimale avant événement, à finaliser après résolution R15 :

1. vérifier que les conteneurs et la base sont sains ;
2. produire un dump custom avec le rôle administrateur Supabase local ;
3. refuser tout fichier vide ;
4. calculer et conserver son SHA-256 avec le dump ;
5. copier dump et checksum sur un support distinct ;
6. valider périodiquement la restauration sur une stack isolée de même version ;
7. ne jamais tester la restauration sur la base de compétition.

Le dump de caractérisation se trouve uniquement dans `/private/tmp` et n'est pas une sauvegarde terrain certifiée.

## H. Veille et alimentation

Réglages secteur observés : veille système 10 minutes, extinction écran 10 minutes, veille disque 10 minutes, Power Nap actif, `tcpkeepalive` actif. Aucun réglage n'a été modifié sans validation opérateur.

Avant terrain :

- brancher le Mac et le point d'accès sur alimentation secteur/UPS ;
- désactiver la veille système pendant l'événement ;
- autoriser l'écran à s'éteindre sans suspendre la machine ;
- vérifier que Colima/Docker ne s'arrête pas à la fermeture de session ;
- tester un cycle écran éteint puis reprise client.

## I. Competition X

Le fichier terrain réel `Competition X.xlsx` a été analysé avec le réseau explicitement interdit dans le test :

- 62 participants valides ;
- 7 catégories ;
- aucune erreur ;
- 8 avertissements de lignes vides ;
- médiane de parsing : 172,73 ms sur cinq passages ;
- test composant de preview : vert.

Deux tests automatisés ont réussi. Le scénario complet depuis une vraie tablette, avec création d'un événement temporaire, preflight SAFE et persistance atomique dans cette stack, n'a pas été rejoué dans ce lot. Les tests d'intégration existants utilisent la stack gérée par la CLI Supabase et non directement ce compose ; ils n'ont pas été détournés pour éviter une fausse validation.

## J. Performance

Instantané au repos après redémarrage :

| Service | CPU approx. | RAM approx. |
|---|---:|---:|
| Frontend | 0,00 % | 4,8 Mio |
| PostgreSQL | 0,12 % | 142,5 Mio |
| Kong | 0,07 % | 309,9 Mio |
| Realtime | 1,19 % | 166,2 Mio |
| Postgres Meta | 0,78 % | 80,1 Mio |
| Autres Supabase | proche de 0 % | environ 145 Mio cumulés |

Latences depuis le Mac vers son adresse LAN : frontend environ 4 ms, REST environ 29 ms au moment de la mesure. Import XLSX médian : 172,73 ms. Les latences juge vers admin, admin vers display et le comportement à plusieurs clients ne sont pas mesurés sans appareils réels.

## K. ESP32 priorité

L'ESP32 demeure non bloquant pour le scoring. Sa configuration actuelle n'a pas été modifiée. Il faut vérifier séparément qu'il peut joindre le Mac à `10.0.0.11` et que tout endpoint Supabase/front configuré ne pointe plus vers l'ancien HP. Toute modification de firmware ou de configuration appartient à un lot distinct.

## L. Tests exécutés

| Test | Résultat |
|---|---|
| Routes frontend locales et LAN | PASS |
| REST local et LAN | PASS |
| Migrations et version runtime | PASS |
| Présence RPC atomic planning | PASS |
| Handshake Realtime | PASS (101) |
| Audit réseau P1 | PASS, 0 violation |
| Parse/preview réel Competition X hors ligne | PASS, 2 tests |
| Persistance après `compose down` sans volumes | PASS |
| Dump custom non vide + checksum | PASS |
| Restauration complète isolée | FAIL, conflit Vault / R15 |
| Vraie tablette /judge et /participants | NON EXÉCUTÉ |
| Realtime juge vers admin sur Wi-Fi | NON EXÉCUTÉ |
| Multi-clients et display | NON EXÉCUTÉ |
| ESP32 vers Mac | NON EXÉCUTÉ |
| Alignement Cloud/Mac | NON VÉRIFIÉ |

## M. Conditions de déblocage

Le statut pourra devenir `MAC_EVENT_BOX_READY` uniquement après :

1. alignement vérifié du Cloud et du Mac sur la release cible, sans synchronisation automatique de données compétition ;
2. désactivation validée de la veille système pendant l'événement ;
3. smoke test complet depuis une vraie tablette avec `Competition X.xlsx` ;
4. saisie juge, réception admin, refresh et reconnexion Wi-Fi réels ;
5. essai multi-clients admin/juges/display ;
6. vérification ESP32 ou constat explicite de son absence non bloquante ;
7. procédure reproductible de démarrage à froid hors Internet ;
8. maintien explicite de R15 ouvert tant qu'une restauration complète n'est pas prouvée.

