import test from 'node:test';
import assert from 'node:assert/strict';
import controller from '../src/main/priority-display-controller.cjs';

const { buildPriorityDisplayUrl, buildPriorityTestUrl, buildPriorityOrderTestUrl, selectPriorityOutputDisplay } = controller;

test('builds the read-only priority framebuffer URL for a podium', () => {
  assert.equal(buildPriorityDisplayUrl('192.168.1.99', { podiumId: 'b', eventId: 28 }), 'http://192.168.1.99:8080/priority-display?podium=B&eventId=28');
});

test('builds an isolated solid-color hardware test pattern', () => {
  const url = buildPriorityTestUrl('jaune');
  assert.match(url, /^data:text\/html,/);
  assert.match(decodeURIComponent(url), /background:#ffff00/);
  assert.match(decodeURIComponent(url), /data-priority-color="JAUNE"/);
});

test('rejects a hardware test color outside the approved lycra palette', () => {
  assert.throws(() => buildPriorityTestUrl('magenta'), /Couleur de test priorité invalide/);
});

test('builds left-to-right four and six color L2 mapping patterns', () => {
  const four = decodeURIComponent(buildPriorityOrderTestUrl(4));
  const six = decodeURIComponent(buildPriorityOrderTestUrl(6));
  assert.match(four, /data-priority-order="ROUGE,BLANC,JAUNE,BLEU"/);
  assert.match(six, /data-priority-order="ROUGE,BLANC,JAUNE,BLEU,VERT,NOIR"/);
  assert.equal((four.match(/flex:1 1 0/g) || []).length, 4);
  assert.equal((six.match(/flex:1 1 0/g) || []).length, 6);
});

test('prefers an explicitly external HDMI display even when it is primary', () => {
  const internal = { id: 1, internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 } };
  const l2 = { id: 2, internal: false, bounds: { x: 1440, y: 0, width: 1920, height: 1080 } };
  assert.equal(selectPriorityOutputDisplay([internal, l2], 2), l2);
});

test('fails closed when no second or external display exists', () => {
  const internal = { id: 1, internal: true, bounds: { x: 0, y: 0, width: 1440, height: 900 } };
  assert.equal(selectPriorityOutputDisplay([internal], 1), null);
});

test('uses the largest non-primary display when internal metadata is unavailable', () => {
  const primary = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } };
  const small = { id: 2, bounds: { x: 1440, y: 0, width: 800, height: 600 } };
  const l2 = { id: 3, bounds: { x: 2240, y: 0, width: 1920, height: 1080 } };
  assert.equal(selectPriorityOutputDisplay([primary, small, l2], 1), l2);
});
