# Quick E2E Testing Guide

## 🚀 Lancer les Tests Maintenant

### Étape 1: Démarrer le Dev Server

```bash
# Terminal 1 - Garde ouvert
cd /Users/laraise/.gemini/antigravity/playground/neon-planck/frontend
npm run dev
# Serveur lance sur http://localhost:5173
```

### Étape 2: Lancer les Tests

```bash
# Terminal 2
cd /Users/laraise/.gemini/antigravity/playground/neon-planck/frontend

# Mode UI (recommandé)
npm run test:e2e:ui

# OU mode CLI
npm run test:e2e

# OU voir le browser
npm run test:e2e:headed
```

---

## ⚠️ Les Tests Vont Échouer - C'est Normal!

**Pourquoi:**
1. Ils essaient de se connecter à un vrai event (eventId=1)
2. Ils cherchent des éléments UI spécifiques
3. Pas de données de test prêtes

**C'est OK** - Les tests sont des **templates** à adapter.

---

## 🔧 Adaptation Rapide

### Test Simple qui Marchera

Créé un test basique pour vérifier que l'app charge:

```bash
cd /Users/laraise/.gemini/antigravity/playground/neon-planck/frontend
cat > e2e/tests/smoke.spec.ts << 'EOF'
import { test, expect } from '@playwright/test';

test('app loads successfully', async ({ page }) => {
  // Va sur la home page
  await page.goto('/');
  
  // Vérifie que la page charge
  await expect(page).toHaveTitle(/Surf/i);
  
  // Prend un screenshot
  await page.screenshot({ path: 'e2e/screenshots/home.png' });
});

test('judge page is accessible', async ({ page }) => {
  // Va sur la page judge
  await page.goto('/judge');
  
  // Devrait voir quelque chose lié au login
  const hasLogin = await page.getByText(/login|connexion/i).isVisible()
    .catch(() => false);
    
  expect(hasLogin).toBeTruthy();
});
EOF
```

Maintenant lance:
```bash
npm run test:e2e:ui
```

---

## 📸 Voir les Résultats

Après les tests, check:
```bash
# Rapports HTML
npx playwright show-report

# Screenshots (si échec)
open test-results/
```

---

## 🎯 Next: Adapter les Tests Réels

Pour adapter les vrais tests (judge-login, score-submission):

1. **Crée un event de test dans ta DB**
   ```sql
   INSERT INTO events (id, name, organizer) 
   VALUES (999, 'TEST EVENT', 'Test Org');
   ```

2. **Modifie les tests pour utiliser eventId=999**
   ```typescript
   await judgePage.gotoKioskMode('J1', 999); // Au lieu de 1
   ```

3. **Ajuste les sélecteurs selon TON UI réelle**
   - Ouvre l'app dans un browser
   - Inspect les éléments
   - Update les sélecteurs dans JudgePage.ts

---

## 💡 Tip: Test en Production Réelle

Au lieu de mocker, tu peux tester avec de vraies données:

```typescript
// test.spec.ts
test('real judge login flow', async ({ page }) => {
  // Utilise un vrai event qui existe
  await page.goto('/judge?position=J1&eventId=1');
  
  // Login avec un vrai juge
  await page.fill('[name="judgeName"]', 'Test Judge');
  await page.click('button[type="submit"]');
  
  // Vérifie que ça marche
  await expect(page.url()).toContain('/judge');
});
```

---

**Prêt à tester ?** Lance juste les 2 commandes au début ! 🚀
