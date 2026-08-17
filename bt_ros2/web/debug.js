"use strict";

const ui = {
  connection: document.querySelector("#debug-connection"),
  mode: document.querySelector("#debug-mode"),
  scenario: document.querySelector("#debug-scenario"),
  tick: document.querySelector("#debug-tick"),
  root: document.querySelector("#debug-root"),
  overrideCount: document.querySelector("#debug-override-count"),
  revision: document.querySelector("#debug-revision"),
  session: document.querySelector("#debug-session"),
  scenarioSelect: document.querySelector("#scenario-select"),
  apply: document.querySelector("#apply-overrides"),
  clear: document.querySelector("#clear-overrides"),
  result: document.querySelector("#debug-result"),
  filter: document.querySelector("#condition-filter"),
  conditionList: document.querySelector("#condition-list"),
  conditionEmpty: document.querySelector("#condition-empty"),
  pause: document.querySelector("#pause-button"),
  resume: document.querySelector("#resume-button"),
  step: document.querySelector("#step-button"),
  reload: document.querySelector("#reload-button"),
};

const state = {
  conditions: [],
  controls: new Map(),
  pending: false,
  controlsInitialized: false,
  lastSession: "",
};

async function fetchJson(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  return payload;
}

function flatten(node) {
  return [node, ...node.children.flatMap(flatten)];
}

function setControl(key, value) {
  const row = state.controls.get(key);
  if (!row) return;
  for (const input of row.querySelectorAll("input")) input.checked = input.value === value;
  row.dataset.override = value;
}

function renderConditions() {
  ui.conditionList.replaceChildren();
  state.controls.clear();
  ui.conditionEmpty.classList.toggle("hidden", state.conditions.length !== 0);
  for (const node of state.conditions) {
    const row = document.createElement("div");
    row.className = "condition-row";
    row.dataset.key = node.key;
    row.dataset.override = "AUTO";

    const identity = document.createElement("div");
    identity.className = "condition-identity";
    const title = document.createElement("strong");
    title.textContent = node.instance_name;
    const metadata = document.createElement("span");
    metadata.textContent = `${node.key} | ${node.registration_name}`;
    identity.append(title, metadata);

    const status = document.createElement("span");
    status.className = "condition-status status-IDLE";
    status.textContent = "IDLE";

    const group = document.createElement("div");
    group.className = "override-segments";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", `${node.instance_name} 条件覆盖`);
    for (const [value, label] of [["AUTO", "Auto"], ["SUCCESS", "成功"], ["FAILURE", "失败"]]) {
      const option = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `override-${node.key}`;
      input.value = value;
      input.checked = value === "AUTO";
      input.addEventListener("change", () => {
        row.dataset.override = value;
        ui.scenarioSelect.value = "manual";
      });
      const text = document.createElement("span");
      text.textContent = label;
      option.append(input, text);
      group.append(option);
    }
    row.append(identity, status, group);
    state.controls.set(node.key, row);
    ui.conditionList.append(row);
  }
}

function selectedOverrides() {
  const overrides = {};
  for (const [key, row] of state.controls) {
    const value = row.querySelector("input:checked").value;
    if (value !== "AUTO") overrides[key] = value;
  }
  return overrides;
}

function applyScenario(scenario) {
  const value = scenario === "all_success" ? "SUCCESS" : scenario === "all_failure" ? "FAILURE" : "AUTO";
  for (const key of state.controls.keys()) setControl(key, value);
}

