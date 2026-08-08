# P2.5.6h — Offline Spreadsheet Heat Import

## Conclusion

L'import XLSX/CSV intégralement local est compatible avec l'architecture React/Vite/PWA actuelle, à condition d'introduire une frontière canonique avant toute écriture et de ne jamais raccorder directement un parseur de fichier à `ParticipantRepository` ou `HeatPlanningRepository`.

Flux proposé :

```text
File local (.xlsx/.csv)
  -> adaptateur de décodage local
  -> lignes tabulaires neutres
  -> normalisation/validation pure
  -> CanonicalPlanningInput + diagnostics
  -> preview bracket existante en mémoire
  -> planning safety preflight (bloquant)
  -> confirmation opérateur
  -> HeatPlanningRepository
  -> Supabase HP local
```

Google Sheets devient une source online optionnelle produisant le même contrat. Il n'est jamais nécessaire sur le terrain.

Aucune librairie n'a été ajoutée, aucun workflow de production n'a été modifié et aucun prototype XLSX n'a été branché. Cette prudence est volontaire : la dépendance XLSX et la frontière canonique doivent être validées avant implémentation. Aucun SQL, statut, `bulk_upsert_heats` ou comportement destructif n'a été changé. P2.5.7 reste bloqué.

# A — Procédure actuelle

## Deux implémentations concurrentes

### Chemin principal : `ParticipantsStructure` / `ImportParticipants`

Le chemin actuellement le plus complet est :

```text
Google Sheets public ou fichier CSV local
  -> texte CSV
  -> utils/csv.parseCSVParticipants
  -> ParsedParticipant[]
  -> ParticipantsStructure.handleImport
  -> participantRepository.upsertMany
  -> Supabase
  -> sélection catégorie/format
  -> computeHeats
  -> preview
  -> HeatPlanningRepository.createWithEntries
```

Google Sheets est transformé en URL publique :

```text
https://docs.google.com/spreadsheets/d/{sheetId}/export?format=csv&gid={gid}
```

Le navigateur effectue ensuite un `fetch`. Ce mode exige Internet et une feuille accessible publiquement. Le `gid` présent dans l'URL choisit l'onglet ; sans `gid`, l'onglet `0` est utilisé. Aucun nom d'onglet n'est imposé.

Le fichier CSV local utilise `File.text()` et ne déclenche aucun accès réseau pour le parsing.

Point important : après parsing, `handleParsed` appelle immédiatement `onImport`, puis `ParticipantsStructure.handleImport` exécute `participantRepository.upsertMany`. Il n'existe donc aujourd'hui aucune preview/validation opérateur complètement séparée de l'écriture participants.

### Chemin legacy : `ParticipantsPage`

Une deuxième implémentation possède son propre parseur CSV et une autre URL Google :

```text
https://docs.google.com/spreadsheets/d/{sheetId}/gviz/tq?tqx=out:csv
```

Elle persiste les participants dans `localStorage`, puis navigue vers `/generate-heats`.

Ce parseur est permissif et introduit silencieusement des valeurs par défaut :

- seed manquant/invalide : numéro de ligne ;
- nom sans colonne reconnue : `Surfeur N` ;
- pays absent : `SENEGAL` ;
- catégorie absente : `OPEN` ;
- licence absente : chaîne vide.

Ces comportements divergent du parseur principal et ne doivent pas devenir les règles du contrat canonique sans décision explicite.

## Colonnes réellement utilisées

### Parseur principal

| Champ canonique actuel | Obligatoire | Alias reconnus |
|---|---:|---|
| `seed` | oui | `seed`, `classement`, `ranking` |
| `name` | oui | `name`, `surfer`, `athlete`, `nom` |
| `category` | oui | `category`, `division`, `categorie` |
| `country` | non | `country`, `nation`, `club`, `pays/club`, `pays` |
| `license` | non | `license`, `licence`, `identifiant`, `id` |

