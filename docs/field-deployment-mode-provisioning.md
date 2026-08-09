# Provisioning du mode Field autoritatif

Le mode d'une base SurfJudging est stocké dans le singleton privé `public.app_deployment_config`.
La migration initialise toujours une nouvelle base en mode sûr `cloud`. Elle ne déduit jamais le mode depuis un hostname, une variable Vite ou une donnée du navigateur.

## Cloud

L'application normale des migrations laisse la ligne canonique en `deployment_mode = 'cloud'`. Aucune commande de provisioning Field ne doit être exécutée sur la base Cloud.

## Event Box Mac / Linux

Le workflow officiel `scripts/hp-refresh-stack.sh`, appelé par `./event-box`, applique les migrations puis exécute comme administrateur PostgreSQL :

```bash
docker exec -i surfjudging_postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < backend/sql/PROVISION_FIELD_DEPLOYMENT_MODE.sql
```

Pour une nouvelle installation locale exécutée directement depuis le dépôt, utiliser la même commande après l'application complète des migrations.

## Event Box Windows / Docker Desktop

Depuis PowerShell, après l'application complète des migrations :

```powershell
Get-Content -Raw backend/sql/PROVISION_FIELD_DEPLOYMENT_MODE.sql |
  docker exec -i surfjudging_postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres
```

## Vérification opérateur

Exécuter localement, avec les droits d'administration de la machine Event Box :

```bash
docker exec surfjudging_postgres psql -At -U postgres -d postgres \
  -c 'select public.get_authoritative_deployment_mode()'
```

Le résultat attendu est `field`. Sur Cloud, le résultat attendu est `cloud`.

`anon` et `authenticated` n'ont aucun droit direct `SELECT`, `INSERT`, `UPDATE` ou `DELETE` sur le singleton. La seule lecture exposée passe par une fonction SECURITY DEFINER étroite. Aucun écran ne peut changer le mode.
