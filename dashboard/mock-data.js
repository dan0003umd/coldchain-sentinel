// Fake data shaped like the DynamoDB tables in docs/contract.md

// helper: an ISO time "secondsAgo" seconds before now
function ago(secondsAgo) {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

// incidents table: one current incident per shipment
const incidents = [
  { shipment_id: "SHP-001", incident_id: "inc-001", issue_type: "sustained_excursion",
    status: "RESOLVED", sensor_id: "SNS-001", opened_at: ago(400), closed_at: ago(368),
    trigger_temp_c: 7.9, trigger_seq_no: 11 },

  { shipment_id: "SHP-002", incident_id: "inc-002", issue_type: "sustained_excursion",
    status: "ESCALATED", sensor_id: "SNS-002", opened_at: ago(1000), closed_at: ago(938),
    trigger_temp_c: 8.9, trigger_seq_no: 12 },

  { shipment_id: "SHP-003", incident_id: "inc-003", issue_type: "sensor_silence",
    status: "ESCALATED", sensor_id: "SNS-003", opened_at: ago(1400), closed_at: ago(1339),
    last_seen_at: ago(1500), silent_for_seconds: 100 },

  { shipment_id: "SHP-004", incident_id: "inc-004", issue_type: "sustained_excursion",
    status: "OPEN", sensor_id: "SNS-004", opened_at: ago(60),
    trigger_temp_c: -2.2, trigger_seq_no: 14 },
];

// actions table: keyed by incident_id
const actions = {
  "inc-001": [{ action_ts: ago(399), action_type: "inspect_or_reroute_request", requested_by: "system" }],
  "inc-002": [{ action_ts: ago(999), action_type: "inspect_or_reroute_request", requested_by: "system" }],
  "inc-003": [{ action_ts: ago(1399), action_type: "sensor_check_request", requested_by: "system" }],
  "inc-004": [{ action_ts: ago(59), action_type: "inspect_or_reroute_request", requested_by: "system" }],
};

// followups table: keyed by incident_id
const followups = {
  "inc-001": [{ check_ts: ago(369), attempt: 0, problem_still_present: false, detail: "checked latest 4 readings" }],
  "inc-002": [
    { check_ts: ago(969), attempt: 0, problem_still_present: true, detail: "checked latest 4 readings" },
    { check_ts: ago(939), attempt: 1, problem_still_present: true, detail: "checked latest 4 readings" },
  ],
  "inc-003": [
    { check_ts: ago(1369), attempt: 0, problem_still_present: true, detail: "seconds since last reading: 133" },
    { check_ts: ago(1340), attempt: 1, problem_still_present: true, detail: "seconds since last reading: 163" },
  ],
  "inc-004": [],
};

// notes table: keyed by incident_id (starts mostly empty)
const notes = {
  "inc-002": [{ note_ts: ago(900), author: "swetha@umd.edu", text: "Called carrier, reefer unit fault.", override_flag: false }],
};

// readings table: temperature readings per shipment, one every 30 seconds
// makeReadings(list of temps, seconds ago of the LAST reading)
function makeReadings(temps, lastSecondsAgo) {
  return temps.map((temp, i) => ({
    timestamp: ago(lastSecondsAgo + (temps.length - 1 - i) * 30),
    temp_c: temp,
  }));
}

const readings = {
  // went hot, then came back to normal -> RESOLVED
  "SHP-001": makeReadings([3.1, 3.4, 3.0, 2.8, 3.2, 7.4, 8.1, 7.9, 8.6, 6.8, 3.9, 3.2, 3.0, 2.9, 3.1], 300),
  // went hot and stayed hot -> ESCALATED
  "SHP-002": makeReadings([3.0, 3.3, 2.9, 3.1, 3.4, 7.1, 7.8, 8.4, 8.9, 8.2, 8.7, 8.0, 8.5], 900),
  // normal readings, then the sensor stopped sending -> silence
  "SHP-003": makeReadings([3.2, 3.0, 3.3, 3.1, 2.9, 3.0, 3.2, 3.1], 1500),
  // got too cold, still happening -> OPEN
  "SHP-004": makeReadings([2.9, 3.1, 3.0, 2.7, 1.2, -0.8, -1.4, -1.9, -2.2], 70),
};
