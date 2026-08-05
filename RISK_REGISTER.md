# Registre des risques — audit P0

Échelle : impact et probabilité de 1 (faible) à 5 (critique/forte). Le score est leur produit.

| ID | Risque observé | I | P | Score | Mesure P0/P1 proposée |
|---|---|---:|---:|---:|---|
| R01 | Le HP/Supabase local est un point de panne unique pour tous les postes | 5 | 3 | 15 | Snapshot, healthcheck, test arrêt brutal, procédure de remplacement/restauration |
| R02 | Deux files hors ligne et plusieurs couches d'accès peuvent rejouer en double ou dans un ordre incorrect | 5 | 3 | 15 | Tests d'idempotence, déconnexion/reconnexion et soumissions concurrentes |
| R03 | Le calcul 3/5 juges n'a pas de tests nominaux explicites | 5 | 3 | 15 | Ajouter tests de caractérisation sans modifier le comportement |
| R04 | Timer piloté par le navigateur chef juge et horloges clientes, sans machine d'état serveur complète | 5 | 3 | 15 | Tests de dérive/reload ; documenter l'autorité réelle avant P4 |
| R05 | Dérive entre migrations cloud, migrations HP et SQL legacy | 5 | 3 | 15 | Conserver le contrôle de version runtime et tester une installation HP propre |
| R06 | Types Supabase `any`, erreurs de colonnes/RPC détectées seulement au runtime | 4 | 4 | 16 | Générer/figer le schéma et introduire des contrats d'adaptateur |
| R07 | Build terrain mal configuré pouvant appeler le Supabase cloud | 5 | 2 | 10 | Garder `field-smoke`, allowlist LAN/CSP et test sans WAN |
| R08 | Note 0 acceptée alors que la cible annonce 0,1 minimum | 3 | 4 | 12 | Faire valider la règle métier avant tout changement ; test de caractérisation |
| R09 | Trim appliqué pour `judgeCount >= 5`, comportement non défini au-delà de cinq | 3 | 2 | 6 | Borner/valider le panel lors de la future extraction du moteur |
| R10 | Résultats calculés côté client, risque de divergence de version entre écrans | 5 | 3 | 15 | Figer le build terrain ; tests croisés admin/display puis futur moteur canonique |
| R11 | Realtime LAN dégradé ; polling de repli jusqu'à 30 s | 4 | 3 | 12 | Mesurer durant préflight, afficher état de canal et tester veille/reconnexion tablette |
| R12 | ESP32 contient URLs/clé anon et mélange cloud/local/SSE/polling | 4 | 3 | 12 | Inventaire de configuration, mode local forcé événement, health visible |
| R13 | Aucun accusé matériel canonique de l'état ESP32 | 3 | 3 | 9 | Afficher état inconnu/déconnecté sans bloquer le scoring ; futur ACK journalisé |
| R14 | Export simple contient actuellement des données simulées vides | 4 | 4 | 16 | Marquer non opérationnel et tester les exports réellement utilisés |
| R15 | Restauration PostgreSQL validée sur données métier, mais restauration complète de la stack Supabase (Auth, Storage, Realtime et métadonnées) non démontrée | 5 | 3 | 15 | Risque explicitement maintenu ouvert en P1 ; tester un bundle complet sur box de secours avant migration de stockage |
| R16 | Google Sheet URL et image Unsplash nécessitent Internet | 2 | 4 | 8 | CSV local par défaut, embarquer l'image dans un futur jalon hors ligne |
| R17 | Auth cloud email/OTP indisponible sans WAN | 4 | 3 | 12 | Vérifier les rôles/PIN locaux avant départ et ne pas expirer une session en heat |
| R18 | Stripe/paiement pourrait être couplé par erreur à l'accès événement | 5 | 2 | 10 | Test garantissant que paiement et licence ne bloquent jamais le terrain |
| R19 | Identifiants textuels/canonicalisation historique peuvent attacher une note au mauvais heat | 5 | 3 | 15 | Tests événement/heat/podium, contraintes et audit des orphelins avant migration |
| R20 | Override de lineup pouvant déplacer des scores attachés au lycra | 5 | 2 | 10 | Conserver invariant couleur et tests de non-régression obligatoires |
| R21 | Fermeture forcée ou réparation de qualifiés peut altérer les données | 5 | 2 | 10 | Motif/audit, backup préalable ; scripts de réparation seulement en secours |
| R22 | Secrets opérationnels ou clés compilées dans scripts/firmware | 4 | 3 | 12 | Inventaire sans publication des valeurs, rotation et configuration séparée |
| R23 | Sauvegardes limitées aux 12 dernières et stockées sur le même HP | 4 | 3 | 12 | Copie USB vérifiée et rotation adaptée à la compétition |
| R24 | Une tablette en navigation privée peut perdre IndexedDB/localStorage | 5 | 2 | 10 | Interdire navigation privée dans le runbook et tester le fallback visible |

## Risques bloquants avant toute réécriture

R03, R04, R06, R10 et R19 imposent de figer des tests de caractérisation avant de déplacer le calcul ou les données. R01, R02, R05 et R15 imposent une sauvegarde/restauration vérifiée avant toute migration destructive. R07, R11, R17 et R24 doivent être validés sur le réseau plage réel, pas seulement en développement.

## Acceptation recommandée de P0

P0 peut être validée lorsque : les tests 3/5 juges et invariants couleur existent et passent ; un build de référence et un smoke test LAN passent ; les versions frontend/schéma sont enregistrées ; une sauvegarde de référence est vérifiée ; et le propriétaire métier tranche les divergences note minimale, règles d'arrondi et comportement incomplet.
