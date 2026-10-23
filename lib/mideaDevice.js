"use strict";

/**
 * Midea-Backend: kapselt das LAN-V3-Protokoll (aus lib/midea, MIT, TA2k)
 * und mappt es auf das einheitliche Klimadaten-Modell.
 */

const { ACDevice } = require("./midea/devices/ac");

/** Midea-Modus -> einheitlicher Modus. */
const MODE_MAP = {
  auto: "auto",
  cool: "cool",
  heat: "heat",
  dry: "dry",
  fanonly: "fan",
  fan: "fan",
  customdry: "dry",
};

/** Midea-Luefter (numerisch) -> einheitliche Luftstromstaerke. */
const FAN_MAP = {
  102: "auto",
  20: "low",
  40: "low",
  60: "medium",
  80: "high",
  100: "high",
};

class MideaDevice {
  /**
   * @param {object} cfg Geraete-Konfiguration
   * @param {object} log ioBroker-Logger
   */
  constructor(cfg, log) {
    this.cfg = cfg;
    this.log = log || console;
    this.type = "midea";
    this.id = cfg.id;
    this.name = cfg.name || cfg.id;
    this.host = cfg.host;
    this.port = cfg.port || 6444;
    this.token = cfg.token;
    this.key = cfg.key;
    this.online = false;
    this._device = null;
  }

  /** Verbindung aufbauen (V3-Handshake). */
  async connect() {
    this._device = new ACDevice({
      id: this.id,
      name: this.name,
      host: this.host,
      port: this.port,
      protocol: 3,
      token: this.token,
      key: this.key,
      modelNumber: this.cfg.modelNumber,
      logger: this.log,
    });
    await this._device._ensureLan();
    await this._device.refreshStatus();
    this.online = true;
    return this;
  }

  /** Verbindung schliessen. */
  async disconnect() {
    this.online = false;
    if (this._device) {
      try {
        this._device.close();
      } catch {
        /* ignorieren */
      }
      this._device = null;
    }
  }

  /**
   * Aktuellen Status lesen und auf das einheitliche Modell abbilden.
   * @returns {Promise<object>}
   */
  async read() {
    if (!this._device) {
      await this.connect();
    }
    const raw = await this._device.refreshStatus();
    const s = raw || this._device.status || {};
    const out = {
      power: !!s.powerOn,
      mode: MODE_MAP[String(s.mode).toLowerCase()] || "auto",
      fanSpeed: FAN_MAP[Number(s.fanSpeed)] || "auto",
      swing: ["off", "vertical", "horizontal", "both"].includes(s.swing) ? s.swing : "off",
      online: true,
    };
    // Temperaturen: Setpoint bevorzugt, Ist-Temperatur als indoorTemperature.
    const setpoint = s.temperatureSetpoint;
    const indoor = s.indoorTemperature;
    if (typeof setpoint === "number" && setpoint > 0) {
      out.targetTemperature = setpoint;
    }
    if (typeof indoor === "number" && indoor > -50) {
      out.currentTemperature = indoor;
    }
    if (typeof s.indoorHumidity === "number") {
      out.humidity = s.indoorHumidity;
    }
    return out;
  }

  /**
   * Befehle schreiben. Erwartet Schluessel des einheitlichen Modells.
   * @param {object} cmd
   * @returns {Promise<void>}
   */
  async write(cmd) {
    if (!this._device) {
      await this.connect();
    }
    const updates = {};
    if (cmd.power !== undefined) {
      updates.powerOn = !!cmd.power;
    }
    if (cmd.mode !== undefined) {
      updates.mode = cmd.mode;
    }
    if (cmd.targetTemperature !== undefined) {
      updates.temperatureSetpoint = Math.round(cmd.targetTemperature);
    }
    if (cmd.fanSpeed !== undefined) {
      updates.fanSpeed = cmd.fanSpeed;
    }
    if (cmd.swing !== undefined) {
      updates.swing = cmd.swing;
    }
    if (Object.keys(updates).length) {
      await this._device.setStatus(updates);
    }
  }
}

module.exports = { MideaDevice, MODE_MAP, FAN_MAP };
