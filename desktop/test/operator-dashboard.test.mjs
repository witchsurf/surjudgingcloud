import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  competitionPresentation,
  diskPresentation,
  fieldHeadline,
  livePresentation,
  preparationText,
  quickAccessRoutes,
  translateServiceState,
} from '../src/shared/operator-dashboard.js';

test('operator landing keeps technical information behind an advanced disclosure', () => {
  const html = fs.readFileSync(path.resolve('src/renderer/index.html'), 'utf8');
  assert.match(html, /<details class="advanced-panel">/);
  assert.match(html, /Diagnostic avancé/);
  assert.match(html, /id="identity"/);
  assert.match(html, /id="technical-urls"/);
  assert.match(html, /<details class="hardware-test">/);
  assert.match(html, /Initialisation des accès locaux/);
  assert.doesNotMatch(html, /Field Control Center/);
});

test('quick access routes expose all six operator surfaces with friendly labels', () => {
  assert.deepEqual(quickAccessRoutes.map(({ key }) => key), ['admin', 'judge', 'priority', 'priorityDisplay', 'display', 'overlay']);
  assert.equal(quickAccessRoutes.find(({ key }) => key === 'priorityDisplay').label, 'Écran priorités');
});

test('healthy local essentials produce a clear ready headline', () => {
  assert.deepEqual(fieldHeadline({ host: '192.168.1.99' }, { frontend: 'HEALTHY', manifest: 'HEALTHY', api: 'HEALTHY' }), {
    title: 'Field prêt sur le réseau local',
    detail: 'Les interfaces opérateur sont disponibles à l’adresse 192.168.1.99.',
    tone: 'ok',
  });
});

test('an active Field with low disk remains usable without claiming full readiness', () => {
  const result = fieldHeadline({ host: '192.168.1.99' }, { frontend: 'HEALTHY', manifest: 'HEALTHY', api: 'HEALTHY' }, { diskOk: false });
  assert.equal(result.tone, 'warning');
  assert.match(result.title, /espace disque/);
});

test('missing Field stays fail-closed and does not claim readiness', () => {
  assert.equal(fieldHeadline(null, {}).tone, 'bad');
});

test('disk preparation reports actual free space while retaining 20 GB gate', () => {
  const copy = preparationText({ platform: 'darwin', arch: 'x64', hostVersion: '13.7.8', memoryOk: true, diskOk: false, availableDiskBytes: 10.8 * 1024 ** 3 });
  assert.equal(copy.tone, 'blocked');
  assert.match(copy.detail, /20 Go libres minimum requis/);
  assert.match(copy.detail, /10 Go sont disponibles/);
});

test('operator summaries remain human-readable and preserve safety states', () => {
  assert.deepEqual(competitionPresentation({ runningCount: 2 }), { text: '2 heats en cours · arrêt du Field protégé', badge: 'COMPÉTITION EN COURS', tone: 'warning' });
  assert.match(diskPresentation({ status: 'HEALTHY', available: 10 * 1024 ** 3 }), /libérez de l’espace/);
  assert.equal(livePresentation({ configured: false, state: 'NOT_PROVISIONED' }), 'Non configurée · le jugement reste entièrement local');
  assert.equal(translateServiceState('HEALTHY'), 'OPÉRATIONNEL');
});
