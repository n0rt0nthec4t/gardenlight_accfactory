// Garden Light
// Part of gardenlight-accfactory
//
// Handles HomeKit Lightbulb integration using GPIO-connected
// hardware PWM outputs for independent garden light zones.
//
// Features:
// - Independent power and brightness controls for each zone
// - Only enabled zones create HomeKit services and open GPIO
// - Percentage brightness mapped to the full PWM range
// - HomeKit status synchronisation and Eve history support
// - GPIO cleanup on shutdown, removal and failed setup
//
// Lifecycle hooks used:
// - onAdd()
// - onSet()
// - onShutdown()
// - onRemove()
//
// Notes:
// - GPIO pins use BCM numbering
// - GPIO 12/18 share PWM channel 0; GPIO 13/19 share channel 1
// - Each zone requires an independent PWM channel
// - Zones start off; brightness changes while off keep the output off
// - Commands and shutdown share the HomeKitDevice lifecycle queue
//
// Code version 2026.10.11
// Mark Hulskamp
'use strict';

// Define external module requirements
import GPIO from 'rpio';

// Import our modules
import HomeKitDevice from './HomeKitDevice.js';

export default class GardenLight extends HomeKitDevice {
  static TYPE = 'GardenLight';
  static VERSION = '2026.10.11';
  static PWM_CHANNELS = new Map([
    [12, 0],
    [18, 0],
    [13, 1],
    [19, 1],
  ]);

  static PWM_RANGE = 1000;

  lightZones = [];
  #openedPins = new Set();

  async onAdd() {
    if (Array.isArray(this.deviceData.zones) !== true || this.deviceData.zones.length === 0) {
      throw new TypeError('At least one light zone is required');
    }
    // Disabled zones remain in configuration but never claim GPIO or HomeKit services.
    const enabledZones = this.deviceData.zones.filter((zone) => zone.enabled !== false);
    const channels = new Set();
    for (const zone of enabledZones) {
      const channel = GardenLight.PWM_CHANNELS.get(zone.pin);
      if (channel === undefined || channels.has(channel) === true) {
        throw new TypeError('Light zones must use distinct hardware PWM channels');
      }
      channels.add(channel);
    }

    // PWM uses /dev/mem rather than /dev/gpiomem. Initialise once before opening pins.
    GPIO.init({ gpiomem: false, mapping: 'gpio' });
    try {
      for (const [index, zone] of enabledZones.entries()) {
        GPIO.open(zone.pin, GPIO.PWM);
        this.#openedPins.add(zone.pin);
        GPIO.pwmSetClockDivider(2);
        GPIO.pwmSetRange(zone.pin, GardenLight.PWM_RANGE);
        GPIO.pwmSetData(zone.pin, 0);
        // Channel-based subtypes keep the remaining zone's HomeKit identity stable after removal.
        const subtype = GardenLight.PWM_CHANNELS.get(zone.pin) + 1;
        const service = this.addService(this.hap.Service.Lightbulb, zone.name, subtype, index === 0 ? {} : undefined);
        if (index === 0) {
          service.setPrimaryService();
        }
        const context = { ...zone, service, power: false, brightness: 100 };
        this.lightZones.push(context);
        this.addCharacteristic(service, this.hap.Characteristic.On, {
          initialValue: false,
          onGet: () => context.power,
          onSet: (power) => this.set({ pin: zone.pin, power }),
        });
        this.addCharacteristic(service, this.hap.Characteristic.Brightness, {
          initialValue: 100,
          props: { minValue: 0, maxValue: 100, minStep: 1 },
          onGet: () => context.brightness,
          onSet: (brightness) => this.set({ pin: zone.pin, brightness }),
        });
        this.postSetupDetail('Zone "%s" on GPIO %s', zone.name, zone.pin);
      }
    } catch (error) {
      // onAdd failures must release even a partially opened zone before publication.
      try {
        await this.onShutdown();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Light setup and GPIO cleanup failed');
      }
      throw error;
    }
  }

  // Apply a queued zone write; commit reported state only after GPIO succeeds.
  async onSet(message) {
    // Select the configured zone addressed by the characteristic handler's message.
    const zone = this.lightZones.find((item) => item.pin === message.pin);

    // HomeKit validates characteristic writes; omitted fields keep their current values.
    const power = message.power ?? zone.power;
    const brightness = message.brightness ?? zone.brightness;

    // Scale percentage brightness to the PWM range, keeping an off zone at zero.
    // A failed GPIO write leaves the stored and reported state unchanged.
    GPIO.pwmSetData(zone.pin, power === true ? Math.round((brightness * GardenLight.PWM_RANGE) / 100) : 0);

    // Commit the successful write and synchronise both HomeKit characteristics.
    const powerChanged = power !== zone.power;
    zone.power = power;
    zone.brightness = brightness;

    zone.service.updateCharacteristic(this.hap.Characteristic.On, power);
    zone.service.updateCharacteristic(this.hap.Characteristic.Brightness, brightness);

    // Light history records power transitions; brightness-only changes add no entry.
    if (powerChanged === true) {
      await this.history(zone.service, { status: power === true ? 1 : 0 });
    }
  }

  async onShutdown() {
    const errors = [];
    // Always attempt to return the pin to input mode, even when the PWM write fails.
    // Retain pins whose close failed so removal can retry their release.
    for (const pin of this.#openedPins) {
      try {
        GPIO.pwmSetData(pin, 0);
      } catch (error) {
        errors.push(error);
      }
      try {
        GPIO.close(pin);
        this.#openedPins.delete(pin);
        const zone = this.lightZones.find((item) => item.pin === pin);
        if (zone !== undefined) {
          zone.power = false;
          zone.service.updateCharacteristic(this.hap.Characteristic.On, false);
        }
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to release light GPIO outputs');
    }
  }

  async onRemove() {
    await this.onShutdown();
  }
}
