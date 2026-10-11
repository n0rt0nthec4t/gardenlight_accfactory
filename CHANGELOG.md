# Changelog

## Unreleased

### Changed

- Modernized the v0.3 garden light controller using the HomeKitDevice,
  HomeKitHistory and HomeKitUI submodules and an ES module application entry point.
- Added JSON configuration and an optional shared web UI for configuration,
  pairing, logs, backup and restore.
- Simplified zone writes to trust configured GPIO assignments and use HomeKit characteristic validation for power and brightness.
- Aligned the application entry point with the garage door project's imports, constants, helpers, configuration checks, startup and shutdown layout.
- Matched garage door's `loadConfiguration()` section processing, option defaults and atomic persistence; generate decimal serial numbers with CRC32.
- Use HomeKitUI's built-in configuration save and restore, applying validation at the next startup.
- Keep zones under `gardenLight` and show zone Add/Remove cards on one Garden Lights page.
- Hide accessory name, manufacturer, model, HomeKit username and serial number from the GUI while retaining their configuration values.
- Accept existing top-level zone configurations on startup and keep the UI available when all zones are removed.
- Move Enabled to each zone; disabled zones retain configuration without reserving PWM channels or creating HomeKit services.

### Fixed

- Exit successfully on SIGINT or SIGTERM during startup, awaiting GPIO cleanup without reporting cancelled publication as a startup failure.
- Reject fractional web UI ports before startup.
- Allocate unused PWM channels for new GUI zones and restrict pin choices to available hardware PWM channels.
- Map brightness to the full PWM range and keep outputs off when adjusting an off zone.
- Reject zones sharing a hardware PWM channel and release GPIO on shutdown or failed setup.
- Keep the remaining zone's HomeKit service subtype stable when another zone is removed.
