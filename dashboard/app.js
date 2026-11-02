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

// ----- temperature chart (uses Chart.js) -----
let chart = null; // keep the chart so we can delete it before drawing a new one

function drawChart(shipmentId) {
  const data = readings[shipmentId] || [];
  const labels = data.map((r) => new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  const temps = data.map((r) => r.temp_c);

  // red dots for readings outside the safe range (0 to 5 C)
  const dotColors = temps.map((t) => (t < 0 || t > 5 ? "#c53030" : "#0f6e8c"));

  if (chart) chart.destroy(); // remove the old chart

  chart = new Chart(document.getElementById("temp-chart"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        // 1. the actual temperatures
        { label: "Temperature (°C)", data: temps, borderColor: "#0f6e8c",
          pointBackgroundColor: dotColors, pointBorderColor: dotColors, pointRadius: 4, tension: 0.2 },
        // 2 + 3. two flat lines at 0 and 5; the area between them is shaded green = safe range
        { label: "Safe range", data: temps.map(() => 5), borderColor: "rgba(47,133,90,0.4)",
          borderDash: [5, 5], pointRadius: 0, fill: "+1", backgroundColor: "rgba(47,133,90,0.08)" },
        { label: "", data: temps.map(() => 0), borderColor: "rgba(47,133,90,0.4)",
          borderDash: [5, 5], pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { filter: (item) => item.text !== "" } } },
      scales: {
        x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } },
        y: { title: { display: true, text: "°C" } },
      },
    },
  });
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

    <h3>Temperature readings</h3>
    <div class="chart-box"><canvas id="temp-chart"></canvas></div>
    ${inc.issue_type === "sensor_silence" ? `<p class="muted">The sensor stopped sending after the last point.</p>` : ""}

    <div class="two-col">
      <div>
        <h3>History</h3>
        <ol class="timeline">${buildTimeline(inc)}</ol>
      </div>

      <div>
        <h3>Override status</h3>
        <form id="override-form" class="box">
          <p class="muted small">Use this when you know better than the automated workflow.</p>
          <select name="new_status">
            ${["RESOLVED", "ESCALATED"].filter((s) => s !== inc.status)
              .map((s) => `<option value="${s}">Set to ${s}</option>`).join("")}
          </select>
          <textarea name="reason" rows="2" placeholder="Reason (required)" required></textarea>
          <button type="submit" class="btn primary">Apply override</button>
        </form>

        <h3>Notes</h3>
        <form id="note-form" class="box">
          <textarea name="text" rows="2" placeholder="Add a note for other reviewers" required></textarea>
          <button type="submit" class="btn">Add note</button>
        </form>
      </div>
    </div>
  `;

  // ----- add a note -----
  document.getElementById("note-form").addEventListener("submit", (e) => {
    e.preventDefault(); // stop the page from reloading
    const text = e.target.text.value.trim();
    if (!text) return;

    // save into the notes "table" (later this becomes a POST to the API)
    if (!notes[inc.incident_id]) notes[inc.incident_id] = [];
    notes[inc.incident_id].push({
      note_ts: new Date().toISOString(),
      author: document.getElementById("user-name").textContent,
      text: text,
      override_flag: false,
    });

    renderDetail(inc.shipment_id); // redraw so the note shows in the history
  });

  // ----- override the status -----
  document.getElementById("override-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const newStatus = e.target.new_status.value;
    const reason = e.target.reason.value.trim();
    if (!reason) return;

    // 1. change the status on the incident
    inc.status = newStatus;
    inc.overridden_by = document.getElementById("user-name").textContent;

    // 2. record it as a note with override_flag = true (so there is a record of who and why)
    if (!notes[inc.incident_id]) notes[inc.incident_id] = [];
    notes[inc.incident_id].push({
      note_ts: new Date().toISOString(),
      author: inc.overridden_by,
      text: `Status set to ${newStatus}: ${reason}`,
      override_flag: true,
    });

    renderList();                // badge on the left changes
    renderDetail(inc.shipment_id); // badge + history on the right change
  });

  drawChart(inc.shipment_id); // the canvas exists now, so draw the chart
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
