# SurfJudging Field 0.6.6 — prerelease de test

**Statut : PREPARED, NOT CERTIFIED. Ne pas utiliser en compétition avant les validations hôte cible.**

## Provenance

- Source applicative : `f8d6343bd135c2c81301fc704e8df96839f13af9`
- Frontend Field : `surfjudging-field-f8d6343`
- Schéma attendu : `20260829083000_restore_field_planning_v5_contract`
- Tests Desktop : 77/77
- Contrôle du payload : `PACKAGING INPUT PASS`

## Artefacts

| Artefact | Cible | Taille | SHA-256 |
| --- | --- | ---: | --- |
| `SurfJudging Field Setup 0.6.6.exe` | Windows 11 x64 | 769 448 928 octets | `c197a62c2a496d83ff6af8084250645cac684ea3f15b9183355dd5b45e569b41` |
| `SurfJudging Field-0.6.6.dmg` | macOS Intel x64 | 793 843 677 octets | `8d11732f2465e90e97bc737498c722171c6d42b25734d5c2dc0cac450c07603c` |
| `SurfJudging Field-0.6.6-arm64.dmg` | macOS Apple Silicon | 786 071 527 octets | `adf8dc489e43dbd06f5435df79355b31fddd2ad64281359fc6f38300d5560603` |

## Vérifications exécutées

- Les deux images DMG passent `hdiutil verify`.
- Les applications macOS embarquées passent `codesign --verify --deep --strict`.
- Les exécutables macOS correspondent respectivement à `x86_64` et `arm64`.
- Les trois paquets embarquent la version Desktop `0.6.6` et le payload Field `f8d6343`.
- L'EXE est un installateur NSIS Windows x64 et sa version embarquée est `0.6.6`.

## Limites bloquant la certification

- L'EXE ne possède pas de signature Authenticode ; Windows SmartScreen peut le bloquer.
- Les applications macOS sont signées avec `Apple Development`, pas avec `Developer ID Application`.
- Les deux DMG sont rejetés par Gatekeeper et ne possèdent aucun ticket de notarisation.
- Aucun test d'installation, de redémarrage et de compétition complète n'a encore été exécuté sur une machine Windows 11 vierge ni sur un Mac Apple Silicon vierge.

La promotion en release stable exige une signature Windows, un certificat Apple Developer ID, une notarisation Apple, puis la matrice d'acceptation sur machines cibles.
