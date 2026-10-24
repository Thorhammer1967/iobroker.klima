"use strict";

/**
 * Live-Test gegen die echten Geraete im Heimnetz.
 * Nur lesend - es wird kein Befehl an die Geraete geschickt.
 *
 * Aufruf: node test/live.js
 */

const { MideaDevice } = require("../lib/mideaDevice");
const { TuyaClimateDevice } = require("../lib/tuyaDevice");

// Zugangsdaten werden aus Umgebungsvariablen gelesen, damit sie nicht
// im Quellcode stehen. Siehe .env.example / test/README.
const DEVICES = [
  {
    type: "midea",
    name: "KLIM_Joerg",
    id: "152832117075703",
    host: "192.168.178.26",
    port: 6444,
    token: process.env.MIDEA_TOKEN,
    key: process.env.MIDEA_KEY,
  },
  {
    type: "midea",
    name: "KLIM_Wohn_Sabrina",
    id: "152832117071381",
    host: "192.168.178.50",
    port: 6444,
    token: process.env.MIDEA_TOKEN2,
    key: process.env.MIDEA_KEY2,
  },
  {
    type: "midea",
    name: "KLI_Schlaf_Sabrina",
    id: "152832117070604",
    host: "192.168.178.63",
    port: 6444,
    token: process.env.MIDEA_TOKEN3,
    key: process.env.MIDEA_KEY3,
  },
  {
    type: "midea",
    name: "KLIMA_Wohnzimmer SJ",
    id: "153931628695845",
    host: "192.168.178.90",
    port: 6444,
    token: process.env.MIDEA_TOKEN4,
    key: process.env.MIDEA_KEY4,
  },
  {
    type: "tuya",
    name: "Klima Buero Keller",
    id: "bf69e14158b459a286c6fy",
    host: "192.168.178.87",
    port: 6668,
    localKey: process.env.TUYA_LOCALKEY,
    version: "3.3",
  },
  {
    type: "tuya",
    name: "Schlafzimmer Klima Steffi EG",
    id: "45538860e8db84f0e805",
    host: "192.168.178.87",
    port: 6668,
    localKey: process.env.TUYA_LOCALKEY2,
    version: "3.3",
  },
];

(async () => {
  let ok = 0;
  let fail = 0;
  for (const cfg of DEVICES) {
    const dev =
      cfg.type === "tuya"
        ? new TuyaClimateDevice(cfg, { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} })
        : new MideaDevice(cfg, { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
    try {
      await dev.connect();
      const status = await dev.read();
      console.log(`OK   ${cfg.name.padEnd(26)} ${JSON.stringify(status)}`);
      ok++;
    } catch (e) {
      console.log(`FAIL ${cfg.name.padEnd(26)} ${e.message}`);
      fail++;
    } finally {
      try {
        await dev.disconnect();
      } catch {
        /* ignorieren */
      }
    }
  }
  console.log(`\n${ok} Geraet(e) lesbar, ${fail} Fehler`);
  process.exit(fail ? 1 : 0);
})();
