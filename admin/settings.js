"use strict";

let gSettings = {};
let gOnChange = null;
const gPasswordPlaceholder = "••••••";

const DEVICE_TYPES = [
  { label: "Midea", value: "midea" },
  { label: "Tuya", value: "tuya" },
];

const SEASON_MODES = [
  { label: "Auto", value: "auto" },
  { label: "Summer", value: "summer" },
  { label: "Winter", value: "winter" },
];

const MODES = [
  { label: "Auto", value: "auto" },
  { label: "Cool", value: "cool" },
  { label: "Heat", value: "heat" },
  { label: "Dry", value: "dry" },
  { label: "Fan", value: "fan" },
];

const FAN_SPEEDS = [
  { label: "Auto", value: "auto" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

const SWINGS = [
  { label: "Off", value: "off" },
  { label: "Vertical", value: "vertical" },
  { label: "Horizontal", value: "horizontal" },
  { label: "Both", value: "both" },
];

const WEEKDAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"];

function createSelect(options, value, cls, onChangeFn) {
  const sel = document.createElement("select");
  if (cls) {
    sel.className = cls;
  }
  options.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) {
      o.selected = true;
    }
    sel.appendChild(o);
  });
  sel.addEventListener("change", onChangeFn);
  return sel;
}

function createInput(type, value, cls, attrs, onChangeFn) {
  const inp = document.createElement("input");
  inp.type = type;
  if (cls) {
    inp.className = cls;
  }
  inp.value = value !== undefined && value !== null ? value : "";
  if (attrs) {
    Object.entries(attrs).forEach(([k, v]) => inp.setAttribute(k, v));
  }
  inp.addEventListener("input", onChangeFn);
  inp.addEventListener("change", onChangeFn);
  return inp;
}

function createCheckbox(checked, cls, onChangeFn) {
  const label = document.createElement("label");
  const span = document.createElement("span");
  const inp = document.createElement("input");
  inp.type = "checkbox";
  if (cls) {
    inp.className = cls;
  }
  inp.checked = !!checked;
  inp.addEventListener("change", () => {
    onChangeFn();
  });
  label.appendChild(inp);
  label.appendChild(span);
  return label;
}

function createObjectIdInput(value, cls, onChangeFn) {
  const wrap = document.createElement("div");
  wrap.className = "object-id-wrap";

  const inp = document.createElement("input");
  inp.type = "text";
  if (cls) {
    inp.className = cls;
  }
  inp.value = value !== undefined && value !== null ? value : "";
  inp.readOnly = true;
  inp.title = inp.value || "Objekt-ID wählen";
  inp.placeholder = "Objekt-ID";
  inp.addEventListener("change", onChangeFn);
  wrap.appendChild(inp);

  const btn = document.createElement("a");
  btn.className = "btn-icon object-id-btn waves-effect waves-light grey";
  btn.innerHTML = '<i class="material-icons">search</i>';
  btn.title = "Objekt-ID auswählen";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    const current = inp.value;
    const applyId = (id) => {
      if (id !== undefined && id !== null && String(id).trim() !== "") {
        inp.value = id;
        inp.title = id;
        onChangeFn();
        if (typeof window !== "undefined" && window.M && window.M.updateTextFields) {
          window.M.updateTextFields();
        }
      }
    };
    // Use ioBroker's native select dialog if available (defined by
    // /js/adapter-settings.js). The bare identifier may sit on window in
    // the admin frame, where adapter-settings.js registers it globally.
    const resolve = () => {
      if (typeof showSelectIdDialog === "function") {
        return showSelectIdDialog;
      }
      if (typeof window !== "undefined" && typeof window.showSelectIdDialog === "function") {
        return window.showSelectIdDialog;
      }
      return null;
    };
    const dialogFn = resolve();
    if (dialogFn) {
      try {
        dialogFn(current, (id) => applyId(id));
        return;
      } catch {
        /* fall through */
      }
    }
    // Last resort: plain browser prompt.
    const id = window.prompt("Objekt-ID eingeben:", current);
    if (id !== null) {
      applyId(id);
    }
  });
  wrap.appendChild(btn);
  return wrap;
}

