import cfg from "@iobroker/eslint-config";

const parts = Array.isArray(cfg) ? cfg : [cfg];
for (const part of parts) {
  if (part.rules) {
    for (const key of Object.keys(part.rules)) {
      if (key.startsWith("jsdoc")) {
        part.rules[key] = "off"; // jsdoc-Pflicht ab Version 0.2 (separater Doku-Lauf)
      }
    }
  }
}

export default [
  ...parts.map((part) => ({
    ...part,
    // lib/midea ist uebernommener Fremdcode (MIT, TA2k/ioBroker.midea).
    // Er wird 1:1 weitergegeben und bewusst nicht umformatiert, damit der
    // Vergleich mit dem Original erhalten bleibt.
    ignores: [...(part.ignores || []), "lib/midea/**"],
  })),
  {
    files: ["admin/*.js"],
    languageOptions: {
      globals: {
        onChange: "readonly",
        document: "readonly",
        gOnChange: "readonly",
        systemDictionary: "writable",
        showSelectIdDialog: "readonly",
        window: "readonly",
      },
    },
  },
];
