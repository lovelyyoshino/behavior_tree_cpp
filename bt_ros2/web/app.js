"use strict";

const ui = {
  connection: document.querySelector("#connection-label"),
  treeId: document.querySelector("#tree-id"),
  tick: document.querySelector("#tick-sequence"),
  rootStatus: document.querySelector("#root-status"),
  serviceCount: document.querySelector("#service-event-count"),
  serviceStatus: document.querySelector("#service-event-status"),
  serviceInterface: document.querySelector("#service-interface-filter"),
  serviceCall: document.querySelector("#service-call-filter"),
  servicePhase: document.querySelector("#service-phase-filter"),
  serviceEvents: document.querySelector("#service-events"),
  treeView: document.querySelector("#tree-view"),
  empty: document.querySelector("#snapshot-empty"),
  collapseAll: document.querySelector("#collapse-all-button"),
  expandAll: document.querySelector("#expand-all-button"),
  live: document.querySelector("#live-button"),
  export: document.querySelector("#export-button"),
  import: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  filter: document.querySelector("#node-filter"),
  details: {
    name: document.querySelector("#detail-name"),
    registration: document.querySelector("#detail-registration"),
    kind: document.querySelector("#detail-kind"),
    status: document.querySelector("#detail-status"),
    path: document.querySelector("#detail-path"),
  },
  counts: {
    SUCCESS: document.querySelector("#count-success"),
    FAILURE: document.querySelector("#count-failure"),
    RUNNING: document.querySelector("#count-running"),
  },
};

const state = {
  structure: null,
  snapshot: null,
  paused: false,
  offline: false,
  selectedNodeId: null,
  nodesById: new Map(),
  elementsById: new Map(),
  treeItemsById: new Map(),
  collapseButtonsById: new Map(),
  collapsedNodeIds: new Set(),
  statusesById: new Map(),
  serviceEvents: [],
};

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function kindCode(kind) {
  return { Control: "C", Decorator: "D", Action: "A", Condition: "?", Leaf: "L" }[kind] || "N";
}

