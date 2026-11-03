import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { classifyPlayer, lookupCoordinate, summarize, findPlanets, coordinateOrder, csvCell } from '../site/core.js';

test('vacation and inactivity are mutually exclusive, with combined labels preserved', () => {
  assert.equal(classifyPlayer({ status: 'vI' }).group, 'vacation');
  assert.match(classifyPlayer({ status: 'vI' }).label, /28/);
  assert.equal(classifyPlayer({ status: 'vi' }).group, 'vacation');
  assert.equal(classifyPlayer({ status: 'I' }).group, 'inactive');
  assert.equal(classifyPlayer({ status: 'i' }).group, 'inactive');
  assert.equal(classifyPlayer({ status: '' }).group, 'active');
  assert.equal(classifyPlayer(undefined).group, 'unknown');
  assert.equal(classifyPlayer({ status: 'b' }).group, 'other');
  assert.equal(classifyPlayer({ status: 'z' }).group, 'other');
});

test('missing datasets, missing players and out-of-range coordinates never become free slots', () => {
  const snapshot = { galaxies: 4, systems: 499, players: {}, planets: { '1:73:8': { id: '7', player: '9', name: 'Colonie' } } };
  assert.equal(lookupCoordinate(null, '1:73:8').kind, 'unavailable');
  const missingPlayer = lookupCoordinate(snapshot, '1:73:8');
  assert.equal(missingPlayer.kind, 'occupied');
  assert.equal(missingPlayer.group, 'unknown');
  assert.equal(lookupCoordinate(snapshot, '5:73:8').kind, 'outside');
  assert.equal(lookupCoordinate(snapshot, '1:73:9').kind, 'free');
  const summary = summarize([missingPlayer, lookupCoordinate(null, '1:73:8'), lookupCoordinate(snapshot, '5:73:8')]);
  assert.equal(summary.occupied, 1); assert.equal(summary.unknown, 1); assert.equal(summary.free, 0);
  assert.equal(summary.unavailable, 1); assert.equal(summary.outside, 1);
});

test('planet coordinates sort numerically; player IDs do not match by nickname', () => {
  assert.deepEqual(['2:2:8', '1:100:8', '1:3:8'].sort(coordinateOrder), ['1:3:8', '1:100:8', '2:2:8']);
  const planets = { '1:100:8': { player: '1' }, '1:3:8': { player: '1' }, '2:2:8': { player: '2' } };
  assert.deepEqual(findPlanets({ planets }, 1).map(([c]) => c), ['1:3:8', '1:100:8']);
});

test('CSV quotes values and prevents formulas from public player names', () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell('=IMPORTXML("x")'), '"\'=IMPORTXML(""x"")"');
  assert.equal(csvCell('1:73:8'), '"1:73:8"');
});

test('published datasets agree with manifest identity, counts and API timestamps', async () => {
  const manifest = JSON.parse(await readFile(new URL('../site/data/manifest.json', import.meta.url)));
  assert.ok(manifest.universes.length > 0);
  assert.equal(new Set(manifest.universes.map(u => u.number)).size, manifest.universes.length);
  for (const u of manifest.universes.filter(u => u.state !== 'unavailable')) {
    const data = JSON.parse(await readFile(new URL(`../site/${u.file}`, import.meta.url)));
    assert.equal(data.number, u.number); assert.equal(data.name, u.name);
    assert.equal(Object.keys(data.players).length, u.playerCount);
    assert.equal(Object.keys(data.planets).length, u.planetCount);
    assert.deepEqual(data.timestamps, u.timestamps);
    assert.ok(!Object.values(data.planets).some(p => p.moon));
  }
});
