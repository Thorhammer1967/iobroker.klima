"use strict";

/**
 * iobroker.klima - einheitliche Steuerung von Midea- und Tuya-Klimageräten
 * über das lokale LAN (ohne Cloud).
 */

const utils = require("@iobroker/adapter-core");
const { CHANNELS, MODES, FAN_SPEEDS, SWINGS } = require("./lib/model");
const { MideaDevice } = require("./lib/mideaDevice");
const { TuyaClimateDevice } = require("./lib/tuyaDevice");

class KlimaAdapter extends utils.Adapter {
  constructor() {
    super({ ...utils.AdapterOptions, name: "klima" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this._onUnload.bind(this));
    this.devices = new Map();
    this._pollTimer = null;
  }

  async onReady() {
    // v7: setState erwartet einen reinen Wert oder ein State-Objekt mit
    // erlaubten Properties. Ein Objekt {connected:false} ist verboten.
    await this.extendObject("info.connection", {
      type: "state",
      common: {
        name: "Device or service connected",
        type: "boolean",
        role: "indicator.connected",
        read: true,
        write: false,
        def: false,
      },
      native: {},
    });
    this.setState("info.connection", false, true);

    const cfg = this.config || {};
    const list = Array.isArray(cfg.devices) ? cfg.devices : [];
    const pollInterval = Math.max(5, Number(cfg.pollInterval) || 30) * 1000;

    if (!list.length) {
      this.log.warn("Keine Geraete konfiguriert - bitte in den Instanz-Einstellungen eintragen.");
    }

    // Zugangsdaten entschluesseln. Das Admin-UI verschluesselt Passwort-Felder
    // automatisch ($/aes-192-cbc:...), zusaetzlich koennen Werte im Klartext
    // vorliegen (z. B. per CLI gesetzt). Beides wird abgefangen.
    const secret = await this.getSystemSecret();
    let plainTextFound = false;
    for (const dev of list) {
      for (const key of ["token", "key", "localKey"]) {
        if (typeof dev[key] === "string" && dev[key] && !dev[key].startsWith("$/aes-192-cbc:")) {
          plainTextFound = true;
        }
        dev[key] = this._decryptIfNeeded(dev[key], secret);
      }
    }
    // Klartext-Zugangsdaten sofort wieder verschluesseln, damit sie nicht
    // im Klartext in objects.jsonl liegen.
    if (plainTextFound) {
      await this._encryptCredentials(secret);
    }

    for (const dev of list) {
      if (!dev || !dev.id || !dev.host) {
        continue;
      }
      const type = dev.type === "tuya" ? "tuya" : "midea";
      let instance;
      try {
        instance = type === "tuya" ? new TuyaClimateDevice(dev, this.log, this) : new MideaDevice(dev, this.log, this);
      } catch (e) {
        this.log.error(`Geraet ${dev.name || dev.id} (${type}) konnte nicht erstellt werden: ${e.message}`);
        continue;
      }
      this.devices.set(dev.id, instance);
      await this._createObjects(instance);
    }

    this.log.info(`${this.devices.size} Klimageraet(e) konfiguriert - Abfrageintervall ${pollInterval / 1000}s`);

    await this._pollAll();

    this._pollTimer = this.setInterval(() => {
      this._pollAll().catch((e) => this.log.error(`Abfrage fehlgeschlagen: ${e.message}`));
    }, pollInterval);

    this.on("stateChange", this._onStateChange.bind(this));

    // v7: ohne explizites Abonnement feuert das stateChange-Event nicht.
    // "device_*" matcht alle Geraete-Objekte, der Namespace wird
    // automatisch vorangestellt.
    await this.subscribeStatesAsync("device_*");
    this.log.debug("States 'device_*' abonniert.");
  }

  /**
   * Verschluesselt Klartext-Zugangsdaten in der Instanz-Konfiguration.
   * Das Admin-UI verschluesselt nur Top-Level-Passwortfelder, nicht die
   * Eintraege einer Geraetetabelle. Deshalb werden die Zugangsdaten hier
   * selbst verschluesselt, damit sie nicht im Klartext in objects.jsonl
   * landen.
   * @param {string} secret System-Secret
   */
  async _encryptCredentials(secret) {
    try {
      // v7: getObject verlangt zwingend einen Callback - als Promise
      // gibt es hier keine getObjectAsync-Variante im Adapter-Core 3.x.
      const obj = await new Promise((resolve, reject) => {
        this.getObject(`system.adapter.${this.namespace}`, (err, res) => (err ? reject(err) : resolve(res)));
      });
      if (!obj || !obj.native || !Array.isArray(obj.native.devices)) {
        return;
      }
      let changed = false;
      for (const dev of obj.native.devices) {
        for (const key of ["token", "key", "localKey"]) {
          const value = dev[key];
          if (typeof value === "string" && value && !value.startsWith("$/aes-192-cbc:")) {
            dev[key] = this.encrypt(secret, value);
            changed = true;
          }
        }
      }
      if (changed) {
        // v7: setObject verlangt zwingend einen Callback.
        await new Promise((resolve, reject) => {
          this.setObject(`system.adapter.${this.namespace}`, obj, (err) =>
            err ? reject(err) : resolve(),
          );
        });
        this.log.info("Zugangsdaten verschluesselt in der Instanz-Konfiguration abgelegt.");
      }
    } catch (e) {
      this.log.warn(`Zugangsdaten konnten nicht verschluesselt werden: ${e.message}`);
    }
  }

  /**
   * Entschlüsselt einen Wert, falls er verschlüsselt vorliegt.
   * Das Admin-UI verschlüsselt Passwort-Felder mit dem System-Secret und
   * dem Präfix "$/aes-192-cbc:". Klartext wird unverändert zurückgegeben.
   * @param {string} value
   * @param {string} secret
   * @returns {string}
   */
  _decryptIfNeeded(value, secret) {
    if (typeof value !== "string" || !value || !value.startsWith("$/aes-192-cbc:")) {
      return value;
    }
    try {
      return this.decrypt(secret, value);
    } catch (e) {
      this.log.warn(`Zugangsdaten konnten nicht entschluesselt werden: ${e.message}`);
      return value;
    }
  }

  /** Objects fuer ein Geraet anlegen (idempotent). */
  async _createObjects(dev) {
    const id = `device_${dev.id}`;
    await this.extendObject(id, { type: "device", common: { name: dev.name || dev.id } });
    for (const [key, def] of Object.entries(CHANNELS)) {
      const common = {
        name: def.name,
        type: def.type,
        role: def.role,
        read: true,
        write: key !== "currentTemperature" && key !== "humidity" && key !== "online",
      };
      if (def.unit) {
        common.unit = def.unit;
      }
      if (key === "mode") {
        common.choices = MODES;
      } else if (key === "fanSpeed") {
        common.choices = FAN_SPEEDS;
      } else if (key === "swing") {
        common.choices = SWINGS;
      }
      if (key === "targetTemperature") {
        common.min = 16;
        common.max = 31;
        common.step = 1;
      }
      await this.extendObject(`${id}.${key}`, { type: "state", common });
    }
  }

  /** Alle Geraete abfragen und States aktualisieren. */
  async _pollAll() {
    let anyOnline = false;
    for (const dev of this.devices.values()) {
      try {
        const status = await dev.read();
        const id = `device_${dev.id}`;
        for (const [key, value] of Object.entries(status)) {
          if (value !== undefined && value !== null) {
            await this.setState(`${id}.${key}`, value, true);
          }
        }
        anyOnline = true;
      } catch (e) {
        this.log.warn(`${dev.name}: Abfrage fehlgeschlagen - ${e.message}`);
        await this.setState(`device_${dev.id}.online`, false, true);
      }
    }
    await this.setState("info.connection", anyOnline, true);
  }

  /** Schreibbefehl eines States verarbeiten. */
  async _onStateChange(id, state) {
    if (!state || state.ack) {
      return;
    }
    // Das stateChange-Event liefert die volle ID inkl. Namespace
    // (z. B. "klima.0.device_<id>.<channel>"). Relativ zum Namespace
    // arbeiten, damit die ID-Pruefung greift.
    const relId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
    if (!relId.startsWith("device_")) {
      return;
    }
    const parts = relId.split(".");
    // Aufbau: device_<geraeteId>.<channel>  ->  2 Teile
    if (parts.length < 2) {
        return;
    }
    const devId = parts[0].replace(/^device_/, "");
    const channel = parts[1];
    const dev = this.devices.get(devId);
    if (!dev) {
        return;
    }
    const cmd = {};
    cmd[channel] = state.val;
    try {
        await dev.write(cmd);
        this.log.debug(`${dev.name}: ${channel} = ${JSON.stringify(state.val)} gesetzt`);
        await this.setStateAsync(`${relId}`, state.val, true);
    } catch (e) {
        this.log.error(`${dev.name}: Schreiben von ${channel} fehlgeschlagen - ${e.message}`);
    }
  }

  async _onUnload(callback) {
    if (this._pollTimer) {
      this.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    for (const dev of this.devices.values()) {
      try {
        await dev.disconnect();
      } catch {
        /* ignorieren */
      }
    }
    this.devices.clear();
    callback();
  }
}

if (require.main !== module) {
  module.exports = (options) => new KlimaAdapter(options);
} else {
  new KlimaAdapter();
}
