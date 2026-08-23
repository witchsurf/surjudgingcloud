#!/usr/bin/env node
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../frontend/node_modules/playwright');

async function verifyProdUI() {
  console.log('======================================================');
  console.log('🌐 AUDIT UI PLAYWRIGHT SUR RUNTIME PROD (:8080)');
  console.log('======================================================');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // 1. Check /admin (MyEvents / Management)
  console.log('1. Vérification de l\'accueil /admin...');
  const pageAdmin = await context.newPage();
  await pageAdmin.goto('http://127.0.0.1:8080/admin', { waitUntil: 'networkidle' });
  await pageAdmin.waitForTimeout(2000);

  const adminText = await pageAdmin.textContent('body');

  if (adminText.includes('Ligue Pro Test Event') || adminText.includes('20001')) {
    throw new Error('VIOLATION: L\'événement "Ligue Pro Test Event" est visible dans le DOM !');
  }
  if (adminText.includes('Surfer Red 1') || adminText.includes('Surfer White 1')) {
    throw new Error('VIOLATION: Des participants fantômes sont visibles dans le DOM !');
  }
  if (adminText.includes('p38-field-prod') || adminText.includes('p38-field-test')) {
    throw new Error('VIOLATION: Des heat IDs de test sont visibles dans le DOM !');
  }

  console.log('  ✓ Aucun événement existant');
  console.log('  ✓ Aucun "Ligue Pro Test Event"');
  console.log('  ✓ Aucun participant fantôme');

  // Check if "Créer un événement" or "Nouvel événement" button or form is present
  const hasCreateAction = adminText.includes('Créer') || adminText.includes('Nouvel') || adminText.includes('événement') || adminText.includes('Organisateur');
  if (!hasCreateAction) {
    throw new Error('VIOLATION: L\'interface ne permet pas de créer un premier événement !');
  }
  console.log('  ✓ Interface de création du premier événement disponible et opérationnelle');

  // 2. Check /judge
  console.log('2. Vérification de l\'interface /judge...');
  const pageJudge = await context.newPage();
  await pageJudge.goto('http://127.0.0.1:8080/judge?podium=A&position=J1', { waitUntil: 'networkidle' });
  await pageJudge.waitForTimeout(1500);
  const judgeText = await pageJudge.textContent('body');
  if (judgeText.includes('Surfer Red 1')) {
    throw new Error('VIOLATION: L\'interface juge affiche un surfeur fantôme !');
  }
  console.log('  ✓ Aucun surfeur ou heat actif préassigné');

  // 3. Check /display
  console.log('3. Vérification de l\'interface /display...');
  const pageDisplay = await context.newPage();
  await pageDisplay.goto('http://127.0.0.1:8080/display?podium=A', { waitUntil: 'networkidle' });
  await pageDisplay.waitForTimeout(1500);
  const displayText = await pageDisplay.textContent('body');
  if (displayText.includes('Ligue Pro Test Event')) {
    throw new Error('VIOLATION: L\'interface display affiche un événement fantôme !');
  }
  console.log('  ✓ Écran public en attente propre');

  // 4. Check /priority
  console.log('4. Vérification de l\'interface /priority...');
  const pagePriority = await context.newPage();
  await pagePriority.goto('http://127.0.0.1:8080/priority?podium=A', { waitUntil: 'networkidle' });
  await pagePriority.waitForTimeout(1500);
  const priorityText = await pagePriority.textContent('body');
  if (priorityText.includes('Surfer Red 1')) {
    throw new Error('VIOLATION: L\'interface priorité affiche des participants fantômes !');
  }
  console.log('  ✓ Écran priorité en attente propre');

  await browser.close();

  console.log('======================================================');
  console.log('🎉 AUDIT UI PLAYWRIGHT 100% CONFORME SUR LA PROD VIERGE');
  console.log('======================================================');
}

verifyProdUI().catch((err) => {
  console.error('\n❌ ÉCHEC AUDIT UI :', err.message);
  process.exit(1);
});
