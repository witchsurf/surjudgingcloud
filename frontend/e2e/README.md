# E2E Testing Guide

## 📋 Overview

End-to-end tests using Playwright for critical user flows.

**Tests Created:**
- ✅ Judge Kiosk Login (3 tests)
- ✅ Score Submission (3 tests)

---

## 🚀 Running Tests

### Run All Tests
```bash
cd frontend
npm run test:e2e
```

### Interactive UI Mode
```bash
npm run test:e2e:ui
```

### Headed Mode (See Browser)
```bash
npm run test:e2e:headed
```

### Run Specific Test
```bash
npx playwright test judge-login
```

---

## 📁 Test Structure

```
frontend/
├── e2e/
│   ├── tests/
│   │   ├── judge-login.spec.ts       (3 tests)
│   │   └── score-submission.spec.ts   (3 tests)
│   └── pages/
│       └── JudgePage.ts              (Page Object Model)
├── playwright.config.ts
└── package.json (test scripts)
```

---

## ✅ Test Coverage

### Judge Login (judge-login.spec.ts)
1. **Kiosk mode login** - URL params → auto-load → login
2. **Invalid event** - Error handling for bad eventId
3. **Session persistence** - Login survives page refresh

### Score Submission (score-submission.spec.ts)
1. **Online submission** - Score saved to DB
2. **Rapid submissions** - Multiple scores quickly
3. **Score validation** - Reject scores > 10

---

## 🎯 Next Steps

### Tests to Add (Priority Order)

1. **Offline Mode** (~1h)
   - Submit score offline
   - Verify localStorage
   - Auto-sync when online

2. **Heat Progression** (~1h)
   - Close heat as admin
   - Advance to next heat
   - Verify DB updates

3. **Admin Controls** (~45min)
   - Create heats
   - Override scores
   - Manage event config

---

## 🔧 Tips

### Writing New Tests
```typescript
import { test, expect } from '@playwright/test';
import { JudgePage } from '../pages/JudgePage';

test('my new test', async ({ page }) => {
  const judgePage = new JudgePage(page);
  // ...
});
```

### Debugging
```bash
# Run with debug mode
npx playwright test --debug

# Generate test code
npx playwright codegen http://localhost:5173
```

### Screenshots
Tests automatically capture screenshots on failure in `test-results/`

---

## 📊 Current Status

| Test Suite | Tests | Status |
|------------|-------|--------|
| Judge Login | 3 | ✅ Created |
| Score Submission | 3 | ✅ Created |
| Offline Mode | 0 | ⏳ Todo |
| Heat Progression | 0 | ⏳ Todo |
| Admin Controls | 0 | ⏳ Todo |

**Total:** 6 tests created, ~6-8 more recommended

---

*Tests protect your architecture investment!* 🛡️
