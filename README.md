<span align="center">

# HomeKit Garden Light System

[![version](https://img.shields.io/github/package-json/v/n0rt0nthec4t/gardenlight_accfactory)](https://img.shields.io/github/package-json/v/n0rt0nthec4t/gardenlight_accfactory)

</span>

## Parts

- Raspberry Pi supported by `rpio`
- MOSFET interfaces for PWM light control
- Dimmable garden lights

Use Node.js 22, 24 or 26. Hardware PWM requires access to `/dev/mem`, normally
through root permissions. GPIO pins use BCM numbering.

## Garden Light Configuration

The following options are available in the **gardenLight** object in
`gardenlight_config.json`. One HomeKit accessory contains the configured light zones.

For example:

```json
{
  "gardenLight": {
    "name": "Garden Light System",
    "manufacturer": "n0rt0nthec4t",
    "model": "HomeKit Garden Light System",
    "zones": [
      {
        "name": "Path Lights",
        "pin": 12,
        "enabled": true
      },
      {
        "name": "Garden Lights",
        "pin": 13,
        "enabled": true
      }
    ]
  }
}
```

| Name         | Description                                           | Default                     |
|--------------|-------------------------------------------------------|-----------------------------|
| hkUsername   | Automatically generated HomeKit username              | Generated on first startup  |
| manufacturer | Manufacturer of the garden light system               | n0rt0nthec4t                |
| model        | Model of the garden light system                      | HomeKit Garden Light System |
| name         | Name of the HomeKit accessory                         | Garden Light System         |
| serialNumber | Serial number of the garden light system              | Generated on first startup  |
| zones        | Array of configured light zones                       | Required                    |

The following options are available in each **gardenLight.zones** entry.

| Name    | Description                                  | Default           |
|---------|----------------------------------------------|-------------------|
| enabled | Enable this zone in HomeKit and GPIO setup   | true              |
| name    | Name of the light zone                       | Light 1, Light 2… |
| pin     | BCM hardware PWM pin: 12, 13, 18 or 19        | Required          |

GPIO 12 and 18 share PWM channel 0; GPIO 13 and 19 share channel 1. Enable at most
one zone per channel, for up to two independent light zones. Disabled zones retain
their configuration without creating HomeKit services or opening GPIO.
Configuration validation or save failures stop startup with an error. Generated
HomeKit identities are saved atomically before the accessory is published.

The Garden Lights page provides zone Add/Remove controls, names, PWM pin choices
and Enabled checkboxes. Add selects a free PWM channel, and pin choices exclude
channels assigned to other zone cards. With both channels assigned, remove a zone
before adding another. Accessory identity and manufacturer settings remain in the
JSON configuration. With no enabled zones, the Web UI remains available when its
port is configured, and no accessory is published.

Web UI saves and restores replace the configuration file; startup validates it
after restart. Saved changes take effect after restart. All zones start off with
brightness at 100%. Brightness changes while a zone is off keep its output off.
Outputs are switched off and closed on shutdown.

### Configuration Options

The following options are available in the **options** object in
`gardenlight_config.json`.

| Name             | Description                                             | Default    |
|------------------|---------------------------------------------------------|------------|
| debug            | Detailed debugging                                      | false      |
| eveHistory       | Provide power transition history in EveHome              | true       |
| hkPairingCode    | HomeKit pairing code: "xxx-xx-xxx" or "xxxx-xxxx"          | 031-45-154 |
| webUIPort        | Web UI port; 0 disables the Web UI                       | 0          |
| webUIBearerToken | Web UI password; an empty value disables authentication  | Empty      |

When an `options` object is present, set `eveHistory` explicitly to `true` to enable
history. Each zone retains its own power history; Eve displays the first enabled
zone's stream.

Web ports must be integers from 0 to 65535. Invalid port values disable the Web UI.
For example, `webUIPort: 8581` enables the UI at `http://<pi-address>:8581`.
The UI provides configuration, pairing, logs, backup and restore. Its restart action
exits with status 1 so a process manager configured to restart on failure can
relaunch the application.
