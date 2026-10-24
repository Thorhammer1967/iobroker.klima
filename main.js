"use strict";

/**
 * iobroker.klima - einheitliche Steuerung von Midea- und Tuya-Klimageräten
 * über das lokale LAN (ohne Cloud).
 */

const utils = require("@iobroker/adapter-core");
const { CHANNELS, MODES, FAN_SPEEDS, SWINGS, CONTROL_DEFAULTS } = require("./lib/model");
const { MideaDevice } = require("./lib/mideaDevice");
const { TuyaClimateDevice } = require("./lib/tuyaDevice");

class KlimaAdapter extends utils.Adapter {
  constructor() {
    super({ ...utils.AdapterOptions, name: "klima" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this._onUnload.bind(this));
    this.on("objectChange", this._onObjectChange.bind(this));
    this.devices = new Map();
    this._pollTimer = null;
    this._overrideTimers = new Map();
    this._lastOverrideState = new Map();
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

    // Voreinstellungen aus der Geraetetabelle auf die Regelungs-States
    // uebertragen, damit man im Admin-UI direkt Sollwerte setzen kann.
    await this._initControlDefaults(list);

    // Zentrale Thermostat-Steuerung anlegen.
    await this._createThermostatObjects(list);
    await this._initThermostatDefaults(list);

    await this._pollAll();

    this._pollTimer = this.setInterval(() => {
      this._pollAll().catch((e) => this.log.error(`Abfrage fehlgeschlagen: ${e.message}`));
    }, pollInterval);

    this.on("stateChange", this._onStateChange.bind(this));

    // v7: ohne explizites Abonnement feuert das stateChange-Event nicht.
    // "device_*" matcht alle Geraete-Objekte, der Namespace wird
    // automatisch vorangestellt.
    await this.subscribeStatesAsync("device_*");
    await this.subscribeStatesAsync("thermostat.*");
    this.log.debug("States 'device_*' und 'thermostat.*' abonniert.");
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
          this.setObject(`system.adapter.${this.namespace}`, obj, (err) => (err ? reject(err) : resolve()));
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
      } else if (key === "controlTarget") {
        common.min = 16;
        common.max = 31;
        common.step = 0.5;
        common.def = CONTROL_DEFAULTS.target;
      } else if (key === "controlHysteresis") {
        common.min = 0;
        common.max = 5;
        common.step = 0.1;
        common.def = CONTROL_DEFAULTS.hysteresis;
      } else if (key === "controlSensor") {
        common.def = "";
      } else if (key === "controlActive") {
        common.def = false;
      } else if (key === "controlState") {
        common.write = false;
        common.def = "off";
      }
      await this.extendObject(`${id}.${key}`, { type: "state", common });
    }
  }

  /**
   * Uebertraegt die in der Tabelle hinterlegten Regelungs-Defaults
   * (controlActive, controlTarget, controlHysteresis, controlSensor) auf die
   * States, falls diese noch nie gesetzt wurden.
   */
  async _initControlDefaults(list) {
    for (const dev of list) {
      if (!dev || !dev.id) {
        continue;
      }
      const id = `device_${dev.id}`;
      const defaults = {
        controlActive: dev.controlActive === true,
        controlTarget: typeof dev.controlTarget === "number" ? dev.controlTarget : CONTROL_DEFAULTS.target,
        controlHysteresis:
          typeof dev.controlHysteresis === "number" ? dev.controlHysteresis : CONTROL_DEFAULTS.hysteresis,
        controlSensor: typeof dev.controlSensor === "string" ? dev.controlSensor : "",
      };
      for (const [key, value] of Object.entries(defaults)) {
        const state = await this.getStateAsync(`${id}.${key}`);
        if (state && state.val !== undefined && state.val !== null && state.val !== "" && state.val !== false) {
          continue;
        }
        await this.setState(`${id}.${key}`, value, true);
      }
    }
  }

  /**
   * Legt die zentrale Thermostat-Steuerung an:
   *   thermostat.globalActive            (Master-Schalter)
   *   thermostat.globalOverride          (1h-Override fuer alle)
   *   thermostat.devices.<id>.active     (pro Geraet)
   *   thermostat.devices.<id>.target     (pro Geraet)
   *   thermostat.devices.<id>.hysteresis (pro Geraet)
   *   thermostat.devices.<id>.override       (manueller Override)
   *   thermostat.devices.<id>.overrideMode  (Zielmodus)
   *   thermostat.devices.<id>.overrideTarget (Zieltemperatur)
   *   thermostat.devices.<id>.overrideMinutes (Dauer in Minuten)
   *   thermostat.devices.<id>.overrideRemaining (verbleibende Minuten, RO)
   */
  async _createThermostatObjects(list) {
    await this.extendObject("thermostat", { type: "channel", common: { name: "Thermostat" } });
    await this.extendObject("thermostat.globalActive", {
      type: "state",
      common: {
        name: "Thermostat global active",
        type: "boolean",
        role: "switch.enable",
        read: true,
        write: true,
        def: false,
      },
    });
    await this.extendObject("thermostat.globalOverride", {
      type: "state",
      common: {
        name: "Thermostat global override (1h)",
        type: "boolean",
        role: "switch.enable",
        read: true,
        write: true,
        def: false,
      },
    });

    await this.extendObject("thermostat.devices", { type: "channel", common: { name: "Devices" } });
    for (const dev of list) {
      if (!dev || !dev.id) {
        continue;
      }
      const base = `thermostat.devices.${dev.id}`;
      await this.extendObject(base, { type: "device", common: { name: dev.name || dev.id } });
      await this.extendObject(`${base}.active`, {
        type: "state",
        common: { name: "Active", type: "boolean", role: "switch.enable", read: true, write: true, def: false },
      });
      await this.extendObject(`${base}.target`, {
        type: "state",
        common: {
          name: "Target temperature",
          type: "number",
          role: "level.temperature",
          unit: "°C",
          read: true,
          write: true,
          min: 16,
          max: 31,
          step: 0.5,
          def: CONTROL_DEFAULTS.target,
        },
      });
      await this.extendObject(`${base}.hysteresis`, {
        type: "state",
        common: {
          name: "Hysteresis",
          type: "number",
          role: "level",
          unit: "°C",
          read: true,
          write: true,
          min: 0,
          max: 5,
          step: 0.1,
          def: CONTROL_DEFAULTS.hysteresis,
        },
      });
      await this.extendObject(`${base}.override`, {
        type: "state",
        common: {
          name: "Manual override",
          type: "boolean",
          role: "switch.enable",
          read: true,
          write: true,
          def: false,
        },
      });
      await this.extendObject(`${base}.overrideMode`, {
        type: "state",
        common: { name: "Override mode", type: "string", role: "state", read: true, write: true, def: "auto" },
      });
      await this.extendObject(`${base}.overrideTarget`, {
        type: "state",
        common: {
          name: "Override target temperature",
          type: "number",
          role: "level.temperature",
          unit: "°C",
          read: true,
          write: true,
          min: 16,
          max: 31,
          step: 0.5,
          def: CONTROL_DEFAULTS.target,
        },
      });
      await this.extendObject(`${base}.overrideMinutes`, {
        type: "state",
        common: {
          name: "Override duration (min)",
          type: "number",
          role: "level",
          unit: "min",
          read: true,
          write: true,
          min: 1,
          max: 1440,
          step: 1,
          def: 60,
        },
      });
      await this.extendObject(`${base}.overrideRemaining`, {
        type: "state",
        common: {
          name: "Override remaining (min)",
          type: "number",
          role: "value",
          unit: "min",
          read: true,
          write: false,
          def: 0,
        },
      });
    }
  }

  /**
   * Synchronisiert die zentrale Thermostat-Steuerung mit den Geraete-
   * Regelungs-States beim Start und wendet die Admin-UI-Defaults an.
   */
  async _initThermostatDefaults(list) {
    const anyActive = [];
    const cfg = this.config || {};
    const overrideDefaults = {
      mode: cfg.defaultOverrideMode || "auto",
      target: typeof cfg.defaultOverrideTarget === "number" ? cfg.defaultOverrideTarget : CONTROL_DEFAULTS.target,
      minutes: typeof cfg.defaultOverrideMinutes === "number" ? cfg.defaultOverrideMinutes : 60,
    };

    for (const dev of list) {
      if (!dev || !dev.id) {
        continue;
      }
      const deviceId = `device_${dev.id}`;
      const thermoId = `thermostat.devices.${dev.id}`;
      const instance = this.devices.get(dev.id);
      if (!instance) {
        continue;
      }

      const active = (await this.getStateAsync(`${deviceId}.controlActive`))?.val === true;
      const target = (await this.getStateAsync(`${deviceId}.controlTarget`))?.val ?? CONTROL_DEFAULTS.target;
      const hysteresis =
        (await this.getStateAsync(`${deviceId}.controlHysteresis`))?.val ?? CONTROL_DEFAULTS.hysteresis;

      await this.setState(`${thermoId}.active`, active, true);
      await this.setState(`${thermoId}.target`, target, true);
      await this.setState(`${thermoId}.hysteresis`, hysteresis, true);

      // Pro-Geraet-Override-Werte aus der Tabelle; Admin-Defaults als Fallback.
      const devOverride = dev.override === true;
      const devMode = dev.overrideMode || overrideDefaults.mode;
      const devTarget = typeof dev.overrideTarget === "number" ? dev.overrideTarget : overrideDefaults.target;
      const devMinutes = typeof dev.overrideMinutes === "number" ? dev.overrideMinutes : overrideDefaults.minutes;

      await this.setState(`${thermoId}.override`, devOverride, true);
      await this.setState(`${thermoId}.overrideMode`, devMode, true);
      await this.setState(`${thermoId}.overrideTarget`, devTarget, true);
      await this.setState(`${thermoId}.overrideMinutes`, devMinutes, true);
      const remaining = await this.getStateAsync(`${thermoId}.overrideRemaining`);
      await this.setState(`${thermoId}.overrideRemaining`, remaining?.val ?? 0, true);

      if (devOverride) {
        await this._startOverride(instance);
      }

      if (active) {
        anyActive.push(dev.id);
      }
    }
    await this.setState("thermostat.globalActive", anyActive.length > 0, true);
    await this.setState("thermostat.globalOverride", false, true);

    // Admin-UI Defaults anwenden, falls gesetzt.
    if (cfg.globalThermostatActive === true) {
      await this._setGlobalActive(true);
    }
    if (cfg.globalOverrideActive === true) {
      await this._setGlobalOverride(true);
    }
  }

  /**
   * Reagiert auf Aenderungen der Instanz-Konfiguration (z. B. im Admin-UI).
   * Uebertraegt geaenderte Tabellenwerte sofort in die Regelungs-States,
   * ohne dass der Adapter neu gestartet werden muss.
   */
  async _onObjectChange(id, obj) {
    if (id !== `system.adapter.${this.namespace}` || !obj || !obj.native) {
      return;
    }
    this.log.info("Instanz-Konfiguration geaendert - synchronisiere Werte.");
    this.config = obj.native;
    const cfg = this.config || {};
    const list = Array.isArray(cfg.devices) ? cfg.devices : [];
    if (!list.length) {
      return;
    }
    const secret = await this.getSystemSecret();
    for (const dev of list) {
      for (const key of ["token", "key", "localKey"]) {
        dev[key] = this._decryptIfNeeded(dev[key], secret);
      }
    }
    await this._syncConfigToStates(list);
  }

  /**
   * Schreibt die aktuellen Werte aus der Admin-UI-Geraetetabelle in die
   * Regelungs-States. Laufende Overrides werden dabei nicht unterbrochen,
   * neu aktivierte Overrides starten sofort.
   */
  async _syncConfigToStates(list) {
    const anyActive = [];
    for (const dev of list) {
      if (!dev || !dev.id) {
        continue;
      }
      const instance = this.devices.get(dev.id);
      if (!instance) {
        continue;
      }
      const deviceId = `device_${dev.id}`;
      const thermoId = `thermostat.devices.${dev.id}`;

      const active = dev.controlActive === true;
      const target = typeof dev.controlTarget === "number" ? dev.controlTarget : CONTROL_DEFAULTS.target;
      const hysteresis = typeof dev.controlHysteresis === "number" ? dev.controlHysteresis : CONTROL_DEFAULTS.hysteresis;
      const sensor = typeof dev.controlSensor === "string" ? dev.controlSensor : "";

      await this.setState(`${deviceId}.controlActive`, active, true);
      await this.setState(`${deviceId}.controlTarget`, target, true);
      await this.setState(`${deviceId}.controlHysteresis`, hysteresis, true);
      await this.setState(`${deviceId}.controlSensor`, sensor, true);

      await this.setState(`${thermoId}.active`, active, true);
      await this.setState(`${thermoId}.target`, target, true);
      await this.setState(`${thermoId}.hysteresis`, hysteresis, true);

      const overrideActive = dev.override === true;
      const overrideMode = dev.overrideMode || "auto";
      const overrideTarget = typeof dev.overrideTarget === "number" ? dev.overrideTarget : target;
      const overrideMinutes = typeof dev.overrideMinutes === "number" ? dev.overrideMinutes : 60;

      await this.setState(`${thermoId}.override`, overrideActive, true);
      await this.setState(`${thermoId}.overrideMode`, overrideMode, true);
      await this.setState(`${thermoId}.overrideTarget`, overrideTarget, true);
      await this.setState(`${thermoId}.overrideMinutes`, overrideMinutes, true);

      if (overrideActive) {
        await this._startOverride(instance);
      } else {
        this._stopOverride(dev.id);
      }

      if (active) {
        anyActive.push(dev.id);
      }
    }
    await this.setState("thermostat.globalActive", anyActive.length > 0, true);
  }

  /** Alle Geraete abfragen, States aktualisieren und ggf. Regelung ausfuehren. */
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
        await this._runControl(dev, id);
      } catch (e) {
        this.log.warn(`${dev.name}: Abfrage fehlgeschlagen - ${e.message}`);
        await this.setState(`device_${dev.id}.online`, false, true);
      }
    }
    await this.setState("info.connection", anyOnline, true);
  }

  /**
   * Vergleicht die aktuell gelesenen Geraete-Werte mit dem letzten
   * Override-Zustand. Aendert sich power, mode, targetTemperature,
   * fanSpeed oder swing, gilt das als Fernbedienungseingriff und der
   * Override wird beendet.
   * @returns {boolean}
   */
  async _checkRemoteChange(dev, id) {
    const tracked = ["power", "mode", "targetTemperature", "fanSpeed", "swing"];
    let changed = false;
    const last = this._lastOverrideState.get(dev.id) || {};
    const current = {};
    for (const key of tracked) {
      const state = await this.getStateAsync(`${id}.${key}`);
      current[key] = state?.val;
      if (key in last && current[key] !== last[key]) {
        changed = true;
      }
    }
    this._lastOverrideState.set(dev.id, current);
    return changed;
  }

  /**
   * Liest die aktuellen Regelungs-Parameter und fuehrt die einfache
   * Hysterese-Regelung aus. Die Quelle fuer die Ist-Temperatur ist
   * entweder der externe Sensor (controlSensor) oder die Geraete-Temperatur.
   */
  async _runControl(dev, id) {
    try {
      const override = (await this.getStateAsync(`thermostat.devices.${dev.id}.override`))?.val === true;
      if (override) {
        // Pruefen, ob sich das Geraet per Fernbedienung geaendert hat.
        const changed = await this._checkRemoteChange(dev, id);
        if (changed) {
          this._stopOverride(dev.id);
          await this.setState(`thermostat.devices.${dev.id}.override`, false, true);
          await this.setState(`thermostat.devices.${dev.id}.overrideRemaining`, 0, true);
          await this._updateGlobalActiveFromDevices();
          this.log.info(`${dev.name}: Override durch Fernbedienung abgebrochen`);
        } else {
          await this.setState(`${id}.controlState`, "override", true);
          return;
        }
      }

      const active = (await this.getStateAsync(`${id}.controlActive`))?.val === true;
      if (!active) {
        await this.setState(`${id}.controlState`, "off", true);
        return;
      }

      const targetState = await this.getStateAsync(`${id}.controlTarget`);
      const hysteresisState = await this.getStateAsync(`${id}.controlHysteresis`);
      const sensorState = await this.getStateAsync(`${id}.controlSensor`);
      const target = typeof targetState?.val === "number" ? targetState.val : CONTROL_DEFAULTS.target;
      const hysteresis = typeof hysteresisState?.val === "number" ? hysteresisState.val : CONTROL_DEFAULTS.hysteresis;
      const sensorId = sensorState?.val ? String(sensorState.val).trim() : "";

      let current = null;
      if (sensorId) {
        const ext = await this.getForeignStateAsync(sensorId);
        current = ext && typeof ext.val === "number" ? ext.val : null;
      }
      if (current === null) {
        const deviceTemp = await this.getStateAsync(`${id}.currentTemperature`);
        current = typeof deviceTemp?.val === "number" ? deviceTemp.val : null;
      }

      if (current === null || Number.isNaN(current)) {
        this.log.warn(`${dev.name}: Regelung keine gueltige Ist-Temperatur (Sensor: ${sensorId || "Gerät"})`);
        await this.setState(`${id}.controlState`, "error", true);
        return;
      }

      const diff = current - target;
      const powerState = await this.getStateAsync(`${id}.power`);
      const modeState = await this.getStateAsync(`${id}.mode`);
      const targetTempState = await this.getStateAsync(`${id}.targetTemperature`);
      const mode = modeState?.val || "auto";
      const isOn = powerState?.val === true;
      let newPower = isOn;
      let newMode = mode;
      let newTargetTemp = typeof targetTempState?.val === "number" ? targetTempState.val : target;
      let controlState = "idle";

      if (diff >= hysteresis) {
        // Zu warm → kühlen
        controlState = "cooling";
        newPower = true;
        newMode = mode === "heat" ? "cool" : mode || "cool";
        newTargetTemp = target;
      } else if (diff <= -hysteresis) {
        // Zu kalt → heizen
        controlState = "heating";
        newPower = true;
        newMode = mode === "cool" || mode === "dry" ? "heat" : mode || "heat";
        newTargetTemp = target;
      } else {
        // Im Toleranzbereich → laufen lassen oder standby
        controlState = isOn ? "idle" : "off";
      }

      const cmd = {};
      if (newPower !== isOn) {
        cmd.power = newPower;
      }
      if (newMode !== mode && newPower) {
        cmd.mode = newMode;
      }
      if (newTargetTemp !== targetTempState?.val && newPower) {
        cmd.targetTemperature = newTargetTemp;
      }

      if (Object.keys(cmd).length) {
        await dev.write(cmd);
        this.log.info(
          `${dev.name}: Regelung ${controlState} → ${JSON.stringify(cmd)} (Ist=${current.toFixed(2)}°C, Soll=${target}°C)`,
        );
      }

      await this.setState(`${id}.controlState`, controlState, true);
    } catch (e) {
      this.log.warn(`${dev.name}: Regelung fehlgeschlagen - ${e.message}`);
      await this.setState(`${id}.controlState`, "error", true);
    }
  }

  /** Schreibbefehl eines States verarbeiten. */
  async _onStateChange(id, state) {
    if (!state) {
      return;
    }
    // Das stateChange-Event liefert die volle ID inkl. Namespace
    // (z. B. "klima.0.device_<id>.<channel>"). Relativ zum Namespace
    // arbeiten, damit die ID-Pruefung greift.
    const relId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;

    if (state.ack) {
      // Bestaetigte Aenderungen nur noch intern synchronisieren.
      await this._syncAckState(relId, state.val);
      return;
    }

    // Zentrale Thermostat-Steuerung.
    if (relId === "thermostat.globalActive") {
      await this._setGlobalActive(state.val === true);
      return;
    }

    if (relId === "thermostat.globalOverride") {
      await this._setGlobalOverride(state.val === true);
      return;
    }

    if (relId.startsWith("thermostat.devices.")) {
      await this._handleThermostatDeviceState(relId, state.val);
      return;
    }

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
      // Bei Regelungs-Parametern nicht direkt ans Geraet schreiben.
      if (["controlActive", "controlTarget", "controlHysteresis", "controlSensor"].includes(channel)) {
        await this.setStateAsync(`${relId}`, state.val, true);
        // Sofort eine Regelungsrunde anstossen, damit die Aenderung wirksam wird.
        await this._runControl(dev, parts[0]);
        // Zentrale Thermostat-Anzeige mit aktualisieren.
        await this._syncDeviceControlToThermostat(devId, channel, state.val);
        return;
      }
      await dev.write(cmd);
      this.log.debug(`${dev.name}: ${channel} = ${JSON.stringify(state.val)} gesetzt`);
      await this.setStateAsync(`${relId}`, state.val, true);
    } catch (e) {
      this.log.error(`${dev.name}: Schreiben von ${channel} fehlgeschlagen - ${e.message}`);
    }
  }

  /**
   * Setzt den globalen Thermostat-Schalter und aktiviert/deaktiviert
   * damit alle Geraete gleichzeitig.
   */
  async _setGlobalActive(value) {
    await this.setState("thermostat.globalActive", value, true);
    for (const [devId, dev] of this.devices.entries()) {
      await this.setState(`device_${devId}.controlActive`, value, true);
      await this.setState(`thermostat.devices.${devId}.active`, value, true);
      if (value) {
        await this._runControl(dev, `device_${devId}`);
      }
    }
    this.log.info(`Thermostat global ${value ? "aktiviert" : "deaktiviert"}`);
  }

  /**
   * Verarbeitet Aenderungen an thermostat.devices.<id>.{active,target,hysteresis,override,*}
   * und schreibt sie auf die jeweiligen device_* control-States bzw.
   * startet/stoppt einen Override-Timer.
   */
  async _handleThermostatDeviceState(relId, value) {
    const match = relId.match(
      /^thermostat\.devices\.([^.]+)\.(active|target|hysteresis|override|overrideMode|overrideTarget|overrideMinutes)$/,
    );
    if (!match) {
      return;
    }
    const devId = match[1];
    const field = match[2];
    const deviceId = `device_${devId}`;
    const dev = this.devices.get(devId);
    if (!dev) {
      return;
    }

    if (["active", "target", "hysteresis"].includes(field)) {
      const mapping = { active: "controlActive", target: "controlTarget", hysteresis: "controlHysteresis" };
      const deviceChannel = mapping[field];
      await this.setState(`${deviceId}.${deviceChannel}`, value, true);
      await this.setState(relId, value, true);
      await this._updateGlobalActiveFromDevices();
      await this._runControl(dev, deviceId);
      this.log.info(`${dev.name}: Thermostat ${field} = ${JSON.stringify(value)}`);
      return;
    }

    // Override-Parameter: State setzen und ggf. Timer (neu) starten.
    await this.setState(relId, value, true);
    if (field === "override" && value === true) {
      await this._startOverride(dev);
    } else if (field === "override" && value === false) {
      this._stopOverride(dev.id);
      await this.setState(`thermostat.devices.${dev.id}.overrideRemaining`, 0, true);
      await this._runControl(dev, deviceId);
    } else if (["overrideMode", "overrideTarget"].includes(field)) {
      // Nur wenn gerade ein Override läuft, sofort anwenden.
      if (this._overrideTimers.has(dev.id)) {
        await this._applyOverride(dev, false);
      }
    } else if (field === "overrideMinutes" && this._overrideTimers.has(dev.id)) {
      // Laufzeit aendern: Timer neu starten, verstrichene Zeit erhalten.
      await this._startOverride(dev);
    }
  }

  /**
   * Startet einen Override fuer ein Geraet: aktuelle Zielwerte auf das
   * Geraet schreiben, Timer setzen und verbleibende Minuten herunterzaehlen.
   */
  async _startOverride(dev) {
    const minutes = (await this.getStateAsync(`thermostat.devices.${dev.id}.overrideMinutes`))?.val ?? 60;
    const durationMs = Math.max(1, Math.min(1440, Number(minutes) || 60)) * 60_000;
    const endAt = Date.now() + durationMs;

    this._stopOverride(dev.id);

    await this._applyOverride(dev, true);

    const timer = this.setInterval(async () => {
      const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 60_000));
      await this.setState(`thermostat.devices.${dev.id}.overrideRemaining`, remaining, true);
      if (remaining <= 0) {
        this._stopOverride(dev.id);
        await this.setState(`thermostat.devices.${dev.id}.override`, false, true);
        await this.setState(`thermostat.devices.${dev.id}.overrideRemaining`, 0, true);
        await this.setState(`thermostat.globalOverride`, false, true);
        await this._runControl(dev, `device_${dev.id}`);
        this.log.info(`${dev.name}: Override abgelaufen - Automatik uebernommen`);
      }
    }, 60_000);

    this._overrideTimers.set(dev.id, { timer, endAt });
    await this.setState(`thermostat.devices.${dev.id}.overrideRemaining`, Math.ceil(durationMs / 60_000), true);
  }

  /**
   * Bricht den Override-Timer fuer ein Geraet ab.
   */
  _stopOverride(devId) {
    const entry = this._overrideTimers.get(devId);
    if (entry) {
      this.clearInterval(entry.timer);
      this._overrideTimers.delete(devId);
    }
  }

  /**
   * Wendet die Override-Parameter auf das Geraet an.
   */
  async _applyOverride(dev, setOverrideState = true) {
    const mode = (await this.getStateAsync(`thermostat.devices.${dev.id}.overrideMode`))?.val || "auto";
    const target =
      (await this.getStateAsync(`thermostat.devices.${dev.id}.overrideTarget`))?.val ?? CONTROL_DEFAULTS.target;
    const cmd = { power: true };
    if (mode !== "no change" && mode) {
      cmd.mode = mode;
    }
    if (typeof target === "number" && !Number.isNaN(target)) {
      cmd.targetTemperature = target;
    }
    try {
      await dev.write(cmd);
      // Gemerkten Override-Zustand auf die soeben geschriebenen Werte
      // setzen, damit eine Fernbedienungsaenderung korrekt erkannt wird.
      this._lastOverrideState.set(dev.id, {
        power: true,
        mode: cmd.mode || mode,
        targetTemperature: cmd.targetTemperature,
        fanSpeed: null,
        swing: null,
      });
      if (setOverrideState) {
        await this.setState(`thermostat.devices.${dev.id}.override`, true, true);
      }
      this.log.info(`${dev.name}: Override angewendet → ${JSON.stringify(cmd)}`);
    } catch (e) {
      this.log.warn(`${dev.name}: Override konnte nicht angewendet werden - ${e.message}`);
    }
  }

  /**
   * Setzt den globalen Override-Schalter fuer alle Geraete.
   */
  async _setGlobalOverride(value) {
    await this.setState("thermostat.globalOverride", value, true);
    for (const [devId, dev] of this.devices.entries()) {
      if (value) {
        await this.setState(`thermostat.devices.${devId}.override`, true, true);
        await this._startOverride(dev);
      } else {
        await this.setState(`thermostat.devices.${devId}.override`, false, true);
        await this.setState(`thermostat.devices.${devId}.overrideRemaining`, 0, true);
        this._stopOverride(devId);
        await this._runControl(dev, `device_${devId}`);
      }
    }
    this.log.info(`Override global ${value ? "aktiviert" : "deaktiviert"}`);
  }

  /**
   * Prueft, ob mindestens ein Geraet aktiv ist, und aktualisiert den
   * globalen Schalter entsprechend.
   */
  async _updateGlobalActiveFromDevices() {
    let anyActive = false;
    for (const devId of this.devices.keys()) {
      const active = (await this.getStateAsync(`device_${devId}.controlActive`))?.val === true;
      if (active) {
        anyActive = true;
        break;
      }
    }
    await this.setState("thermostat.globalActive", anyActive, true);
  }

  /**
   * Synchronisiert ein bestaetigtes device_* control-State auf die
   * zentrale Thermostat-Anzeige.
   */
  async _syncAckState(relId, value) {
    const match = relId.match(/^device_([^.]+)\.(controlActive|controlTarget|controlHysteresis)$/);
    if (!match) {
      return;
    }
    const devId = match[1];
    const channel = match[2];
    await this._syncDeviceControlToThermostat(devId, channel, value);
  }

  /**
   * Synchronisiert device_* control-States auf thermostat.devices.*.
   */
  async _syncDeviceControlToThermostat(devId, channel, value) {
    const mapping = { controlActive: "active", controlTarget: "target", controlHysteresis: "hysteresis" };
    const field = mapping[channel];
    if (!field) {
      return;
    }
    await this.setState(`thermostat.devices.${devId}.${field}`, value, true);
    await this._updateGlobalActiveFromDevices();
  }

  async _onUnload(callback) {
    if (this._pollTimer) {
      this.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    for (const entry of this._overrideTimers.values()) {
      this.clearInterval(entry.timer);
    }
    this._overrideTimers.clear();
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
