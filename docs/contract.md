# ColdChain Sentinel - Team Contract (v3, matches the deployed stack)

## Reading message (MQTT topic: coldchain/readings)
{"shipment_id":"SHP-001","sensor_id":"SNS-001","timestamp":"2026-10-19T14:00:00+00:00","temp_c":3.5,"seq_no":42}

## Issue definitions
- Safe range: 0.0 to 5.0 C (SAFE_MIN and SAFE_MAX in template.yaml)
- Reporting interval: 30 s (simulated)
- Sustained excursion: out of range for N = 4 consecutive readings (N_CONSECUTIVE)
- Brief spike: out of range for fewer than 4 readings -> logged, no incident
- Silence: no reading for 3x the reporting interval = 90 s (SILENCE_SECONDS); checked every minute
- Invalid: missing field, temp outside -60..60 C, non-numeric temp or seq_no, bad or future timestamp
- Duplicate: same sensor_id + seq_no already stored

## Tables (DynamoDB, all implemented)

### readings
- Key: sensor_id (HASH), seq_no (RANGE); index by-shipment: shipment_id (HASH), timestamp (RANGE)
- Fields: temp_c, ingested_at. Stream NEW_IMAGE triggers the detect function on INSERT.

### incidents
- Key: shipment_id (HASH). One item per shipment = the current incident.
- A new incident can be written only if none exists or the existing one is RESOLVED (conditional write).
- Common fields: incident_id (uuid), issue_type, status, sensor_id, opened_at; closed_at once the workflow finishes
- sustained_excursion: also trigger_seq_no, trigger_temp_c, readings_considered
- sensor_silence: also last_seen_at, silent_for_seconds
- status: OPEN -> RESOLVED or ESCALATED (set by the workflow). ESCALATED blocks new incidents until a reviewer resolves it.
- The next incident overwrites a RESOLVED one, so history lives in actions and followups (keyed by incident_id).

### sensors
- Key: sensor_id (HASH); fields: shipment_id, last_seen (server-side ingest time), last_seq_no

### actions
- Key: incident_id (HASH), action_ts (RANGE); fields: shipment_id, issue_type, action_type, requested_by

### followups
- Key: incident_id (HASH), check_ts (RANGE); fields: attempt, problem_still_present, detail

### notes (planned, for the reviewer dashboard)
- Key: incident_id (HASH), note_ts (RANGE); fields: author, text, override_flag

## Response flow (implemented, Step Functions IncidentWorkflow)
New incident starts the workflow with: shipment_id, incident_id, issue_type, sensor_id, attempt 0, wait_seconds 30.
1. Choose action by issue_type: sustained_excursion -> inspect_or_reroute_request; sensor_silence -> sensor_check_request.
2. Record the action in actions.
3. Wait wait_seconds (30).
4. Follow-up check: excursion = latest 4 readings all in range; silence = sensor reporting again within 90 s. Saved in followups.
5. Problem gone -> incident RESOLVED. Still present and attempt < 1 -> attempt + 1, wait, check again. Otherwise -> ESCALATED.
The status update is conditional on the incident still being OPEN with the same incident_id, so a reviewer
override (setting another status) is not overwritten by the workflow.

## Deviations from the first plan
- The simulator publishes with boto3 (IAM credentials) instead of device certificates.
- Thresholds are Lambda environment variables in template.yaml, not a config table.
- The "simulated status update" follow-up for silent sensors is not built; the check uses the sensor's last-seen time.
