# Plan d'implémentation : Refonte UI/UX SurfJudging

**Objectif :** Implémenter le nouveau Design System (couleurs, typographie, composants) et optimiser les interfaces clés (Landing, Admin, Mobile Judge).

**Architecture :** Nous allons configurer l'infrastructure UI globale dans `tailwind.config.js` (`primary`, `secondary`) et l'`index.css` global. Ensuite, nous mettrons à jour les 3 composants principaux (`LandingPage.tsx`, `AdminInterface.tsx` / `JudgePage.tsx` ou assimilés) de manière incrémentale, en remplaçant les emojis par les icônes `lucide-react`.

**Stack Technique :** React 18, Tailwind CSS, Lucide React (Icônes), Vite.

---

### Tâche 1 : Configuration et Centralisation du Design System

**Fichiers :**
- Modifier : `frontend/tailwind.config.js`
- Modifier : `frontend/src/index.css`

**Étape 1 : Mettre à jour la configuration Tailwind**
Ajouter des variables sémantiques dans `tailwind` pour `primary: '#DC2626'` (rouge sportif), `secondary: '#EF4444'`, `accent: '#FBBF24'` (or) et configurer la typographie `Barlow` et `Barlow Condensed`.

**Étape 2 : Ajouter les imports Google Fonts**
Dans `frontend/src/index.css`, importer la palette de polices Barlow et définir les styles `html { touch-action: manipulation; }` globaux.

**Étape 3 : Commit**
```bash
git add frontend/tailwind.config.js frontend/src/index.css
git commit -m "chore(ui): configuration globale tailwind et typographie barlow"
```

---

### Tâche 2 : Refonte de la Landing Page (Portail Sportif)

**Fichiers :**
- Modifier : `frontend/src/components/LandingPage.tsx`

**Étape 1 : Structuration de la section Hero**
Remplacer le fond statique par des sections propres, des dégradés avec le nouveau rouge de la marque. Appliquer la fonte `Barlow Condensed` (`font-condensed`) sur les titres (h1, h2).

**Étape 2 : Remplacement Emojis par Lucide SVG**
Remplacer `🏄` par l'icône `<Activity />` ou `<Trophy />` de `lucide-react`. 
Ajouter des micro-interactions sur les boutons (hover:scale-105 active:scale-95 duration-200).

**Étape 3 : Exécuter et vérifier**
Exécuter l'application pour vérifier l'apparence visuelle à `/`.

**Étape 4 : Commit**
```bash
git add frontend/src/components/LandingPage.tsx
git commit -m "feat(ui): refonte landing page avec design sportif"
```

---

### Tâche 3 : Optimisation Interface Juge Mobile (Tap Targets & Contraste)

**Fichiers :**
- Modifier : `frontend/src/components/JudgeInterface.tsx`

**Étape 1 : Optimiser les boutons de saisie de notation**
Modifier l'input de score (`w-16 px-2 py-1`) pour devenir un grand bouton/input (`min-h-[44px] min-w-[44px] px-4 py-3 text-lg`).

**Étape 2 : Accentuer le contraste des cellules**
Changer les bordures en `border-gray-900` pour qu'ils se détachent en extérieur, et utiliser des fonds marqués pour les vagues actives ou l'état de sélection (`bg-blue-100` -> `bg-primary/20 border-primary border-2`).

**Étape 3 : Vérification du Touch (Double Tap Delay)**
S'assurer que les boutons principaux, spécifiquement ceux avec `Edit3`, intègrent la classe `touch-manipulation` (ou sont couverts par le global CSS). 

**Étape 4 : Commit**
```bash
git add frontend/src/components/JudgeInterface.tsx
git commit -m "feat(ui): interface juge mobile robuste (tap targets 44px, contraste)"
```

---

### Tâche 4 : Dashboard Admin Organisateur (Cards & Bento Grid)

**Fichiers :**
- Identifier et Modifier le composant d'accueil/liste (`frontend/src/components/MyEvents.tsx` ou vue Admin)

**Étape 1 : Transformer la mise en page en Grille**
Si les données sont dans des tables complexes, utiliser une disposition `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`.

**Étape 2 : Styling des Cartes (Cards)**
Envelopper chaque élément/événement dans : `bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col`.

**Étape 3 : Remplacement Icônes/Emojis**
Remplacer les emojis ou vieilles icônes par des icônes constantes issues de Lucide (ex: listes de paramètres, config).

**Étape 4 : Commit**
```bash
git add frontend/src/components/MyEvents.tsx # ou composant associé
git commit -m "feat(ui): dashboard event en format bento cards"
```