function renderRuntime(payload) {
  if (!payload.available || !payload.state) {
    ui.connection.textContent = "已连接，等待 debug 状态";
    return;
  }
  const runtime = payload.state;
  ui.connection.textContent = "已连接到隔离调试执行器";
  ui.mode.textContent = runtime.mode;
  ui.scenario.textContent = runtime.scenario_id;
  ui.tick.textContent = String(runtime.tick_seq);
  ui.overrideCount.textContent = String(Object.keys(runtime.overrides).length);
  ui.revision.textContent = runtime.tree_revision;
  ui.session.textContent = runtime.session_id;
  ui.pause.disabled = runtime.paused;
  ui.step.disabled = !runtime.paused;
  ui.resume.disabled = !runtime.paused;
  if (!state.controlsInitialized || state.lastSession !== runtime.session_id) {
    for (const key of runtime.condition_node_keys) setControl(key, runtime.overrides[key] || "AUTO");
    ui.scenarioSelect.value = ["all_auto", "all_success", "all_failure"].includes(runtime.scenario_id)
      ? runtime.scenario_id : "manual";
    state.controlsInitialized = true;
    state.lastSession = runtime.session_id;
  }
}

function renderSnapshot(payload) {
  if (!payload.available) return;
  ui.root.textContent = payload.snapshot.root_status;
  ui.root.className = `status-${payload.snapshot.root_status}`;
  for (const node of payload.snapshot.nodes) {
    const row = state.controls.get(node.key);
    if (!row) continue;
    const status = row.querySelector(".condition-status");
    status.textContent = node.status;
    status.className = `condition-status status-${node.status}`;
  }
}

async function poll() {
  try {
    const [runtime, snapshot] = await Promise.all([
      fetchJson("/api/v1/debug/state"),
      fetchJson("/api/v1/bt/snapshots/latest"),
    ]);
    renderRuntime(runtime);
    renderSnapshot(snapshot);
  } catch (error) {
    ui.connection.textContent = `已断开 / ${error.message}`;
  }
}

async function post(path, payload) {
  if (state.pending) return null;
  state.pending = true;
  for (const button of [ui.apply, ui.clear, ui.pause, ui.resume, ui.step, ui.reload]) button.disabled = true;
  try {
    return await fetchJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } finally {
    state.pending = false;
    ui.apply.disabled = false;
    ui.clear.disabled = false;
    ui.reload.disabled = false;
    await poll();
  }
}

async function submitOverrides(scenarioId, overrides) {
  ui.result.textContent = "正在应用";
  try {
    const result = await post("/api/v1/debug/overrides", { scenario_id: scenarioId, overrides });
    if (result) {
      ui.result.textContent = result.message;
      state.controlsInitialized = true;
    }
  } catch (error) {
    ui.result.textContent = `拒绝 / ${error.message}`;
  }
}

async function control(action) {
  ui.result.textContent = `正在${{ pause: "暂停", resume: "继续", step: "单步", reload: "重载" }[action]}`;
  try {
    const result = await post("/api/v1/debug/control", { action });
    if (result) ui.result.textContent = result.message;
  } catch (error) {
    ui.result.textContent = `失败 / ${error.message}`;
  }
}

function filterConditions() {
  const query = ui.filter.value.trim().toLowerCase();
  for (const [key, row] of state.controls) {
    row.hidden = Boolean(query) && !`${key} ${row.textContent}`.toLowerCase().includes(query);
  }
}

async function boot() {
  try {
    const structure = await fetchJson("/api/v1/bt/structure");
    state.conditions = flatten(structure.root).filter((node) => node.kind === "Condition");
    renderConditions();
    await poll();
  } catch (error) {
    ui.connection.textContent = `已断开 / ${error.message}`;
  }
  window.setInterval(poll, 300);
}

ui.scenarioSelect.addEventListener("change", () => applyScenario(ui.scenarioSelect.value));
ui.apply.addEventListener("click", () => submitOverrides(ui.scenarioSelect.value || "manual", selectedOverrides()));
ui.clear.addEventListener("click", () => {
  ui.scenarioSelect.value = "all_auto";
  applyScenario("all_auto");
  submitOverrides("all_auto", {});
});
ui.pause.addEventListener("click", () => control("pause"));
ui.resume.addEventListener("click", () => control("resume"));
ui.step.addEventListener("click", () => control("step"));
ui.reload.addEventListener("click", () => control("reload"));
ui.filter.addEventListener("input", filterConditions);

boot();
