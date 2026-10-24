"use strict";

/**
 * Tuya-Backend: kapselt das lokale Tuya-LAN-Protokoll (tuyapi, MIT)
 * und mappt die Klimanlagen-DPs auf das einheitliche Klimadaten-Modell.
 *
 * DP-Schema (Klimageräte):
 *   1  Power            (bool, rw)
 *   2  temp_set         (value, rw)  Zieltemperatur in °C
 *   3  temp_current     (value, ro)  Ist-Temperature in °C
 *   4  mode             (enum,  rw)  cold|hot|wet|wind|auto
 *   5  windspeed        (enum,  rw)  je nach Gerät unterschiedlich kodiert
 *   8  mode_ECO         (bool, rw)
 *   12 heat             (bool, rw)  Aux-Heizung
 *   18 humidity_current(value, ro)  nur Steffi EG
 *   19 temp_unit_convert(enum,  rw)  c|f
 *   23 temp_current_f   (value, ro)
 *   24 temp_set_f       (value, rw)
 *   101 mode_sleep      (bool, rw)
 *   104 screen          (bool, rw)
 *   106 wind_vertical   (bool, rw)
 *   107 wind_horizontal (bool, rw)
 *   108 model_report    (bitmap, ro)
 *   109 fault_1         (bitmap, ro)
 *   110 fault_2         (bitmap, ro)
 *
 * WICHTIG - Protokoll-Details, live verifiziert am 22.10.2026:
 *
 *  1. tuyapi.get() loest bei Tuya-Klimageraeten NICHT auf (Timeout). Der
 *     Status kommt stattdessen unaufgefordert ueber das 'data'-Event, das
 *     das Geraet direkt nach dem Verbindungsaufbau sendet. Deshalb wird
 *     hier ausschliesslich ereignisbasiert gelesen.
 *
 *  2. Die Protokollversion ist nicht bei allen Geraeten gleich:
 *     Buero Keller antwortet nur auf 3.5 (auf 3.3: ECONNRESET),
 *     Steffi EG nur auf 3.3 (auf 3.5: ECONNRESET).
 *     Deshalb wird die Version beim Verbinden automatisch ermittelt.
 *
 *  3. Ein Geraet akzeptiert nur EINE gleichzeitige TCP-Verbindung. Der
 *     tuya.0-Adapter muss dafuer gestoppt sein, sonst liefert das
 *     fremde Geraet ECONNRESET.
 *
 *  4. Die beiden Geraetetypen nutzen unterschiedliche Kodierungen:
 *     - Buero Keller (Protokoll 2.3): DP2 temp_set scale=0 (16..32),
 *       DP5 windspeed = "1".."5"
 *     - Steffi EG    (Protokoll 2.2): DP2 temp_set scale=1 (160..880),
 *       DP5 windspeed = "strong"|"high"|"mid_high"|"mid"|"mid_low"|
 *                                    "low"|"mute"|"auto"
 *     Beide werden transparent auf das einheitliche Modell abgebildet.
 */

const TuyaDevice = require("tuyapi");

/** Tuya-Modus -> einheitlicher Modus. */
const MODE_MAP = {
    cold: "cool",
    hot: "heat",
    wet: "dry",
    wind: "fan",
    auto: "auto",
};

/** Einheitlicher Modus -> Tuya-Modus. */
const MODE_REVERSE = {
    auto: "auto",
    cool: "cold",
    heat: "hot",
    dry: "wet",
    fan: "wind",
};

/**
 * Luefterstufen -> einheitliche Luftstromstaerke.
 * Deckt die numerische (1..5) und die benannte Kodierung ab.
 */
const FAN_MAP = {
    // numerische Kodierung
    1: "low",
    2: "medium",
    3: "high",
    4: "auto",
    5: "auto",
    // benannte Kodierung
    mute: "low",
    low: "low",
    mid_low: "low",
    mid: "medium",
    mid_high: "medium",
    high: "high",
    strong: "high",
    auto: "auto",
};

/** Einheitliche Luftstromstaerke -> Tuya-Wert (numerische Kodierung). */
const FAN_REVERSE = {
    low: 1,
    medium: 2,
    high: 3,
    auto: 4,
};

/** Einheitliche Luftstromstaerke -> Tuya-Wert (benannte Kodierung). */
const FAN_REVERSE_NAMED = {
    low: "low",
    medium: "mid",
    high: "high",
    auto: "auto",
};