Les en-têtes sont seulement passés en minuscules et trimés. Les accents ne sont pas supprimés : `Catégorie` ne correspond donc pas à l'alias `categorie`, contrairement au parseur legacy qui retire les diacritiques.

Règles actuelles du parseur principal :

- seed entier strictement positif ;
- nom et catégorie non vides ;
- unicité du seed par libellé de catégorie exact et sensible à la casse ;
- ligne invalide exclue de `rows` et ajoutée à `errors` ;
- lignes vides ignorées silencieusement par Papa Parse ;
- tri final global par seed, sans second critère catégorie ;
- aucun contrôle de participant dupliqué par nom/licence ;
- aucune liste de catégories autorisées ;
- aucune détection explicite des colonnes obligatoires avant analyse ligne par ligne.

### Parseur legacy

Alias supplémentaires :

- seed : `tete`, `rank` ;
- nom : `surfeur` ;
- pays : `team`.

Il ne détecte ni seed dupliqué ni colonne obligatoire manquante et fabrique les valeurs par défaut décrites plus haut.

## Participants, catégories, seeds, heats et couleurs

- Les catégories/divisions proviennent directement de chaque ligne importée.
- Les participants sont upsertés sur l'identité `(event_id, category, seed)`.
- La preview sélectionne les participants d'une catégorie, puis appelle `computeHeats` avec format, taille préférée, variante et options hybrides.
- La distribution utilise les règles bracket/seeding existantes ; l'import ne fournit pas lui-même les heats.
- `createHeatsWithEntries` génère `color_order` via `getColorSet` selon la taille du heat.
- Le tableur actuel ne fournit pas les couleurs de lycra ; elles ne doivent donc pas devenir une colonne obligatoire.
- Nom, pays/club et licence servent à l'identité/affichage participant, distincte de l'identité sportive par lycra.

# B — Contrat canonique proposé

```ts
export type PlanningImportSource =
  | 'xlsx'
  | 'csv'
  | 'google_sheets'
  | 'manual';

export interface PlanningImportParticipant {
  category: string;
  seed: number;
  name: string;
  country: string | null;
  license: string | null;
  sourceRow: number;
}

export interface CanonicalPlanningInput {
  eventId: string;
  participants: readonly PlanningImportParticipant[];
  source: PlanningImportSource;
  sourceName: string | null;
}

export type PlanningImportSeverity = 'warning' | 'error';

export interface PlanningImportDiagnostic {
  severity: PlanningImportSeverity;
  code: string;
  message: string;
  row: number | null;
  column: string | null;
}

export interface PlanningImportParseResult {
  validRows: readonly PlanningImportParticipant[];
  warnings: readonly PlanningImportDiagnostic[];
  errors: readonly PlanningImportDiagnostic[];
  input: CanonicalPlanningInput | null;
}
```

`sourceRow` est recommandé pour rendre chaque erreur actionnable. `input` reste `null` lorsqu'une erreur bloquante existe. Le type doit vivre dans un module de domaine pur, par exemple `domain/planningImport/contracts.ts`, sans import Excel, Papa Parse, Supabase, repository, React ou navigateur.

L'event ID reste une chaîne dans le contrat d'entrée, puis fait l'objet d'une validation explicite avant le preflight/repository. Cela évite qu'un parseur de fichier connaisse le type SQL de l'événement.

## Séparation des couches

```text
domain/planningImport/contracts.ts
domain/planningImport/normalizeRows.ts
domain/planningImport/validate.ts

adapters/planningImport/csvParser.ts       -> Papa Parse local
adapters/planningImport/xlsxParser.ts      -> librairie XLSX locale
adapters/planningImport/googleSheets.ts    -> fetch online optionnel

application/planningImport/buildPreview.ts -> computeHeats existant
application/planningImport/preflight.ts    -> future safety contract

UI ImportPlanningPage                      -> orchestration uniquement
repositories/HeatPlanningRepository        -> persistance finale uniquement
```

Le parseur XLSX et le parseur CSV doivent d'abord produire une matrice neutre de cellules/en-têtes, puis utiliser exactement la même normalisation et validation. C'est ce partage qui garantit un `CanonicalPlanningInput` identique pour des fichiers équivalents.

