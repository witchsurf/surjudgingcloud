# AGENTS.md

Consignes projet pour les agents Codex travaillant dans ce dépôt.

## Contexte

Le projet `surjudgingcloud` est une app de jugement surf avec :

- frontend React/Vite dans `frontend/`
- backend Supabase dans `backend/supabase/`
- stack locale HP/Event Box via `infra/docker-compose-local.yml`
- scripts opérationnels dans `scripts/`

## Priorités

- Préserver le mode terrain LAN/HP, qui est critique le jour d’événement.
- Ne pas casser les flux `./event-box` et `./beach`.
- Préférer les corrections robustes côté Supabase quand le besoin touche la logique métier.
- Garder les scripts simples : Cloud -> HP avant event, HP -> Cloud après event.

## Sources De Vérité

- Runbook terrain : `docs/hp-operations-runbook.md`.
- Déploiement : `DEPLOYMENT.md`.
- Fonctions Supabase : `backend/supabase/functions`.
- Migrations : `backend/supabase/migrations`.

## Règles De Travail

- Ne jamais supprimer ou écraser des données terrain sans confirmation explicite.
- Les scores sont attachés à la couleur de lycra; un override de nom/participant ne doit pas modifier les scores.
- Les scripts de réparation de qualifiés sont du secours, pas le chemin normal.
- Après une modification terrain importante, vérifier au minimum :

```bash
npm --prefix frontend run build
bash -n scripts/hp-refresh-stack.sh
```
