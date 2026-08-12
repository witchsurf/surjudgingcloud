# P2.6.6H1 — Deployment-aware internal links

Date : 2026-08-09

## Conclusion courante

`QR_PHYSICAL_SCAN = PASS`  
`TEST_RELEASE_LINKS_READY = TRUE`  
`DUAL_MODE_TEST_RELEASE_READY`

La validation opérateur physique est terminée : le QR ouvre `https://test.surfjudging.cloud/...` sans bascule vers la production. Le smoke moderne H3 à trois juges, la fermeture normale et la conservation des scores sont validés.

## Release H1

- commit applicatif : `63ccc219d514e114f523f840a53fc67010c53a8c`
- RELEASE_ID : `surfjudging-2026.08.09-p2.6.6-test-63ccc21`
- ancienne candidate `d92c23a` : déclassée, hashes non réutilisés
- GitHub Actions TEST : run `31337077495` — SUCCESS
- commit de transport TEST : `b8d1f2b2ad56d70da5c13bd5a7679966cb60cbac`
- production : inchangée

## Inventaire des URLs

### Frontend interne — concerné

Dans `AdminInterface`, la base des liens display, portail juges, priorité et postes J1–J5 pouvait provenir de `VITE_SITE_URL*` ou `VITE_KIOSK_BASE_URL*`. Le build TEST héritait ainsi de `https://surfjudging.cloud`.

Les consommateurs identifiés sont :

- affichage public `/display` : texte, ouverture, copie et QR ;
- portail partagé `/judge` : texte, copie et QR ;
- tablette priorité `/priority` : texte, copie et QR ;
- liens individuels J1 à J5 `/judge?...&position=Jx` : texte et copie ;
- paramètres `eventId`, `podium`, `position` et fallback `config` : préservés ;
- participants/Admin/navigation applicative : routes React relatives déjà correctes ;
- overlay : aucune base frontend Cloud hardcodée identifiée ;
- exports PDF : aucune URL frontend interne embarquée identifiée.

`FieldDiagnosticsPanel` utilisait déjà l'origine terrain calculée par `fieldNetwork` et ne nécessitait pas de modification.

### Backend ou externe légitime — non modifié

- URLs Supabase Cloud/LAN : backend, pas frontend ;
- `automation.surfjudging.cloud` : webhook N8N ;
- Google Sheets : import explicite utilisateur ;
- `display.surfjudging.cloud` : hostname public dédié utilisé uniquement pour le routage d'entrée ;
- URLs opérateur dans les scripts HP : documentation/diagnostic, pas génération runtime partagée.

### Stripe hors périmètre — documenté, non modifié

Deux callbacks dans l'ancien `pages/PaymentPage.tsx` contiennent encore `https://surfjudging.cloud/events/payment/...`. Ils appartiennent au workflow Stripe explicitement exclu de H1 et restent couverts par `CLOUD_PRODUCTION_PAYMENT_READY = FALSE`. Ils devront être corrigés avec le chantier paiement, sans les confondre avec les liens tablettes/QR.

## Contrat implémenté

`buildDeploymentAwareUrl(origin, route, params)` :

- n'accepte que `/display`, `/judge` ou `/priority` ;
- normalise systématiquement sur `new URL(origin).origin` ;
- conserve les paramètres autorisés ;
- ne consulte aucune variable `VITE_SITE_URL*` ou `VITE_KIOSK_BASE_URL*`.

Dans Admin, l'origine est exclusivement `window.location.origin`. Ainsi :

- production produit `https://surfjudging.cloud/...` ;
- TEST produit `https://test.surfjudging.cloud/...` ;
- Event Box produit `http://10.0.0.11:8080/...` ;
- une future installation Windows suit automatiquement son origine courante.

## QR codes

Les trois QR utilisent `encodeDeploymentAwareQr`. Les tests injectent un encodeur espion et vérifient l'argument exact réellement transmis à l'encodeur, pas seulement le texte affiché :

