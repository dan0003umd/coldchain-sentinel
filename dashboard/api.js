// =====================================================================
// api.js — the ONLY file that knows where the data comes from.
// app.js calls these functions and never touches the data directly.
//
// Right now every function uses the fake data in mock-data.js.
// When Swetha's API is deployed:
//   1. put the API Gateway URL in API_BASE
//   2. set USE_MOCK = false
//   3. if her contract.md uses different paths, change them below
// =====================================================================

const API_BASE = ""; // e.g. "https://abc123.execute-api.us-east-1.amazonaws.com/prod"
const USE_MOCK = true;

// helper for the real API: send a request, get JSON back
async function callApi(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method: method,
    headers: { "Content-Type": "application/json" }, // Cognito token goes here later
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.json();
}

// 1. all incidents (left list)
//    real API: GET /incidents
async function listIncidents() {
  if (USE_MOCK) return incidents;
  return (await callApi("GET", "/incidents")).items;
}

// 2. one incident with its history (right panel)
//    real API: GET /incidents/{shipment_id}
async function getIncident(shipmentId) {
  if (USE_MOCK) {
    const inc = incidents.find((i) => i.shipment_id === shipmentId);
    return {
      incident: inc,
      actions: actions[inc.incident_id] || [],
      followups: followups[inc.incident_id] || [],
      notes: notes[inc.incident_id] || [],
    };
  }
  return callApi("GET", `/incidents/${shipmentId}`);
}

// 3. temperature readings for the chart
//    real API: GET /shipments/{shipment_id}/readings
async function getReadings(shipmentId) {
  if (USE_MOCK) return readings[shipmentId] || [];
  return (await callApi("GET", `/shipments/${shipmentId}/readings`)).items;
}

// 4. add a note
//    real API: POST /incidents/{incident_id}/notes   body: { text }
async function addNote(incidentId, text, author) {
  if (USE_MOCK) {
    if (!notes[incidentId]) notes[incidentId] = [];
    notes[incidentId].push({ note_ts: new Date().toISOString(), author, text, override_flag: false });
    return;
  }
  return callApi("POST", `/incidents/${incidentId}/notes`, { text });
}

// 5. override the status
//    real API: POST /incidents/{shipment_id}/override   body: { incident_id, new_status, reason }
async function overrideStatus(shipmentId, incidentId, newStatus, reason, author) {
  if (USE_MOCK) {
    const inc = incidents.find((i) => i.shipment_id === shipmentId);
    if (!inc.workflow_status) inc.workflow_status = inc.status; // keep what the workflow decided
    inc.status = newStatus;
    inc.overridden_by = author;
    if (!notes[incidentId]) notes[incidentId] = [];
    notes[incidentId].push({ note_ts: new Date().toISOString(), author,
      text: `Status set to ${newStatus}: ${reason}`, override_flag: true });
    return;
  }
  return callApi("POST", `/incidents/${shipmentId}/override`,
    { incident_id: incidentId, new_status: newStatus, reason });
}
