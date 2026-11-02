// ----- state: what the page is currently showing -----
let currentFilter = "ALL";
let selectedShipment = null;

// readable names for issue types
const ISSUE_LABEL = {
  sustained_excursion: "Temperature excursion",
  sensor_silence: "Sensor silent",
};

// ----- draw the incident list -----
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

// ----- filter buttons -----
document.getElementById("filters").addEventListener("click", (e) => {
  if (!e.target.classList.contains("chip")) return;

  currentFilter = e.target.dataset.status;

  // move the "active" style to the clicked button
  document.querySelectorAll(".chip").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");

  renderList();
});

// ----- clicking an incident (detail panel comes in Step 4) -----
document.getElementById("incident-list").addEventListener("click", (e) => {
  const item = e.target.closest(".incident");
  if (!item) return;
  selectedShipment = item.dataset.shipment;
  renderList();
  console.log("Selected:", selectedShipment);
});

// draw the list when the page loads
renderList();