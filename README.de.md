# ioBroker.klima

Steuert **Midea**- und **Tuya**-Klimageräte einheitlich über das **lokale LAN** — ganz ohne Cloud.

- **Midea:** V3-Protokoll über TCP/6444 (Token + Key pro Gerät)
- **Tuya:** lokales Tuya-Protokoll über TCP/6668 (Device-ID + Local Key + Version)

## Funktionen

- Zentrale Geräteliste in den Adapter-Einstellungen
- Gleichzeitige Steuerung von bis zu 6 Klimageräten
- Automatisches Polling des aktuellen Zustands (Solltemperatur, Ist-Temperatur, Modus, Lüfter, Power)
- Schreiben von Solltemperatur, Modus, Lüfterstufe und Power über ioBroker-Datenpunkte
- Geräte-spezifische States unter `device_<ID>.*`

## Voraussetzungen

- ioBroker mit js-controller ≥ 6.0.11
- Node.js ≥ 22
- Midea- oder Tuya-Klimagerät im lokalen Netzwerk
- Für Midea: Token und Key aus der HA-Integration „Midea Air Appliance (LAN)“ oder ähnlichem Tool
- Für Tuya: Device-ID, Local Key und Protokollversion (meist 3.3 oder 3.5)

## Installation

1. **Adapter installieren** (aus npm oder GitHub)
2. Instanz `klima.0` anlegen
3. In den Adapter-Einstellungen die Geräteliste füllen:
   - **Midea:** Name, Geräte-ID, IP, Port (6444), Token, Key
   - **Tuya:** Name, Geräte-ID, IP, Port (6668), Local Key, Version
4. Speichern — der Adapter baut sofort die Verbindungen auf

## Datenpunkte pro Gerät

| State | Typ | Beschreibung |
|-------|-----|--------------|
| `device_<ID>.power` | boolean | Ein/Aus |
| `device_<ID>.mode` | string | Modus (cool, heat, dry, fan, auto) |
| `device_<ID>.targetTemperature` | number | Solltemperatur |
| `device_<ID>.currentTemperature` | number | Aktuelle Raumtemperatur |
| `device_<ID>.fanSpeed` | string/number | Lüfterstufe |
| `device_<ID>.online` | boolean | Gerät erreichbar |

## Fehlersuche

- **`info.connection = false`:** kein Gerät erreichbar → IP, Port und Schlüssel prüfen
- **Schreiben wird nicht übernommen:** prüfen, ob ein anderes System (z. B. LocalTuya in HA) parallel auf das Gerät zugreift
- **Midea-Timeout:** HA-Integration „Midea Air Appliance (LAN)“ deaktivieren, damit `klima.0` alleinige TCP-Verbindung hat
- **Tuya-Schreibfehler:** `version` prüfen (3.3, 3.5) und sicherstellen, dass das Gerät im lokalen Netz erreichbar ist

## Sicherheitshinweis

In Version 0.1.0 werden Token/Key/Local Key in der Adapter-Konfiguration gespeichert. Verwende den Adapter auf einem vertrauenswürdigen ioBroker-Host und schränke den Zugriff auf die Adapter-Einstellungen ein.

## Tipps

### Fernbedienungstemperatursensor nutzen (Follow Me) bei Midea-Geräten

Viele Midea-Fernbedienungen enthalten einen Temperatursensor und unterstützen den **Follow-Me**- / **iFeel**-Modus. Wenn er aktiv ist, nutzt die Inneneinheit nicht ihren internen Raumsensor, sondern die Temperaturmessung der Fernbedienung.

- **Follow Me einmalig an der Original-Fernbedienung aktivieren** (Taste „Follow Me“, „iFeel“, „Sensor“ oder im SET-Menü).
- Die Fernbedienung sendet dann automatisch etwa alle 3 Minuten die Temperatur per IR an die Inneneinheit.
- Der Modus bleibt aktiv, bis man ihn an der Fernbedienung wieder ausschaltet (oder die Fernbedienung ausfällt, z. B. leere Batterien).
- Der Adapter liest die Temperatur, die die Inneneinheit gerade verwendet, über `device_<ID>.currentTemperature`.
- Damit kannst du `device_<ID>.currentTemperature` in Automatisierungen als Raumtemperatur verwenden — bei aktiviertem Follow Me entspricht sie der Temperatur am Ort der Fernbedienung.

## Changelog

### 0.1.0 (2026-10-23)
* (Thorhammer1967) Erstveröffentlichung mit Unterstützung für Midea- und Tuya-LAN-Klimageräte

## Lizenz

MIT — siehe [LICENSE](LICENSE).
