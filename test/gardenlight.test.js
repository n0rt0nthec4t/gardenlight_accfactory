// Exercise the real HomeKit lifecycle and characteristic handlers with GPIO mocked.
import assert from 'node:assert/strict';
import test from 'node:test';
import HAP from '@homebridge/hap-nodejs';
import GPIO from 'rpio';
import GardenLight from '../dist/gardenlight.js';
import HomeKitDevice from '../dist/HomeKitDevice.js';
import HomeKitHistory from '../dist/HomeKitHistory.js';

HomeKitDevice.PLUGIN_NAME = 'gardenlight-test';
HomeKitDevice.PLATFORM_NAME = 'GardenLightTest';
let identity = 0;

async function setup(
  t,
  {
    failRange = false,
    history = false,
    zones = [
      { pin: 12, name: 'Light 1' },
      { pin: 13, name: 'Light 2' },
    ],
  } = {},
) {
  const writes = [];
  const closes = [];
  const opens = [];
  const failurePins = new Set();
  t.mock.method(GPIO, 'init', () => {});
  t.mock.method(GPIO, 'open', (pin) => opens.push(pin));
  t.mock.method(GPIO, 'pwmSetClockDivider', () => {});
  t.mock.method(GPIO, 'pwmSetRange', (pin, range) => {
    assert.equal(range, 1000);
    if (failRange === true && pin === 13) {
      throw new Error('Range failed');
    }
  });
  t.mock.method(GPIO, 'pwmSetData', (pin, value) => {
    if (failurePins.has(pin) === true) {
      throw new Error('PWM failed');
    }
    writes.push([pin, value]);
  });
  t.mock.method(GPIO, 'close', (pin) => closes.push(pin));
  class Accessory extends HAP.Accessory {
    async publish() {}
    async unpublish() {}
  }
  HomeKitDevice.EVEHOME = HomeKitHistory;
  const light = new GardenLight(
    undefined,
    { ...HAP, Accessory },
    {
      serialNumber: 'light-' + ++identity,
      softwareVersion: 'test',
      manufacturer: 'Test',
      model: 'Test',
      description: 'Garden Lights',
      hkUsername: 'AA:BB:CC:DD:EE:FF',
      hkPairingCode: '031-45-154',
      eveHistory: history,
      zones,
    },
  );
  t.after(async () => {
    failurePins.clear();
    await light.remove();
  });
  const add = () => light.add({ hapAccessoryName: 'Garden Lights', hapCategory: HAP.Categories.LIGHTBULB, enableHistory: history });
  if (failRange !== true) {
    assert.equal(await add(), true);
  }
  return { light, writes, closes, opens, failurePins, add };
}

test('zones start off and map 0–100 brightness to the full PWM range', async (t) => {
  const { light, writes } = await setup(t);
  assert.deepEqual(writes, [
    [12, 0],
    [13, 0],
  ]);
  const zone = light.lightZones[0];
  await zone.service.getCharacteristic(HAP.Characteristic.Brightness).handleSetRequest(50);
  assert.deepEqual(writes.at(-1), [12, 0]);
  assert.equal(zone.power, false);
  await zone.service.getCharacteristic(HAP.Characteristic.On).handleSetRequest(true);
  assert.deepEqual(writes.at(-1), [12, 500]);
  await light.set({ pin: 12, brightness: 100 });
  assert.deepEqual(writes.at(-1), [12, 1000]);
  await light.set({ pin: 12, power: false });
  assert.deepEqual(writes.at(-1), [12, 0]);
  assert.equal(zone.brightness, 100);
  assert.equal(light.lightZones[1].power, false);
});

test('a remaining zone keeps its channel subtype when the first zone is removed', async (t) => {
  const { light } = await setup(t, { zones: [{ pin: 13, name: 'Light 2' }] });
  assert.equal(light.lightZones[0].service.subtype, 2);
  await light.set({ pin: 13, power: true });
  assert.equal(light.lightZones[0].power, true);
});

test('disabled zones never open GPIO or create services; history links to the first enabled zone', async (t) => {
  const { light, opens } = await setup(t, {
    history: true,
    zones: [
      { pin: 12, name: 'Path Lights', enabled: false },
      { pin: 13, name: 'Deck Lights', enabled: true },
    ],
  });
  assert.deepEqual(opens, [13]);
  assert.equal(light.lightZones.length, 1);
  assert.equal(light.accessory.getServiceById(HAP.Service.Lightbulb, 1), undefined);
  assert.equal(light.historyService.EveHome.sub, 2);
});

test('HomeKit validation and failed GPIO writes preserve the previous reported state', async (t) => {
  const { light, writes, failurePins } = await setup(t);
  const zone = light.lightZones[0];
  // A connection marks these as HomeKit client requests, enabling HAP's validation.
  const invalidValue = (error) => error === HAP.HAPStatus.INVALID_VALUE_IN_REQUEST;
  await assert.rejects(zone.service.getCharacteristic(HAP.Characteristic.Brightness).handleSetRequest(101, {}), invalidValue);
  await assert.rejects(zone.service.getCharacteristic(HAP.Characteristic.On).handleSetRequest('invalid', {}), invalidValue);
  assert.equal(writes.length, 2);
  failurePins.add(12);
  await assert.rejects(light.set({ pin: 12, power: true, brightness: 25 }), /PWM failed/);
  assert.equal(light.lightZones[0].power, false);
  assert.equal(light.lightZones[0].brightness, 100);
});

test('power transitions record separate zone history streams', async (t) => {
  const { light } = await setup(t, { history: true });
  await light.set({ pin: 12, power: true });
  await light.set({ pin: 13, power: true });
  await light.set({ pin: 12, power: false });
  assert.equal(light.historyService.lastHistory(light.lightZones[0].service).status, 0);
  assert.equal(light.historyService.lastHistory(light.lightZones[1].service).status, 1);
  assert.equal(light.historyService.EveHome.sub, 1);
});

test('shutdown releases every zone and ignores subsequent writes', async (t) => {
  const { light, writes, closes } = await setup(t);
  await light.set({ pin: 12, power: true });
  await light.shutdown();
  assert.deepEqual(writes.slice(-2), [
    [12, 0],
    [13, 0],
  ]);
  assert.deepEqual(closes, [12, 13]);
  const count = writes.length;
  await light.set({ pin: 12, power: true });
  assert.equal(writes.length, count);
});

test('partial setup failure releases pins opened before publication', async (t) => {
  const { add, opens, closes } = await setup(t, { failRange: true });
  await assert.rejects(add(), /Range failed/);
  assert.deepEqual(opens, [12, 13]);
  assert.deepEqual(closes, [12, 13]);
});

test('cleanup closes pins even when PWM writes fail and reports the failure', async (t) => {
  const { light, failurePins, closes } = await setup(t);
  failurePins.add(12);
  await assert.rejects(light.shutdown(), /Failed to release/);
  assert.deepEqual(closes, [12, 13]);
  failurePins.clear();
  await light.remove();
  assert.deepEqual(closes, [12, 13]);
});

test('a failed pin close does not prevent other cleanup and can be retried on removal', async (t) => {
  const { light, closes } = await setup(t);
  const close = GPIO.close;
  let fail = true;
  t.mock.method(GPIO, 'close', (pin) => {
    if (pin === 12 && fail === true) {
      throw new Error('Close failed');
    }
    close(pin);
  });
  await assert.rejects(light.shutdown(), /Failed to release/);
  assert.deepEqual(closes, [13]);
  fail = false;
  await light.remove();
  assert.deepEqual(closes, [13, 12]);
});