- display : URL `/display` sur l'origine courante ;
- portail : URL `/judge` sur l'origine courante ;
- priorité : URL `/priority` sur l'origine courante.

Les options visuelles historiques sont conservées : largeur 220, marge 1, fond blanc et couleurs propres à chaque QR.

## Tests

| Contrôle | Résultat |
| --- | --- |
| Trois origines × display/judge/priority | PASS |
| Valeurs réelles transmises aux trois encodeurs QR | PASS |
| Tests ciblés H1 + Admin + dual-mode | PASS — 40 tests |
| TypeScript | PASS |
| Vitest complet au SHA exact | PASS — 70 fichiers/406 tests ; 6 fichiers/7 tests opt-in ignorés |
| Build Cloud au SHA/RELEASE_ID exacts | PASS |
| Build Field au SHA/RELEASE_ID exacts | PASS |
| Audit réseau Field | PASS — 0 violation, routes historiques PASS |
| `git diff --check` | PASS |

Aucun scoring, migration SQL, RLS ou paiement Stripe n'a été modifié.

## Nouveaux artefacts immuables

| Artefact | Taille | SHA-256 |
| --- | ---: | --- |
| `releases/surfjudging-2026.08.09-p2.6.6-test-63ccc21-cloud.tar.gz` | 1 587 219 octets | `41c19a08596208b20530d05b8c4b5c835cadac910bc93a47dcd7eb9903e2845d` |
| `releases/surfjudging-2026.08.09-p2.6.6-test-63ccc21-field.tar.gz` | 1 586 183 octets | `a48c1a69369b7e0d8f750e0f9f03cd9f956372a01aa15afc14c4703862986007` |

### Hashes Cloud

- `index.html` : `a80bf34503412d613aa70c3115ab63282071e75ad429ff1193e1626b26478ea2`
- `sw.js` : `cf49447796d71168e5999ca45d3b8dbeab5008d61610ed963f623e3416cc8d3b`
- `assets/xlsxParser-CyMKfcg8.js` : `f0814a4d3fdd874661775563f63c7286d28d1a3740c47d3f70cfbf0e27f99e4b`
- `deployment-manifest.json` : `8db6e8e81e623c080b908515b1097bd347db3acfaf7c601c50b960978c680743`

### Hashes Field

- `index.html` : `9eb294b8f2993d9ee2d6d54ff13136799014e3abf01bb04a5ad610a83414e0b8`
- `sw.js` : `80bc09fd0a8a07df52bc9abae6cfc7ee77e874f701ec3c4af201de1a13b1d8e8`
- `assets/xlsxParser-jyuzjPnh.js` : `b99a198f1bf30f4e68803d96d0fc865d7ecbeada3fe83c9b6ee4d32686d19cb4`
- `deployment-manifest.json` : `62d572a65f29f79073d859a26d96b893884d6c79ba65e7d4b04341b393ef42a3`

## Déploiement TEST

`https://test.surfjudging.cloud/RELEASE_ID` retourne le nouveau RELEASE_ID. Le manifeste HTTP confirme :

- `deploymentMode = cloud` ;
- `codeRevision = 63ccc219d514e114f523f840a53fc67010c53a8c` ;
- schéma attendu `20260808197000_events_rls_ownership_isolation` ;
- activation Cloud-test supportée.

`/admin` TEST et production répondent HTTP 200. Aucun rebuild n'a été effectué sur le VPS.

## Validation opérateur finale

- QR physique sur vraie tablette : PASS ;
- origine conservée sur `test.surfjudging.cloud` : PASS ;
- absence de bascule vers `surfjudging.cloud` : PASS ;
- smoke moderne H3 à trois juges : PASS ;
- moyenne, Best 2, ranking et refresh sans doublon : PASS ;
- fermeture normale et conservation des scores : PASS.

`CLOUD_PRODUCTION_PAYMENT_READY = FALSE` : Stripe reste ouvert et hors périmètre.
