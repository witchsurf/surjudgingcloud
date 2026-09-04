# SurfJudging Field 0.6.7 — prerelease de validation

**Statut : PREPARED, NOT CERTIFIED. Ne pas utiliser en compétition avant la signature de distribution et les validations sur les hôtes cibles.**

## Provenance

- Source applicative : `27171632b2c89d9b567a6add48b383127d42d543`
- Correctif intégré : `149ce5e fix(scoring): align snapshot needed-score adapters`
- Frontend Field : `surfjudging-field-2717163`
- Schéma attendu : `20260829083000_restore_field_planning_v5_contract`
- Tests frontend ciblés : 26/26
- Tests Desktop : 84/84
- Contrôle du payload : `PACKAGING INPUT PASS`

## Artefacts

| Artefact | Cible | Taille | SHA-256 |
| --- | --- | ---: | --- |
| `SurfJudging Field Setup 0.6.7.exe` | Windows 11 x64 | 769 454 944 octets | `a968207491e983fdaf68209e6c0c62a6292091aef400ae8c36fb90a615844dcd` |
| `SurfJudging Field-0.6.7.dmg` | macOS Intel x64 | 791 408 203 octets | `930bf5c95422c4812b209005258a3287464825423703f297e21d8ab8f4f98935` |
| `SurfJudging Field-0.6.7-arm64.dmg` | macOS Apple Silicon | 785 367 132 octets | `72c39314faaf2b116c75997ae25275420297774b8fb8f6d6c6c209c0a9bde130` |

## Vérifications exécutées

- Les deux images DMG passent `hdiutil verify`.
- Les exécutables macOS correspondent respectivement à `x86_64` et `arm64`.
- L'EXE contient une application Windows `x86_64` empaquetée avec NSIS.
- Les trois paquets embarquent Desktop `0.6.7`, le frontend `surfjudging-field-2717163` et le schéma attendu.
- Une base neuve créée depuis l'image embarquée initialise bien le schéma `20260829083000_restore_field_planning_v5_contract` et ne contient aucun événement.
- Le frontend jetable répond en HTTP 200 sur l'accueil, Admin, Judge, Priority, Priority Display, Display et Overlay, sans erreur JavaScript observée.
- Aucun runtime Field actif ni aucune donnée de compétition n'a été modifié pendant ces contrôles.

## Limites bloquant la certification

- Le DMG Intel et son application sont non signés.
- Le DMG Apple Silicon utilise seulement une signature ad hoc ; il n'est pas signé avec `Developer ID Application`.
- Aucun DMG n'est notarisé par Apple.
- L'EXE ne possède pas de signature Authenticode ; Windows SmartScreen peut le bloquer.
- Aucun test d'installation, de redémarrage et de compétition complète n'a été exécuté sur une machine Windows 11 vierge ni sur un Mac vierge avec cette révision.
- L'installation sur le Mac de Sandy n'a pas été exécutée : l'hôte `192.168.1.99` était inaccessible par le réseau pendant cette préparation.

La promotion en release stable exige la signature Windows, un certificat Apple `Developer ID Application`, la notarisation Apple, puis la matrice d'acceptation sur les machines cibles.
