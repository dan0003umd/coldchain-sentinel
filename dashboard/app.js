// ----- state: what the page is currently showing -----
let currentFilter = "ALL";
let selectedShipment = null;

// readable names for issue types and actions
const ISSUE_LABEL = {
  sustained_excursion: "Temperature excursion",
  sensor_silence: "Sensor silent",
};
const ACTION_LABEL = {
  inspect_or_reroute_request: "Inspect or reroute requested",
  sensor_check_request: "Sensor check requested",
};

// ISO time -> "Nov 2, 09:20:12 AM"
function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ----- draw the incident list (left panel) -----
function renderList() {
  const list = document.getElementById("incident-list");

  // keep only incidents that match the filter
  const visible = incidents.filter(
    (inc) => currentFilter === "ALL" || inc.status === currentFilter
  );

  if (visible.length === 0) {
    list.innerHTML = `<li class="muted">No incidents.</li>`;
    return;
  }

  list.innerHTML = visible.map((inc) => `
    <li class="incident ${inc.shipment_id === selectedShipment ? "selected" : ""}"
        data-shipment="${inc.shipment_id}">
      <span class="badge ${inc.status}">${inc.status}</span>
      <b>${inc.shipment_id}</b> · ${inc.sensor_id}<br>
      <small>${ISSUE_LABEL[inc.issue_type]}</small>
    </li>
  `).join("");
}

// ----- build the history: merge events from all tables, sort by time -----
function buildTimeline(inc) {
  const events = [];

  // 1. incident opened (incidents table)
  events.push({
    ts: inc.opened_at, type: "open", title: "Incident opened",
    body: inc.issue_type === "sustained_excursion"
      ? "4 readings in a row outside 0–5 °C"
      : `No reading for ${inc.silent_for_seconds}s`,
  });

  // 2. actions (actions table)
  (actions[inc.incident_id] || []).forEach((a) => {
    events.push({ ts: a.action_ts, type: "action",
      title: ACTION_LABEL[a.action_type] || a.action_type, body: `by ${a.requested_by}` });
  });

  // 3. follow-up checks (followups table)
  (followups[inc.incident_id] || []).forEach((f) => {
    events.push({ ts: f.check_ts, type: f.problem_still_present ? "bad" : "good",
      title: `Follow-up check ${f.attempt + 1}: ` +
             (f.problem_still_present ? "problem still present" : "problem cleared"),
      body: f.detail });
  });

  // 4. notes (notes table)
  (notes[inc.incident_id] || []).forEach((n) => {
    events.push({ ts: n.note_ts, type: n.override_flag ? "override" : "note",
      title: n.override_flag ? "Reviewer override" : "Note", body: `${n.author}: ${n.text}` });
  });

  // 5. workflow result (closed_at on the incident)
  if (inc.closed_at) {
    events.push({ ts: inc.closed_at, type: inc.status === "RESOLVED" ? "good" : "bad",
      title: `Workflow marked ${inc.status}`, body: "" });
  }

  // oldest first
  events.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  return events.map((e) => `
    <li class="tl ${e.type}">
      <span class="tl-time">${formatTime(e.ts)}</span>
      <b>${e.title}</b>
      <div class="muted">${e.body}</div>
    </li>
  `).join("");
}

// ----- draw the detail panel (right panel) -----
function renderDetail(shipmentId) {
  const inc = incidents.find((i) => i.shipment_id === shipmentId);
  const panel = document.getElementById("detail");

  // facts that depend on the issue type
  const extra = inc.issue_type === "sustained_excursion"
    ? `<div><span>Trigger reading</span><b>${inc.trigger_temp_c} °C (seq ${inc.trigger_seq_no})</b></div>`
    : `<div><span>Last reading</span><b>${formatTime(inc.last_seen_at)}</b></div>
       <div><span>Quiet for</span><b>${inc.silent_for_seconds}s (limit 90s)</b></div>`;

  panel.innerHTML = `
    <span class="badge ${inc.status}">${inc.status}</span>
    <p class="muted">${ISSUE_LABEL[inc.issue_type]}</p>
    <h2>${inc.shipment_id}</h2>
    <p class="muted">Sensor ${inc.sensor_id} · Incident ${inc.incident_id}</p>

    <div class="facts">
      <div><span>Opened</span><b>${formatTime(inc.opened_at)}</b></div>
      <div><span>Closed</span><b>${inc.closed_at ? formatTime(inc.closed_at) : "Still open"}</b></div>
      ${extra}
    </div>

    <h3>History</h3>
    <ol class="timeline">${buildTimeline(inc)}</ol>
  `;
}

// ----- filter buttons -----
document.getElementById("filters").addEventListener("click", (e) => {
  if (!e.target.classList.contains("chip")) return;

  currentFilter = e.target.dataset.status;

  // move the "active" style to the clicked button
  document.querySelectorAll(".chip").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");

  renderList();
});

// ----- clicking an incident -----
document.getElementById("incident-list").addEventListener("click", (e) => {
  const item = e.target.closest(".incident");
  if (!item) return;
  selectedShipment = item.dataset.shipment;
  renderList();
  renderDetail(selectedShipment);
});

// draw the list when the page loads
renderList();
