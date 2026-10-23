"use strict";

/**
 * Einheitliches Klimadaten-Modell.
 *
 * Der Adapter praesentiert alle Geraete (Midea + Tuya) ueber identische
 * State-Namen, damit HA/Automatisierungen herstellerunabhaengig arbeiten.
 */

/** Kanaele unterhalb eines Geraete-Datenpunkts. */
const CHANNELS = {
  power: { type: "boolean", role: "switch", name: "Power" },
  mode: { type: "string", role: "enum", name: "Mode" },
  targetTemperature: { type: "number", role: "level.temperature", unit: "°C", name: "Target temperature" },
  currentTemperature: { type: "number", role: "value.temperature", unit: "°C", name: "Current temperature" },
  fanSpeed: { type: "string", role: "enum", name: "Fan speed" },
  swing: { type: "string", role: "enum", name: "Swing" },
  humidity: { type: "number", role: "value.humidity", unit: "%", name: "Humidity" },
  online: { type: "boolean", role: "indicator.reachable", name: "Online" },
};

/** Unterstuetzte Betriebsarten (identisch fuer alle Hersteller). */
const MODES = ["auto", "cool", "heat", "dry", "fan"];

/** Unterstuetzte Luftstromstaerken. */
const FAN_SPEEDS = ["auto", "low", "medium", "high"];

/** Unterstuetzte Schwenkrichtungen. */
const SWINGS = ["off", "vertical", "horizontal", "both"];

const MODE_VALUES = {
  auto: 0,
  cool: 1,
  heat: 2,
  dry: 3,
  fan: 4,
};

const FAN_VALUES = {
  auto: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const SWING_VALUES = {
  off: 0,
  vertical: 1,
  horizontal: 2,
  both: 3,
};

module.exports = {
  CHANNELS,
  MODES,
  FAN_SPEEDS,
  SWINGS,
  MODE_VALUES,
  FAN_VALUES,
  SWING_VALUES,
};
