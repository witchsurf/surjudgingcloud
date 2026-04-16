# HP Local Stack Memo

## Contexte
Ce memo concerne la machine HP qui fait tourner la stack locale Docker de Surf Judging.

Chemins utiles :
- repo sur le HP : `~/surjudgingcloud`
- infra : `~/surjudgingcloud/infra`

## Mots de passe / secrets utiles
Mot de passe PostgreSQL local actuellement utilise par la stack :

```env
POSTGRES_PASSWORD=SurfJudging2026SecurePassword
```

Ce mot de passe est celui attendu par :
- `surfjudging_postgres`
- `surfjudging_auth`
- `surfjudging_storage`
- `surfjudging_rest`
- `surfjudging_realtime`

Attention :
- si ce mot de passe change dans `.env` ou `.env.local` sans realigner les roles internes Supabase, `auth` et `storage` peuvent repartir en boucle de restart
- `supabase_auth_admin` et `supabase_storage_admin` sont des roles reserves : leur secret n’est pas toujours corrigeable via un simple `ALTER ROLE`

## Symptomes deja observes
- `502 Bad Gateway` sur `http://<HP>:8000/rest/v1/...`
- `surfjudging_auth` en boucle de restart
- `surfjudging_storage` en boucle de restart
- `surfjudging_realtime` en boucle de restart

## Cause reelle trouvee
1. `kong` pouvait garder un upstream DNS incorrect pour `rest`.
2. Les roles internes `supabase_auth_admin` et `supabase_storage_admin` n’avaient pas de secret utilisable.
3. Le schema `_realtime` et ses migrations n’etaient pas initialises correctement.

## Correctif applique
### 1. Fiabiliser Kong
Le fichier [infra/kong.yml](/Users/sandy/Desktop/judging/infra/kong.yml) utilise maintenant les noms de conteneurs explicites :
- `surfjudging_rest`
- `surfjudging_auth`
- `surfjudging_realtime`
- `surfjudging_storage`

Redemarrage utile :

```bash
cd ~/surjudgingcloud/infra
docker compose -f docker-compose-local.yml up -d kong
```

Test rapide :

```bash
curl -i http://10.0.0.28:8000/rest/v1/events?select=id
```

Si tout va bien : `HTTP/1.1 200 OK`

### 2. Verifier l’etat des services

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Services attendus :
- `surfjudging_postgres`
- `surfjudging_kong`
- `surfjudging_rest`
- `surfjudging_auth`
- `surfjudging_storage`
- `surfjudging_realtime`

### 3. Si `auth` ou `storage` redemarrent en boucle
Verifier les logs :

```bash
docker logs --tail=100 surfjudging_auth
docker logs --tail=100 surfjudging_storage
```

Si tu vois :
- `password authentication failed for user "supabase_auth_admin"`
- ou `password authentication failed for user "supabase_storage_admin"`

alors les secrets internes des roles sont desynchronises.

### 4. Si `realtime` redemarre en boucle
Verifier :

```bash
docker logs --tail=100 surfjudging_realtime
```

Si tu vois :
- `invalid_schema_name`
- `no schema has been selected to create in`

alors `_realtime` n’est pas correctement initialise.

## Sequence de remise en route qui a marche
Depuis le HP :

```bash
cd ~/surjudgingcloud/infra
docker compose -f docker-compose-local.yml up -d kong
docker restart surfjudging_auth surfjudging_storage surfjudging_realtime
docker ps --format "table {{.Names}}\t{{.Status}}"
curl -s -o /dev/null -w "%{http_code}\n" http://10.0.0.28:8000/rest/v1/events?select=id
```

## Point sensible
Pour cette stack, il existe des roles PostgreSQL reserves (`supabase_auth_admin`, `supabase_storage_admin`) qui peuvent necessiter une correction bas niveau si leurs secrets internes sont vides ou incoherents.

Donc :
- changer `POSTGRES_PASSWORD` demande de la prudence
- il faut considerer ce changement comme une operation de maintenance, pas une simple edition de `.env`

## Recommandation pratique
- ne change pas `POSTGRES_PASSWORD` sur le HP juste avant un evenement
- si tu dois le changer, prevoir une verification complete de :
  - `auth`
  - `storage`
  - `realtime`
  - `rest/v1`
- garder ce memo dans le repo et garder une copie de `.env` du HP