function buildTreeNode(node, root = false) {
  state.nodesById.set(node.key, node);
  const list = document.createElement("ol");
  list.className = root ? "tree-list root" : "tree-list";
  const item = document.createElement("li");
  item.className = "tree-item";
  item.dataset.nodeKey = node.key;
  const row = document.createElement("div");
  row.className = "tree-row";
  if (node.children.length) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tree-toggle";
    toggle.addEventListener("click", () => toggleNodeCollapse(node.key));
    state.collapseButtonsById.set(node.key, toggle);
    row.append(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "tree-toggle-spacer";
    spacer.setAttribute("aria-hidden", "true");
    row.append(spacer);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-node status-IDLE";
  button.dataset.nodeKey = node.key;
  button.innerHTML = `<span class="node-kind"></span><span class="status-dot" aria-hidden="true"></span><span class="node-label"></span><span class="registration"></span>`;
  const kind = button.querySelector(".node-kind");
  kind.textContent = kindCode(node.kind);
  kind.title = node.kind;
  kind.classList.add(node.kind);
  button.querySelector(".node-label").textContent = node.instance_name;
  button.querySelector(".registration").textContent = node.registration_name;
  button.addEventListener("click", () => selectNode(node.key));
  state.elementsById.set(node.key, button);
  state.treeItemsById.set(node.key, item);
  row.append(button);
  item.append(row);
  for (const child of node.children) item.append(buildTreeNode(child));
  list.append(item);
  updateNodeCollapse(node.key);
  return list;
}

function updateNodeCollapse(nodeId) {
  const item = state.treeItemsById.get(nodeId);
  const toggle = state.collapseButtonsById.get(nodeId);
  if (!item || !toggle) return;
  const node = state.nodesById.get(nodeId);
  const collapsed = state.collapsedNodeIds.has(nodeId);
  item.classList.toggle("collapsed", collapsed);
  toggle.textContent = collapsed ? "+" : "-";
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"} ${node.instance_name}`);
  toggle.title = `${collapsed ? "展开" : "折叠"} ${node.instance_name}`;
}

function toggleNodeCollapse(nodeId) {
  if (state.collapsedNodeIds.has(nodeId)) state.collapsedNodeIds.delete(nodeId);
  else state.collapsedNodeIds.add(nodeId);
  updateNodeCollapse(nodeId);
}

function setAllNodesCollapsed(collapsed) {
  state.collapsedNodeIds.clear();
  if (collapsed) {
    for (const nodeId of state.collapseButtonsById.keys()) state.collapsedNodeIds.add(nodeId);
  }
  for (const nodeId of state.collapseButtonsById.keys()) updateNodeCollapse(nodeId);
}

function applyFilter() {
  const query = ui.filter.value.trim().toLowerCase();
  for (const [id, element] of state.elementsById) {
    const node = state.nodesById.get(id);
    const text = `${node.instance_name} ${node.registration_name} ${node.path}`.toLowerCase();
    element.classList.toggle("search-muted", Boolean(query) && !text.includes(query));
  }
}

function updateTreeStatuses() {
  state.statusesById = new Map((state.snapshot?.nodes || []).map((node) => [node.key, node.status]));
  for (const [id, element] of state.elementsById) {
    const status = state.statusesById.get(id) || "IDLE";
    element.className = `tree-node status-${status}`;
    element.dataset.status = status;
    if (id === state.selectedNodeId) element.classList.add("selected");
  }
  applyFilter();
}

function selectNode(nodeId) {
  state.selectedNodeId = nodeId;
  const node = state.nodesById.get(nodeId);
  const runtime = state.snapshot?.nodes.find((entry) => entry.key === nodeId);
  ui.details.name.textContent = node.instance_name;
  ui.details.registration.textContent = node.registration_name;
  ui.details.kind.textContent = runtime?.kind || node.kind;
  ui.details.status.textContent = runtime?.status || "IDLE";
  ui.details.path.textContent = node.path;
  updateTreeStatuses();
}

function renderSnapshot() {
  if (!state.snapshot) return;
  ui.empty.classList.add("hidden");
  ui.treeId.textContent = state.snapshot.tree_id;
  ui.tick.textContent = String(state.snapshot.seq);
  ui.rootStatus.textContent = state.snapshot.root_status;
  ui.rootStatus.className = `status-text status-${state.snapshot.root_status}`;
  const counts = { SUCCESS: 0, FAILURE: 0, RUNNING: 0 };
  for (const node of state.snapshot.nodes) if (node.status in counts) counts[node.status] += 1;
  for (const status of Object.keys(counts)) ui.counts[status].textContent = String(counts[status]);
  updateTreeStatuses();
  if (state.selectedNodeId) selectNode(state.selectedNodeId);
}

function renderServiceEvents() {
  const interfaceQuery = ui.serviceInterface.value.trim().toLowerCase();
  const callQuery = ui.serviceCall.value.trim().toLowerCase();
  const phaseQuery = ui.servicePhase.value;
  const events = state.serviceEvents.filter(({ event }) =>
    (!interfaceQuery || event.interface.toLowerCase().includes(interfaceQuery)) &&
    (!callQuery || event.call_id.toLowerCase().includes(callQuery)) &&
    (!phaseQuery || event.phase === phaseQuery));
  ui.serviceCount.textContent = String(state.serviceEvents.length);
  ui.serviceEvents.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "service-empty";
    empty.textContent = "暂无服务事件";
    ui.serviceEvents.append(empty);
    return;
  }
  for (const { event } of events.slice(-48).reverse()) {
    const item = document.createElement("article");
    item.className = `service-event phase-${event.phase}`;
    const header = document.createElement("div");
    header.className = "service-event-header";
    const name = document.createElement("strong");
    name.textContent = event.interface.split("/").filter(Boolean).pop() || event.interface;
    const phase = document.createElement("span");
    phase.textContent = event.phase;
    header.append(name, phase);
    const detail = document.createElement("div");
    detail.className = "service-event-detail";
    detail.textContent = `${event.call_id} | ${event.duration_ms} ms | ${event.result?.message || event.message || "-"}`;
    item.append(header, detail);
    ui.serviceEvents.append(item);
  }
}