# C — Lecture XLSX hors ligne

## Contraintes d'exécution

Le navigateur peut lire un `File` local avec `file.arrayBuffer()` ou `FileReader`, puis parser cet `ArrayBuffer` sans upload. SheetJS documente explicitement ce mode de lecture locale en navigateur. Aucun chemin, API Google ou serveur n'est requis. [Documentation SheetJS — Local File Access](https://docs.sheetjs.com/docs/demos/local/file/)

La dépendance doit être installée lors de la construction du frontend et incorporée aux assets Vite. Aucun `<script src>` CDN n'est acceptable. Si le parseur est chargé dynamiquement, son chunk doit être inclus dans le precache Workbox et contrôlé par l'audit P1 ; sinon un premier import effectué hors ligne pourrait échouer.

Le parsing peut être déplacé dans un Web Worker pour éviter de bloquer l'UI sur de gros fichiers. Pour les listes de participants usuelles, un parsing direct est probablement suffisant, mais une limite de taille et de lignes doit être appliquée avant parsing.

## Comparaison des librairies

Mesures du registre npm au 6 août 2026 :

| Librairie | Version npm observée | Licence | Taille npm décompressée | Analyse |
|---|---:|---|---:|---|
| `xlsx` | 0.18.5 | Apache-2.0 | ~7,5 MB / 26 fichiers | Très mature et riche, lecture `ArrayBuffer`; le paquet npm est toutefois plus ancien que la CE 0.20.3 documentée par SheetJS |
| `exceljs` | 4.4.0 | MIT | ~21,8 MB / 519 fichiers | Lecture/écriture/styles très complète, surdimensionnée pour cinq colonnes et impact bundle probable élevé |
| `read-excel-file` | 9.3.5 | MIT | ~2,68 MB / 309 fichiers | Ciblée sur la lecture XLSX, API navigateur/worker, meilleure adéquation au besoin simple |

