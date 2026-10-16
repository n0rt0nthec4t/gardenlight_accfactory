// Validate PWM channel ownership, serial generation and durable configuration writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfiguration, crc32 } from '../dist/index.js';

const example = () => ({ gardenLight: { zones: [{ pin: 12 }, { pin: 13 }] } });

function configurationFile(t, config = example()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gardenlight-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'config.json');
  fs.writeFileSync(filename, JSON.stringify(config), { mode: 0o600 });
  return filename;
}

test('legacy v0.3 identity and GPIO pin list can be transferred into configuration', (t) => {
  const filename = configurationFile(t, {
    gardenLight: { GPIO_LightPins: [12, 13], mac_address: 'aa:bb:cc:dd:ee:ff', serial_number: '12345' },
  });
  const config = loadConfiguration(filename);
  assert.equal(config.gardenLight.hkUsername, 'aa:bb:cc:dd:ee:ff');
  assert.equal(config.gardenLight.serialNumber, '12345');
  assert.deepEqual(config.gardenLight.zones, [
    { pin: 12, name: 'Light 1', enabled: true },
    { pin: 13, name: 'Light 2', enabled: true },
  ]);
});

test('shared PWM channels and invalid zone pins are rejected without replacing the file', (t) => {
  const filename = configurationFile(t);
  const invalid = [[12, 18], [13, 19], [12, 12], [4]];
  for (const pins of invalid) {
    const original = JSON.stringify({ gardenLight: { zones: pins.map((pin) => ({ pin })) } });
    fs.writeFileSync(filename, original);
    assert.throws(() => loadConfiguration(filename));
    assert.equal(fs.readFileSync(filename, 'utf8'), original);
  }
});

test('options use garage door defaults and accept numeric configuration strings', (t) => {
  const filename = configurationFile(t, { ...example(), options: { webUIPort: 65536, hkPairingCode: 'invalid' } });
  let config = loadConfiguration(filename);
  assert.equal(config.options.webUIPort, 0);
  assert.equal(config.options.hkPairingCode, '031-45-154');
  assert.equal(config.options.eveHistory, false);
  fs.writeFileSync(filename, JSON.stringify({ gardenLight: { zones: [{ pin: '12' }] }, options: { webUIPort: '8581', eveHistory: true } }));
  config = loadConfiguration(filename);
  assert.equal(config.options.webUIPort, 8581);
  assert.equal(config.gardenLight.zones[0].pin, 12);
  assert.equal(config.options.eveHistory, true);
});

test('identities persist across reloads and invalid JSON is left intact', (t) => {
  const filename = configurationFile(t);
  const first = loadConfiguration(filename);
  assert.match(first.gardenLight.serialNumber, /^\d+$/);
  assert.deepEqual(loadConfiguration(filename), first);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const invalid = '{invalid json';
  fs.writeFileSync(filename, invalid);
  assert.throws(() => loadConfiguration(filename));
  assert.equal(fs.readFileSync(filename, 'utf8'), invalid);
});

test('web UI ports must be integers within the supported range', (t) => {
  const filename = configurationFile(t);
  for (const [port, expected] of [
    [8581.5, 0],
    ['8581.5', 0],
    [0, 0],
    [-1, 0],
    [65536, 0],
    ['8581', 8581],
    [65535, 65535],
  ]) {
    fs.writeFileSync(filename, JSON.stringify({ ...example(), options: { webUIPort: port } }));
    assert.equal(loadConfiguration(filename).options.webUIPort, expected);
    assert.equal(JSON.parse(fs.readFileSync(filename, 'utf8')).options.webUIPort, expected);
  }
});

test('failed atomic rename leaves the previous config and removes the temporary file', (t) => {
  const filename = configurationFile(t);
  const original = fs.readFileSync(filename, 'utf8');
  t.mock.method(fs, 'renameSync', () => {
    throw new Error('Rename failed');
  });
  assert.throws(() => loadConfiguration(filename), /Rename failed/);
  assert.equal(fs.readFileSync(filename, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(path.dirname(filename)), ['config.json']);
});

test('CRC32 matches the standard test vector and returns an unsigned value', () => {
  assert.equal(crc32('123456789'), 0xcbf43926);
  assert.equal(crc32(''), 0);
});

test('enabled is stored per zone and only enabled zones reserve PWM channels', (t) => {
  const filename = configurationFile(t, {
    gardenLight: { enabled: true },
    zones: [{ pin: 12 }, { pin: 18, enabled: false }, { pin: 13, enabled: false }],
  });
  const config = loadConfiguration(filename);
  assert.equal(Object.hasOwn(config.gardenLight, 'enabled'), false);
  assert.deepEqual(
    config.gardenLight.zones.map((zone) => zone.enabled),
    [true, false, false],
  );
  assert.deepEqual(loadConfiguration(filename), config);
  config.gardenLight.zones[1].enabled = true;
  fs.writeFileSync(filename, JSON.stringify(config));
  assert.throws(() => loadConfiguration(filename), /already assigned/);
});

test('nested zones can be added and removed without changing the accessory identity', (t) => {
  const filename = configurationFile(t, { gardenLight: { zones: [] } });
  let config = loadConfiguration(filename);
  const serial = config.gardenLight.serialNumber;
  assert.deepEqual(config.gardenLight.zones, []);
  config.gardenLight.zones.push({ name: 'Path Lights', pin: 12 });
  fs.writeFileSync(filename, JSON.stringify(config));
  config = loadConfiguration(filename);
  assert.deepEqual(config.gardenLight.zones, [{ name: 'Path Lights', pin: 12, enabled: true }]);
  config.gardenLight.zones.push({ name: 'Deck Lights', pin: 13 });
  fs.writeFileSync(filename, JSON.stringify(config));
  config = loadConfiguration(filename);
  assert.equal(config.gardenLight.zones.length, 2);
  config.gardenLight.zones.splice(0, 2);
  fs.writeFileSync(filename, JSON.stringify(config));
  config = loadConfiguration(filename);
  assert.deepEqual(config.gardenLight.zones, []);
  assert.equal(config.gardenLight.serialNumber, serial);
});