function triggerChange() {
  if (typeof gOnChange === "function") {
    gOnChange(true);
  }
}

function getDeviceNames() {
  const devices = Array.isArray(gSettings.devices) ? gSettings.devices : [];
  return devices.filter((d) => d && d.name).map((d) => d.name);
}

function wrap(el) {
  const td = document.createElement("td");
  td.appendChild(el);
  return td;
}

function refreshMaterialize() {
  if (window.M && window.M.updateTextFields) {
    window.M.updateTextFields();
  }
}

function renderDevices() {
  const tbody = document.querySelector("#devices-table tbody");
  tbody.innerHTML = "";
  const devices = Array.isArray(gSettings.devices) ? gSettings.devices : [];
  devices.forEach((dev, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);

    const onChangeFn = () => {
      devices[idx].name = tr.querySelector(".dev-name").value;
      devices[idx].type = tr.querySelector(".dev-type").value;
      devices[idx].id = tr.querySelector(".dev-id").value;
      devices[idx].host = tr.querySelector(".dev-host").value;
      devices[idx].port = parseInt(tr.querySelector(".dev-port").value, 10) || 6444;
      const tokenIn = tr.querySelector(".dev-token").value;
      if (tokenIn !== gPasswordPlaceholder) {
        devices[idx].token = tokenIn;
      }
      const keyIn = tr.querySelector(".dev-key").value;
      if (keyIn !== gPasswordPlaceholder) {
        devices[idx].key = keyIn;
      }
      const localKeyIn = tr.querySelector(".dev-localKey").value;
      if (localKeyIn !== gPasswordPlaceholder) {
        devices[idx].localKey = localKeyIn;
      }
      devices[idx].seasonMode = tr.querySelector(".dev-season").value;
      devices[idx].version = tr.querySelector(".dev-version").value;
      devices[idx].controlActive = tr.querySelector(".dev-ctrl").checked;
      devices[idx].controlTarget = parseFloat(tr.querySelector(".dev-target").value) || 22;
      devices[idx].controlHysteresis = parseFloat(tr.querySelector(".dev-hyst").value) || 0.5;
      devices[idx].controlSensor = tr.querySelector(".dev-sensor").value;
      triggerChange();
    };

    const fields = [
      ["td", createInput("text", dev.name, "dev-name", {}, onChangeFn)],
      ["td", createSelect(DEVICE_TYPES, dev.type, "dev-type", onChangeFn)],
      ["td", createInput("text", dev.id, "dev-id", {}, onChangeFn)],
      ["td", createInput("text", dev.host, "dev-host", {}, onChangeFn)],
      ["td", createInput("number", dev.port, "dev-port", { min: 1, max: 65535 }, onChangeFn)],
      ["td", createInput("password", dev.token ? gPasswordPlaceholder : "", "dev-token", {}, onChangeFn)],
      ["td", createInput("password", dev.key ? gPasswordPlaceholder : "", "dev-key", {}, onChangeFn)],
      ["td", createInput("password", dev.localKey ? gPasswordPlaceholder : "", "dev-localKey", {}, onChangeFn)],
      ["td", createSelect(SEASON_MODES, dev.seasonMode, "dev-season", onChangeFn)],
      ["td", createInput("text", dev.version, "dev-version", {}, onChangeFn)],
      ["td", createCheckbox(dev.controlActive, "dev-ctrl", onChangeFn)],
      ["td", createInput("number", dev.controlTarget, "dev-target", { min: 16, max: 31, step: 0.5 }, onChangeFn)],
      ["td", createInput("number", dev.controlHysteresis, "dev-hyst", { min: 0, max: 5, step: 0.1 }, onChangeFn)],
      ["td", createObjectIdInput(dev.controlSensor, "dev-sensor", onChangeFn)],
    ];

    fields.forEach(([, el]) => {
      const td = document.createElement("td");
      td.appendChild(el);
      tr.appendChild(td);
    });

    const delTd = document.createElement("td");
    const delBtn = document.createElement("a");
    delBtn.className = "btn-small btn-icon waves-effect waves-light red";
    delBtn.innerHTML = '<i class="material-icons">delete</i>';
    delBtn.addEventListener("click", () => {
      devices.splice(idx, 1);
      renderDevices();
      renderSchedules();
      triggerChange();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    tbody.appendChild(tr);
  });
  refreshMaterialize();
}

function renderSchedules() {
  const tbody = document.querySelector("#schedules-table tbody");
  tbody.innerHTML = "";
  const schedules = Array.isArray(gSettings.schedules) ? gSettings.schedules : [];
  const deviceNames = getDeviceNames();

  schedules.forEach((entry, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);

    const onChangeFn = () => {
      schedules[idx].deviceName = tr.querySelector(".sch-device").value;
      schedules[idx].name = tr.querySelector(".sch-name").value;
      schedules[idx].temperatureSensor = tr.querySelector(".sch-temp").value;
      schedules[idx].presenceSensor = tr.querySelector(".sch-pres").value;
      schedules[idx].active = tr.querySelector(".sch-active").checked;
      WEEKDAYS.forEach((day) => {
        const selClass = `.sch-${day}`;
        schedules[idx][day] = tr.querySelector(selClass).checked;
      });
      schedules[idx].start = tr.querySelector(".sch-start").value;
      schedules[idx].end = tr.querySelector(".sch-end").value;
      schedules[idx].mode = tr.querySelector(".sch-mode").value;
      schedules[idx].target = parseFloat(tr.querySelector(".sch-target").value) || 22;
      schedules[idx].fanSpeed = tr.querySelector(".sch-fan").value;
      schedules[idx].swing = tr.querySelector(".sch-swing").value;
      triggerChange();
    };

    const devTd = document.createElement("td");
    const devSel = document.createElement("select");
    devSel.className = "sch-device";
    deviceNames.forEach((name) => {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      if (name === entry.deviceName) {
        o.selected = true;
      }
      devSel.appendChild(o);
    });
    devSel.addEventListener("change", onChangeFn);
    devTd.appendChild(devSel);
    tr.appendChild(devTd);

    tr.appendChild(wrap(createInput("text", entry.name, "sch-name", {}, onChangeFn)));
    tr.appendChild(wrap(createObjectIdInput(entry.temperatureSensor, "sch-temp", onChangeFn)));
    tr.appendChild(wrap(createObjectIdInput(entry.presenceSensor, "sch-pres", onChangeFn)));

    const activeTd = document.createElement("td");
    activeTd.className = "center";
    activeTd.appendChild(createCheckbox(entry.active, "sch-active", onChangeFn));
    tr.appendChild(activeTd);

    WEEKDAYS.forEach((day) => {
      const td = document.createElement("td");
      td.className = "weekday-cell";
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const cbClass = `sch-${day}`;
      cb.className = cbClass;
      cb.checked = !!entry[day];
      cb.addEventListener("change", onChangeFn);
      const span = document.createElement("span");
      label.appendChild(cb);
      label.appendChild(span);
      td.appendChild(label);
      tr.appendChild(td);
    });

    tr.appendChild(wrap(createInput("text", entry.start, "sch-start", { placeholder: "06:00" }, onChangeFn)));
    tr.appendChild(wrap(createInput("text", entry.end, "sch-end", { placeholder: "22:00" }, onChangeFn)));
    tr.appendChild(wrap(createSelect(MODES, entry.mode, "sch-mode", onChangeFn)));
    tr.appendChild(
      wrap(createInput("number", entry.target, "sch-target", { min: 16, max: 31, step: 0.5 }, onChangeFn)),
    );
    tr.appendChild(wrap(createSelect(FAN_SPEEDS, entry.fanSpeed, "sch-fan", onChangeFn)));
    tr.appendChild(wrap(createSelect(SWINGS, entry.swing, "sch-swing", onChangeFn)));

    const delTd = document.createElement("td");
    const delBtn = document.createElement("a");
    delBtn.className = "btn-small btn-icon waves-effect waves-light red";
    delBtn.innerHTML = '<i class="material-icons">delete</i>';
    delBtn.addEventListener("click", () => {
      schedules.splice(idx, 1);
      renderSchedules();
      triggerChange();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    tbody.appendChild(tr);
  });
  refreshMaterialize();
}

function addDevice() {
  if (!Array.isArray(gSettings.devices)) {
    gSettings.devices = [];
  }
  gSettings.devices.push({
    name: "",
    type: "midea",
    id: "",
    host: "",
    port: 6444,
    token: "",
    key: "",
    localKey: "",
    seasonMode: "auto",
    version: "",
    controlActive: false,
    controlTarget: 22,
    controlHysteresis: 0.5,
    controlSensor: "",
  });
  renderDevices();
  triggerChange();
}

function addSchedule() {
  if (!Array.isArray(gSettings.schedules)) {
    gSettings.schedules = [];
  }
  const names = getDeviceNames();
  gSettings.schedules.push({
    deviceName: names[0] || "",
    name: "",
    temperatureSensor: "",
    presenceSensor: "",
    active: true,
    mo: true,
    tu: true,
    we: true,
    th: true,
    fr: true,
    sa: true,
    su: true,
    start: "06:00",
    end: "22:00",
    mode: "auto",
    target: 22,
    fanSpeed: "auto",
    swing: "off",
  });
  renderSchedules();
  triggerChange();
}

function load(settings, onChange) {
  gSettings = JSON.parse(JSON.stringify(settings || {}));
  gOnChange = onChange;

  if (gSettings.pollInterval === undefined) {
    gSettings.pollInterval = 30;
  }
  if (gSettings.summerMonths === undefined) {
    gSettings.summerMonths = "5,6,7,8,9";
  }
  if (gSettings.globalThermostatActive === undefined) {
    gSettings.globalThermostatActive = false;
  }
  if (gSettings.globalOverrideActive === undefined) {
    gSettings.globalOverrideActive = false;
  }
  if (gSettings.defaultOverrideMinutes === undefined) {
    gSettings.defaultOverrideMinutes = 60;
  }
  if (gSettings.defaultOverrideMode === undefined) {
    gSettings.defaultOverrideMode = "auto";
  }
  if (gSettings.defaultOverrideTarget === undefined) {
    gSettings.defaultOverrideTarget = 22;
  }
  if (!Array.isArray(gSettings.devices)) {
    gSettings.devices = [];
  }
  if (!Array.isArray(gSettings.schedules)) {
    gSettings.schedules = [];
  }

  document.getElementById("pollInterval").value = gSettings.pollInterval;
  document.getElementById("summerMonths").value = gSettings.summerMonths;
  document.getElementById("globalThermostatActive").checked = gSettings.globalThermostatActive;
  document.getElementById("globalOverrideActive").checked = gSettings.globalOverrideActive;
  document.getElementById("defaultOverrideMinutes").value = gSettings.defaultOverrideMinutes;
  document.getElementById("defaultOverrideMode").value = gSettings.defaultOverrideMode;
  document.getElementById("defaultOverrideTarget").value = gSettings.defaultOverrideTarget;

  document.querySelectorAll(".value").forEach((el) => {
    el.addEventListener("input", triggerChange);
    el.addEventListener("change", triggerChange);
  });

  renderDevices();
  renderSchedules();

  document.getElementById("btn-add-device").addEventListener("click", addDevice);
  document.getElementById("btn-add-schedule").addEventListener("click", addSchedule);

  if (window.M && window.M.Tabs) {
    window.M.Tabs.init(document.querySelectorAll(".tabs"));
  }
  refreshMaterialize();

  if (typeof window.onChange === "function") {
    window.onChange(false);
  } else if (typeof onChange === "function") {
    onChange(false);
  }
}

function save(callback) {
  gSettings.pollInterval = parseInt(document.getElementById("pollInterval").value, 10) || 30;
  gSettings.summerMonths = document.getElementById("summerMonths").value;
  gSettings.globalThermostatActive = document.getElementById("globalThermostatActive").checked;
  gSettings.globalOverrideActive = document.getElementById("globalOverrideActive").checked;
  gSettings.defaultOverrideMinutes = parseInt(document.getElementById("defaultOverrideMinutes").value, 10) || 60;
  gSettings.defaultOverrideMode = document.getElementById("defaultOverrideMode").value;
  gSettings.defaultOverrideTarget = parseFloat(document.getElementById("defaultOverrideTarget").value) || 22;

  callback(gSettings);
}

window.load = load;
window.save = save;
