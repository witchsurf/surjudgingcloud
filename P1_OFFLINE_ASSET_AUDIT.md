# P1 — audit des assets hors ligne

L’image Unsplash utilisée dans les écrans événement et accueil a été remplacée par `frontend/public/surf-event-local.svg`. Le build terrain ne dépend donc plus de cette image distante.

Le contrôle `scripts/p1-field-build-audit.mjs` inspecte les URL présentes dans les assets HTML/CSS/SVG/JSON produits et bloque, à l’exécution, toute requête sortant de l’allowlist. Les modules JavaScript cloud peuvent rester compilés pour les usages hors terrain ; ils sont acceptés seulement s’ils ne déclenchent aucune requête sur les routes terrain.

Allowlist : origine frontend locale, localhost/loopback, IPv4 RFC1918, `priority.local`, origine Supabase locale explicitement configurée, schémas internes `data:`, `blob:` et `about:`. Toute autre origine est refusée, notamment Supabase Cloud, Google, Stripe et Unsplash.

La chaîne `http://www.w3.org/2000/svg` est un identifiant de namespace XML et non une ressource réseau ; elle est ignorée explicitement par l’audit statique.