async function pollSnapshot() {
  if (state.paused || state.offline) return;
  try {
    const payload = await fetchJson("/api/v1/bt/snapshots/latest");
    if (!payload.available) {
      ui.connection.textContent = "已连接，等待快照";
      return;
    }
    if (payload.snapshot.tree_revision !== state.structure.tree_revision) throw new Error("树 revision 不一致");
    state.snapshot = payload.snapshot;
    ui.connection.textContent = "实时";
    renderSnapshot();
  } catch (error) {
    ui.connection.textContent = `已断开 / ${error.message}`;
  }
}

async function pollServiceEvents() {
  if (state.offline) return;
  try {
    const payload = await fetchJson("/api/v1/bt/service-events?limit=80");
    state.serviceEvents = payload.entries || [];
    ui.serviceStatus.textContent = state.serviceEvents.length ? "实时" : "等待事件";
    renderServiceEvents();
  } catch (error) {
    ui.serviceStatus.textContent = `不可用 / ${error.message}`;
  }
}

function toggleLive() {
  state.paused = !state.paused;
  if (!state.paused) state.offline = false;
  ui.live.textContent = state.paused ? "继续" : "暂停";
  ui.connection.textContent = state.paused ? "已暂停" : "实时";
  if (!state.paused) pollSnapshot();
}

function exportSnapshot() {
  if (!state.snapshot) return;
  const blob = new Blob([JSON.stringify(state.snapshot, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `bt-snapshot-${state.snapshot.seq}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importSnapshot(file) {
  const snapshot = JSON.parse(await file.text());
  if (snapshot.schema !== "bt_ros2.bt_snapshot.v1" || !Array.isArray(snapshot.nodes)) throw new Error("不支持的快照");
  if (snapshot.tree_revision !== state.structure.tree_revision) throw new Error("树 revision 不一致");
  state.snapshot = snapshot;
  state.paused = true;
  state.offline = true;
  ui.live.textContent = "继续";
  ui.connection.textContent = "离线快照";
  renderSnapshot();
}

async function boot() {
  try {
    state.structure = await fetchJson("/api/v1/bt/structure");
    ui.treeView.replaceChildren(buildTreeNode(state.structure.root, true));
    await Promise.all([pollSnapshot(), pollServiceEvents()]);
  } catch (error) {
    ui.connection.textContent = `已断开 / ${error.message}`;
  }
  window.setInterval(pollSnapshot, 250);
  window.setInterval(pollServiceEvents, 500);
}

ui.live.addEventListener("click", toggleLive);
ui.collapseAll.addEventListener("click", () => setAllNodesCollapsed(true));
ui.expandAll.addEventListener("click", () => setAllNodesCollapsed(false));
ui.export.addEventListener("click", exportSnapshot);
ui.import.addEventListener("click", () => ui.importFile.click());
ui.importFile.addEventListener("change", async () => {
  if (!ui.importFile.files.length) return;
  try { await importSnapshot(ui.importFile.files[0]); }
  catch (error) { ui.connection.textContent = `快照错误 / ${error.message}`; }
  finally { ui.importFile.value = ""; }
});
ui.filter.addEventListener("input", applyFilter);
ui.serviceInterface.addEventListener("input", renderServiceEvents);
ui.serviceCall.addEventListener("input", renderServiceEvents);
ui.servicePhase.addEventListener("change", renderServiceEvents);
boot();