// const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class TuyaClimateDevice {
    /**
     * @param {object} cfg Geraete-Konfiguration
     * @param {object} log ioBroker-Logger
     */
    constructor(cfg, log, adapter) {
        this.cfg = cfg;
        this.log = log || console;
        this._adapter = adapter || null;
        this.type = "tuya";
        this.id = cfg.id;
        this.name = cfg.name || cfg.id;
        this.host = cfg.host;
        this.port = cfg.port || 6668;
        this.localKey = cfg.localKey;
        this.online = false;
        this._device = null;
        this._dps = {};
        this._dataPromise = null;
        this._resolveData = null;
        // Geraetespezifische Kodierung, wird beim ersten Lesen erkannt.
        this._tempScale = 1;
        this._fanNamed = false;
    }

    /** Warte-Helfer: nutzt adapter.delay() falls vorhanden, sonst globalen setTimeout. */
    _delay(ms) {
        if (this._adapter && typeof this._adapter.delay === "function") {
            return this._adapter.delay(ms);
        }
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Protokollversionen in der Reihenfolge, wie sie probiert werden. */
    _versionCandidates() {
        const preferred = this.cfg.version || "3.3";
        return [...new Set([preferred, "3.3", "3.5", "3.4", "3.2"])];
    }

    /**
     * Verbindung herstellen und die Protokollversion ermitteln.
     * Ein Geraet antwortet nur auf bestimmte Protokollversionen - deshalb
     * wird solange probiert, bis einmal Statusdaten ankommen.
     */
    async connect() {
        const versions = this._versionCandidates();
        let lastError = null;

        for (const version of versions) {
            try {
                this._device = new TuyaDevice({
                    id: this.id,
                    key: this.localKey,
                    ip: this.host,
                    port: this.port,
                    version,
                    nullPayloadOnJSONError: true,
                });
                this._device.on("error", err => {
                    this.log.debug(`[${this.name}] Socket-Fehler: ${err && err.message}`);
                });
                this._device.on("data", data => {
                    if (data && data.dps) {
                        this._dps = data.dps;
                        if (this._resolveData) {
                            this._resolveData(this._dps);
                            this._resolveData = null;
                            this._dataPromise = null;
                        }
                    }
                });

                await this._device.connect();

                // Auf den Status warten - er kommt unaufgefordert nach dem Connect.
                const dps = await this._waitForData(5000);
                if (dps) {
                    this.online = true;
                    this._detectEncoding(dps);
                    this.log.debug(`[${this.name}] verbunden (Protokoll ${version})`);
                    return this;
                }
                lastError = new Error(`keine Statusdaten (Protokoll ${version})`);
            } catch (err) {
                lastError = err;
            }
            await this._teardown();
        }

        throw new Error(
            `Verbindung zu ${this.name} (${this.host}) fehlgeschlagen: ${lastError && lastError.message}`,
        );
    }

    /**
     * Geraetespezifische Kodierung aus den Rohdaten ableiten.
     * - Temperaturskala: Werte ueber 100 bedeuten Zehntelgrad (scale=1)
     * - Luefter: Zeichenketten-Werte bedeuten die benannte Enum
     */
    _detectEncoding(dps) {
        const temp = Number(dps["2"]);
        if (Number.isFinite(temp) && temp > 100) {
            this._tempScale = 10;
        }
        const fan = dps["5"];
        if (typeof fan === "string" && !/^\d+$/.test(fan)) {
            this._fanNamed = true;
        }
    }

    /** Wartet auf das naechste 'data'-Event, gibt die DPs oder null zurueck. */
    _waitForData(timeoutMs) {
        if (Object.keys(this._dps).length) {
            return Promise.resolve(this._dps);
        }
        this._dataPromise = new Promise(resolve => {
            this._resolveData = resolve;
        });
        return Promise.race([this._dataPromise, this._delay(timeoutMs).then(() => null)]).then(dps => {
            this._dataPromise = null;
            this._resolveData = null;
            return dps;
        });
    }

    async _teardown() {
        if (this._device) {
            try {
                this._device.disconnect();
            } catch {
                /* ignorieren */
            }
            try {
                this._device.destroy();
            } catch {
                /* ignorieren */
            }
            this._device = null;
        }
    }

    async disconnect() {
        this.online = false;
        this._dps = {};
        await this._teardown();
    }

    /**
     * Status lesen und auf das einheitliche Modell abbilden.
     * @returns {Promise<object>}
     */
    async read() {
        if (!this._device) {
            await this.connect();
        }
        // Aktiv frische Daten anfordern; null-Werte bei multiple:true
        // loesen bei Tuya-Klimageraeten ein query-Event aus.
        try {
            this._resolveData = null;
            this._dataPromise = null;
            await this._device.set({
                multiple: true,
                data: { '1': null, '2': null, '3': null, '4': null, '5': null },
                shouldWaitForResponse: false,
            });
        } catch (e) {
            this.log.debug(`[${this.name}] refresh query failed: ${e.message}`);
        }

        const dps = (await this._waitForData(5000)) || this._dps;
        this._detectEncoding(dps);

        const out = { online: true };
        if (dps["1"] !== undefined) {
            out.power = !!dps["1"];
        }
        if (dps["4"] !== undefined) {
            out.mode = MODE_MAP[String(dps["4"])] || "auto";
        }
        if (dps["5"] !== undefined) {
            out.fanSpeed = FAN_MAP[Number(dps["5"])] || FAN_MAP[String(dps["5"])] || "auto";
        }
        if (dps["2"] !== undefined) {
            out.targetTemperature = Number(dps["2"]) / this._tempScale;
        }
        if (dps["3"] !== undefined) {
            out.currentTemperature = Number(dps["3"]);
        }
        if (dps["18"] !== undefined) {
            out.humidity = Number(dps["18"]);
        }
        // Schwenkrichtung aus den beiden Richtungs-DPs ableiten.
        const vertical = dps["106"] !== undefined ? !!dps["106"] : undefined;
        const horizontal = dps["107"] !== undefined ? !!dps["107"] : undefined;
        if (vertical !== undefined || horizontal !== undefined) {
            if (vertical && horizontal) {
                out.swing = "both";
            } else if (vertical) {
                out.swing = "vertical";
            } else if (horizontal) {
                out.swing = "horizontal";
            } else {
                out.swing = "off";
            }
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
        const state = {};
        if (cmd.power !== undefined) {
            state["1"] = !!cmd.power;
        }
        if (cmd.mode !== undefined && MODE_REVERSE[cmd.mode]) {
            state["4"] = MODE_REVERSE[cmd.mode];
        }
        if (cmd.targetTemperature !== undefined) {
            state["2"] = Math.round(cmd.targetTemperature * this._tempScale);
        }
        if (cmd.fanSpeed !== undefined) {
            const table = this._fanNamed ? FAN_REVERSE_NAMED : FAN_REVERSE;
            if (table[cmd.fanSpeed] !== undefined) {
                state["5"] = table[cmd.fanSpeed];
            }
        }
        if (cmd.swing !== undefined) {
            state["106"] = cmd.swing === "vertical" || cmd.swing === "both";
            state["107"] = cmd.swing === "horizontal" || cmd.swing === "both";
        }
        if (Object.keys(state).length) {
            // tuyapi.set() erwartet {multiple:true, data:{...}} und wartet
            // standardmaessig auf eine Status-Antwort. Einige Geraete (z. B.
            // verschlusselte/Mesh-Tuya-Klimas im Keller) bestaetigen den Set-
            // Befehl nicht direkt. shouldWaitForResponse:false schickt den
            // Befehl und loest sofort auf; der naechste Poll prueft Erfolg.
            this.log.debug(`[${this.name}] WRITE cmd=${JSON.stringify(cmd)} state=${JSON.stringify(state)} scale=${this._tempScale}`);
            try {
                await this._device.set({
                    multiple: true,
                    data: state,
                    shouldWaitForResponse: false,
                });
                this.log.debug(`[${this.name}] WRITE sent successfully`);
            } catch (e) {
                this.log.warn(`[${this.name}] WRITE failed: ${e.message}`);
                throw e;
            }
        } else {
            this.log.debug(`[${this.name}] WRITE no state keys (cmd=${JSON.stringify(cmd)})`);
        }
    }
}

module.exports = {
    TuyaClimateDevice,
    MODE_MAP,
    MODE_REVERSE,
    FAN_MAP,
    FAN_REVERSE,
    FAN_REVERSE_NAMED,
};
