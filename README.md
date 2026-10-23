# ioBroker.klima

**Deutsch:** [README.de.md](README.de.md)

Controls **Midea** and **Tuya** air conditioners uniformly over the **local LAN** — no cloud required.

- **Midea:** V3 protocol over TCP/6444 (per-device token + key)
- **Tuya:** local Tuya protocol over TCP/6668 (device ID + local key + version)

## Features

- Central device list in the adapter settings
- Simultaneous control of up to 6 air conditioners
- Automatic polling of current state (target temperature, current temperature, mode, fan, power)
- Write target temperature, mode, fan speed and power via ioBroker states
- Device-specific states under `device_<ID>.*`

## Requirements

- ioBroker with js-controller ≥ 6.0.11
- Node.js ≥ 22
- Midea or Tuya air conditioner on the local network
- For Midea: token and key from the HA integration "Midea Air Appliance (LAN)" or a similar tool
- For Tuya: device ID, local key and protocol version (usually 3.3 or 3.5)

## Installation

1. **Install the adapter** (from npm or GitHub)
2. Create an instance, e.g. `klima.0`
3. Fill in the device list in the adapter settings:
   - **Midea:** name, device ID, IP, port (6444), token, key
   - **Tuya:** name, device ID, IP, port (6668), local key, version
4. Save — the adapter connects immediately

## States per device

| State | Type | Description |
|-------|------|-------------|
| `device_<ID>.power` | boolean | On/off |
| `device_<ID>.mode` | string | Mode (cool, heat, dry, fan, auto) |
| `device_<ID>.targetTemperature` | number | Target temperature |
| `device_<ID>.currentTemperature` | number | Current room temperature |
| `device_<ID>.fanSpeed` | string/number | Fan speed |
| `device_<ID>.online` | boolean | Device reachable |

## Troubleshooting

- **`info.connection = false`:** no device reachable → check IP, port and keys
- **Writes are not applied:** check that no other system (e.g. LocalTuya in HA) is accessing the device in parallel
- **Midea timeout:** disable the HA integration "Midea Air Appliance (LAN)" so that `klima.0` has the exclusive TCP connection
- **Tuya write errors:** check `version` (3.3, 3.5) and ensure the device is reachable on the local network

## Security note

In version 0.1.0 tokens/keys/local keys are stored in the adapter configuration. Run the adapter on a trusted ioBroker host and restrict access to the adapter settings.

## Changelog

### 0.1.0 (2026-10-23)
* (Thorhammer1967) Initial release with support for Midea and Tuya LAN air conditioners

## License

MIT License

Copyright (c) 2026 Thorhammer1967 <junk-alles@t-online.de>

See [LICENSE](LICENSE) for the full license text.
