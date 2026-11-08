// =====================================================================
// api.js — the ONLY file that knows where the data comes from.
// app.js calls these functions and never touches the data directly.
//
// USE_MOCK = true  -> fake data from mock-data.js, no login needed
// USE_MOCK = false -> Swetha's real API (api-dev branch), Cognito login required
//
// Deployed site: scripts/deploy_dashboard.py writes config.json next to this
// page, and loadConfig() below switches to the real API automatically.
// Test the real API on the deployed DashboardUrl: the API only allows requests
// from the CloudFront address (CORS), so a page opened as a local file is blocked.
// The 3 values below are only a fallback; the stack outputs have them:
//   aws cloudformation describe-stacks --stack-name coldchain-sentinel \
//     --query "Stacks[0].Outputs" --output table
// =====================================================================

let USE_MOCK = true;
let API_BASE = "";          // ReviewerApiUrl, e.g. "https://abc123.execute-api.us-east-1.amazonaws.com/prod"
let USER_POOL_ID = "";      // ReviewerUserPoolId,       e.g. "us-east-1_AbCdEf123"
let CLIENT_ID = "";         // ReviewerUserPoolClientId, e.g. "1a2b3c4d5e6f7g8h9i0j"

// If config.json exists (written by the deploy script), use it and go live.
async function loadConfig() {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) return;
    const c = await res.json();
    API_BASE = c.apiUrl.replace(/\/$/, "");
    USER_POOL_ID = c.userPoolId;
    CLIENT_ID = c.clientId;
    USE_MOCK = false;
  } catch {
    // no config.json (e.g. page opened as a local file): keep the values above
  }
}

// helper for the real API: send a request with the login token, get JSON back
async function callApi(method, path, body) {
  const token = await getIdToken(); // from auth.js
  const res = await fetch(API_BASE + path, {
    method: method,
    headers: { "Content-Type": "application/json", Authorization: token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {          // token missing or expired -> back to sign-in
    signOut();
    throw new Error("Please sign in again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `${method} ${path} failed (${res.status})`);
  return data;
}

// 1. all incidents (left list)            GET /incidents
async function listIncidents() {
  if (USE_MOCK) return incidents;
  return (await callApi("GET", "/incidents?limit=100")).items;
}

// 2. one incident with its history        GET /shipments/{shipment_id}/incident
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
  return callApi("GET", `/shipments/${encodeURIComponent(shipmentId)}/incident`);
}

// 3. temperature readings for the chart   GET /shipments/{shipment_id}/readings
async function getReadings(shipmentId) {
  if (USE_MOCK) return readings[shipmentId] || [];
  return (await callApi("GET", `/shipments/${encodeURIComponent(shipmentId)}/readings`)).items;
}

// 4. add a note                           POST /incidents/{incident_id}/notes  {text}
//    (the real API takes the author from the login token)
async function addNote(incidentId, text, author) {
  if (USE_MOCK) {
    if (!notes[incidentId]) notes[incidentId] = [];
    notes[incidentId].push({ note_ts: new Date().toISOString(), author, text, override_flag: false });
    return;
  }
  return callApi("POST", `/incidents/${encodeURIComponent(incidentId)}/notes`, { text });
}

// 5. override the status                  POST /shipments/{shipment_id}/override  {incident_id, new_status, reason}
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
  return callApi("POST", `/shipments/${encodeURIComponent(shipmentId)}/override`,
    { incident_id: incidentId, new_status: newStatus, reason });
}