SheetJS CE est sous Apache 2.0 avec attribution requise. [Licence officielle SheetJS CE](https://docs.sheetjs.com/docs/miscellany/license/)

`read-excel-file` expose une entrée navigateur et indique utiliser un Web Worker pour les lectures XLSX récentes ; il est sous licence MIT. [Documentation npm `read-excel-file`](https://www.npmjs.com/package/read-excel-file?activeTab=readme%2F1000)

ExcelJS publie des bundles navigateur mais apporte des fonctions de modification, styles et écriture inutiles ici. [Dépôt officiel ExcelJS](https://github.com/exceljs/exceljs)

Les tailles npm décompressées ne sont pas des tailles de chunk gzip. La décision finale exige un prototype sur une branche dédiée avec mesure comparative :

```text
build actuel
vs build + import statique
vs build + import dynamique précaché
```

## Recommandation

Évaluer d'abord `read-excel-file` dans un prototype non branché au workflow production : périmètre lecture uniquement, licence MIT, package nettement plus petit. Garder SheetJS CE comme alternative si les exports Google Sheets réels révèlent des constructions XLSX non correctement lues.

Ne pas utiliser la version CDN SheetJS : elle introduirait une dépendance Internet terrain et contournerait le verrouillage reproductible du package manager.

Avant adoption :

- vérifier le lockfile, la licence et les dépendances transitives ;
- générer les fixtures avec Excel, LibreOffice et Google Sheets ;
- mesurer le chunk gzip réel ;
- vérifier Safari/Chromium des tablettes réellement utilisées ;
- confirmer le precache PWA et l'audit réseau P1 ;
- fixer une version exacte ou une plage maîtrisée selon la politique du dépôt.

# D — Template proposé

## Format opérateur minimal

Nom d'onglet recommandé : `Participants`.

| CATEGORY | SEED | NAME | COUNTRY | LICENSE |
|---|---:|---|---|---|
| OPEN MEN | 1 | Surfer A | SEN | 12345 |
| OPEN MEN | 2 | Surfer B | SEN | 23456 |
| OPEN WOMEN | 1 | Surfer C | SEN | |

Obligatoires : `CATEGORY`, `SEED`, `NAME`.

Optionnelles : `COUNTRY`, `LICENSE`.

Le template ne contient ni heat, round, couleur, juge ni score. Les heats et couleurs restent produits par le moteur de bracket existant.

Règle d'onglet proposée :

1. rechercher `Participants` sans sensibilité à la casse/accents ;
2. pour compatibilité, accepter l'onglet explicitement choisi par l'opérateur ;
3. à défaut, proposer le premier onglet avec avertissement et demander confirmation ;
4. ne jamais fusionner silencieusement plusieurs onglets.

## Compatibilité avec les fichiers actuels

Les alias du parseur principal doivent être conservés et complétés par ceux du parseur legacy :

- `SEED`, `CLASSEMENT`, `RANKING`, `RANK`, `TETE`, `TÊTE` ;
- `NAME`, `NOM`, `SURFER`, `SURFEUR`, `ATHLETE`, `ATHLÈTE` ;
- `CATEGORY`, `CATEGORIE`, `CATÉGORIE`, `DIVISION` ;
- `COUNTRY`, `PAYS`, `NATION`, `CLUB`, `TEAM`, `PAYS/CLUB` ;
- `LICENSE`, `LICENCE`, `IDENTIFIANT`, `ID`.

La normalisation doit retirer BOM, espaces, casse, accents et ponctuation périphérique avant résolution des alias.

Les anciens fichiers Google sont compatibles s'ils exportent un tableau à une ligne d'en-tête avec ces colonnes. Les formats multi-lignes, titres avant l'en-tête, cellules fusionnées ou plusieurs catégories réparties sur plusieurs onglets nécessitent des fixtures réelles avant promesse de compatibilité.

Priorité d'implémentation : collecter et anonymiser plusieurs fichiers réellement utilisés aujourd'hui, puis écrire les tests avant le parseur XLSX.

# E — Validation avant toute écriture

## Erreurs bloquantes proposées

| Code | Condition |
|---|---|
| `EMPTY_FILE` | fichier nul ou sans octets exploitables |
| `WORKSHEET_MISSING` | onglet demandé absent et aucun fallback confirmé |
| `HEADER_MISSING` | ligne d'en-tête absente |
| `REQUIRED_COLUMN_MISSING` | `category`, `seed` ou `name` absent |
| `EMPTY_CATEGORY` | catégorie vide |
| `EMPTY_SEED` | seed absent |
| `INVALID_SEED` | seed non entier ou <= 0 |
| `DUPLICATE_SEED` | même seed dans une catégorie normalisée |
| `EMPTY_NAME` | nom vide |
| `DUPLICATE_PARTICIPANT` | même licence non vide, ou même nom normalisé dans une catégorie selon règle à valider |
| `INVALID_ROW` | structure/type de ligne inexploitable |
| `UNKNOWN_CATEGORY` | seulement si l'événement possède une liste fermée de catégories |
| `LIMIT_EXCEEDED` | taille fichier, nombre d'onglets ou lignes au-dessus des limites |

## Warnings proposés

- ligne totalement vide ignorée avec numéro de ligne ;
- pays ou licence absent ;
- seeds valides mais désordonnés ;
- trou dans la séquence des seeds ;
- catégorie dont la casse/orthographe a été normalisée ;
- onglet fallback différent de `Participants` ;
- colonne inconnue ignorée ;
- doublon de nom entre catégories distinctes ;
- formule présente : valeur calculée utilisée, avec avertissement si le cache de résultat manque ;
- lignes valides présentes malgré d'autres lignes invalides, mais aucune confirmation autorisée tant qu'une erreur bloquante subsiste.

Les catégories devraient être trimées et comparées avec une clé normalisée, tout en conservant un libellé d'affichage déterministe. La règle de doublon participant doit être arbitrée : licence unique globalement lorsqu'elle existe, puis nom normalisé par catégorie en absence de licence est une proposition prudente.

## Invariant de non-écriture

Les modules de parsing/validation ne doivent importer aucun repository, client Supabase, hook, store ou React. Un test architectural doit échouer si `supabase`, `repositories`, `.from(`, `.rpc(` ou `fetch(` apparaît dans ces modules. L'adaptateur Google online est la seule exception pour `fetch`, isolée dans un fichier distinct et exclue du build terrain ou désactivée par la politique réseau P1.

# F — Preview opérateur

Écran proposé : « Importer participants / heats ».

États :

1. choix du fichier local ;
2. parsing local, sans persistance ;
3. résumé : source, onglet, lignes lues/valides/rejetées ;
4. tableau par catégorie avec participants, seeds, pays/licences ;
5. panneaux distincts erreurs et warnings ;
6. choix du format bracket par catégorie ;
7. appel du `computeHeats` existant en mémoire ;
8. rendu par le composant `BracketPreview` existant ;
9. preflight planning ;
10. confirmation seulement si validation et preflight sont verts.

Le bouton de persistance doit rester absent ou désactivé quand :

- une erreur de parsing existe ;
- event ID n'est pas résolu ;
- une catégorie n'a pas de format choisi ;
- le preflight est inconnu, en erreur réseau ou bloquant ;
- un heat sportif existant serait remplacé.

Le preview appelle la même fonction `computeHeats`; aucune copie de snake seeding, byes, repêchage, rounds hybrides ou couleurs ne doit être introduite dans l'import.

# G — Intégration avec la sécurité planning

Contrat futur minimal :

```ts
interface PlanningSafetyPreflightRequest {
  eventId: number;
  category: string;
  proposedHeatIds: readonly string[];
  overwrite: boolean;
}

interface PlanningSafetyBlocker {
  heatId: string;
  status: string;
  scores: number;
  overrides: number;
  interferences: number;
  judgeAssignments: number;
  timers: number;
  historyRows: number;
  isActive: boolean;
}

interface PlanningSafetyPreflightResult {
  safe: boolean;
  blockers: readonly PlanningSafetyBlocker[];
  checkedAt: string;
}
```

Le preflight doit devenir une garantie serveur atomique lors du futur correctif, pas seulement une lecture UI susceptible de devenir obsolète. Le tableur ne change aucun droit : il prépare une proposition, puis emprunte exactement la même frontière de sûreté que le planning manuel.

Règle recommandée : tout score, override, interférence, timer démarré, historique, assignment, statut `running/paused/finished/closed` ou pointeur actif bloque le remplacement. Une action de réparation exceptionnelle doit vivre hors de l'import standard, avec audit et autorisation séparés.

# H — Google Sheets optionnel

Deux adaptateurs peuvent converger vers la même matrice neutre :

```text
ONLINE (hors mode terrain)
Google Sheets public -> CSV fetch -> canonical normalizer

OFFLINE (mode terrain)
export Google Sheets .xlsx/.csv -> File local -> canonical normalizer
```

Le mode online ne doit pas être le tab par défaut en mode terrain. Il doit afficher explicitement « Internet requis » et être désactivable au build/config terrain. Aucun OAuth, Apps Script ou Google API n'est proposé dans ce lot.

Le mode offline ne doit exécuter ni `fetch`, ni upload, ni requête Supabase avant confirmation finale. Le fichier reste en mémoire navigateur et n'est pas enregistré dans IndexedDB/localStorage par défaut, afin d'éviter de conserver des données personnelles sans décision explicite.

# I — Tests et prototype proposés

## Fixtures

Créer sous `frontend/src/domain/planningImport/__fixtures__/` des paires CSV/XLSX représentant :

1. nominal simple ;
2. plusieurs catégories ;
3. seeds ordonnés ;
4. seeds désordonnés ;
5. seed dupliqué dans une catégorie ;
6. colonne obligatoire absente ;
7. ligne vide ;
8. caractères accentués ;
9. pays/licence optionnels ;
10. export réel Google Sheets en XLSX anonymisé ;
11. CSV et XLSX strictement équivalents.

Tests obligatoires :

- mêmes `validRows`, warnings et errors pour CSV/XLSX équivalents ;
- ordre canonique catégorie puis seed déterministe ;
- aucune écriture Supabase ;
- aucun appel réseau, avec `fetch` remplacé par un mock qui fait échouer le test ;
- parsing avec `navigator.onLine=false` ;
- aucune génération de heat avant validation complète ;
- aucune persistance avant preflight sûr et confirmation ;
- fichiers trop grands refusés avant parsing lourd ;
- export Google Sheets réel conserve accents et valeurs optionnelles.

## Prototype non créé dans ce sous-lot

Un prototype XLSX n'a pas été ajouté car aucune librairie XLSX n'est installée et la demande interdit son ajout avant validation en cas d'impact bundle/licence. Ajouter un faux parseur XLSX ou une fixture illisible sans dépendance ne fournirait aucune preuve utile.

Le premier prototype approuvé devra rester non branché au workflow production et mesurer :

- chunk JS brut/gzip ;
- precache PWA ;
- parsing offline ;
- temps/mémoire sur un fichier représentatif ;
- parité exacte CSV/XLSX ;
- absence de réseau/Supabase.

# J — Modifications nécessaires et estimation

## Lots proposés

| Lot | Contenu | Estimation indicative |
|---|---|---:|
| H1 | Collecte/anonymisation des fichiers réels, contrat canonique, décisions doublons/catégories | 0,5–1 jour |
| H2 | Normaliseur/validateur pur et refonte du parseur CSV derrière ce contrat | 1–1,5 jour |
| H3 | Spike `read-excel-file` vs SheetJS, fixtures XLSX, mesure bundle/PWA/tablettes | 1–1,5 jour |
| H4 | Adaptateur XLSX local et tests de parité/offline | 1–1,5 jour |
| H5 | UI preview sans écriture, réutilisation `computeHeats`/`BracketPreview` | 1,5–2 jours |
| H6 | Intégration au preflight planning sûr et confirmation | 1–2 jours après arbitrage P2.5.6g |
| H7 | Tests E2E terrain, build/audit P1, documentation opérateur/template | 1 jour |

Total indicatif : **7–10 jours de développement/validation**, dont H6 reste bloqué par la correction de sécurité planning. L'import/preview local H1–H5 peut être préparé indépendamment tant qu'aucune persistance n'est possible.

## Risques

- fichiers historiques non encore collectés : compatibilité réelle non démontrée ;
- divergence des deux parseurs CSV actuels ;
- parsing XLSX lourd sur tablettes anciennes ;
- chunk dynamique non précaché ;
- formules sans valeur calculée dans certains exports ;
- ambiguïté catégorie/casse/accents ;
- traitement des licences numériques avec zéros initiaux par Excel ; elles doivent être lues comme texte ou formatées explicitement ;
- exposition de données personnelles si le fichier est persisté localement ;
- faux sentiment de sûreté si le preflight reste seulement côté UI ;
- planning toujours `STATUS_DIVERGENT` et `PLANNING_DESTRUCTIVE` tant que P2.5.6g n'est pas corrigé.

## Critères d'entrée avant implémentation

1. validation de `CanonicalPlanningInput` et de la règle de doublon ;
2. fourniture de fichiers Google Sheets/Excel réels anonymisés ;
3. choix de librairie après mesure de bundle ;
4. décision sur la normalisation des catégories ;
5. maintien du bouton de persistance désactivé jusqu'au preflight sûr ;
6. arbitrage séparé des statuts et de la destructivité avant toute écriture finale.

## État final du sous-lot

- Architecture offline proposée : oui.
- Procédure actuelle inventoriée : oui.
- Format canonique et template proposés : oui.
- Librairie non ajoutée avant validation : oui.
- Écriture base depuis import : aucune modification ; le comportement production existant reste inchangé.
- SQL/status/bulk/destructivité : inchangés.
- P2.5.7 : non commencé.
