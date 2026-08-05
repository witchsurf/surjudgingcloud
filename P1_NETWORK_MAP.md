# P1 — carte réseau terrain

Pour l’adresse HP `192.168.1.2` (profil terrain par défaut) :

| Rôle | URL |
|---|---|
| Chef juge officielle | `http://192.168.1.2:8080/admin` |
| Alias chef juge historique | `http://192.168.1.2:8080/chief-judge` |
| Juges | `http://192.168.1.2:8080/judge` |
| Priorité | `http://192.168.1.2:8080/priority` |
| Display | `http://192.168.1.2:8080/display` |
| Supabase local / gateway | `http://192.168.1.2:8000` |
| ESP32 priorité | `http://priority.local` |

Le profil maison conserve l’adresse HP documentée `10.0.0.14`. Les scripts recalculent toutes les URLs avec `SURF_HP_HOST`. Le frontend parle à Supabase local via REST/Realtime sur le gateway LAN configuré. L’ESP32 est diagnostiqué séparément et son absence n’affecte jamais la disponibilité du scoring.

Aucune route `/chief` n’est ajoutée en P1.
