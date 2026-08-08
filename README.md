# signalk-bougerv-pc35

Signal K plugin to monitor and control a **BougeRV PC35 Pro** portable air
conditioner over Bluetooth LE — no Tuya cloud or device key required. It talks
the AC's native GATT protocol (reverse-engineered from the BougeRV app).

## What it does

- Connects to the AC over BLE (matches by advertised name prefix `PC35`, or a
  configured address), subscribes to status notifications, and republishes state
  under a configurable Signal K path (default `electrical.airConditioner.pc35`):
  - `.power` (bool), `.temperatureSet` (Kelvin), `.mode`, `.fanSpeed`,
    `.drainage`, `.lighting`, `.remainingTime` (s)
- Registers PUT handlers so Signal K (Node-RED, Skip buttons, automations) can
  control the unit:
  - `.power` — `true`/`false`
  - `.temperatureSet` — value in °C (16–31) or Kelvin (≥200)
  - `.mode` — `eco|cool|breeze|fan|dehumidify|strongcool|sleep|turbo|heat`
  - `.fanSpeed` — `low|med|high`

## Requirements

- A BLE adapter on the Signal K host (built-in on Raspberry Pi).
- Node needs raw BLE capability:
  `sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))`
- The AC allows only **one** BLE connection at a time — close the BougeRV phone
  app when this plugin is connected.

## Config

| Option | Default | Notes |
|--------|---------|-------|
| `basePath` | `electrical.airConditioner.pc35` | Signal K path prefix |
| `address` | (empty) | Optional BLE address, e.g. `03:bb:53:1a:ac:79` |
| `namePrefix` | `PC35` | Advertised-name match |
| `pollSeconds` | `30` | Status refresh interval |

## Protocol

See `PC35_BLE_protocol.md` in this repo for the full BLE command/status spec.

## License

Apache-2.0
