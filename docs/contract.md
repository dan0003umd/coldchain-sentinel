# ColdChain Sentinel - Team Contract (v2, matches the deployed stack)

## Reading message (MQTT topic: coldchain/readings)
{"shipment_id":"SHP-001","sensor_id":"SNS-001","timestamp":"2026-10-19T14:00:00+00:00","temp_c":3.5,"seq_no":42}

## Issue definitions
- Safe range: 0.0 to 5.0 C (set in template.yaml as SAFE_MIN and SAFE_MAX)
- Reporting interval: 30 s (simulated)
- Sustained excursion: out of range for N = 4 consecutive readings (N_CONSECUTIVE)
- Brief spike: out of range for fewer than 4 readings -> logged, no incident
- Silence: no reading for 3x the reporting interval = 90 s (SILENCE_SECONDS); checked every minute
- Invalid: missing field, temp outside -60..60 C, non-numeric temp or seq_no, bad or future timestamp
- Duplicate: same sensor_id + seq_no already stored

## Tables (DynamoDB)

### readings (implemented)
- Key: sensor_id (HASH), seq_no (RANGE)
- Index by-shipment: shipment_id (HASH), timestamp (RANGE)
- Other fields: temp_c, ingested_at
- Stream: NEW_IMAGE, triggers the detect function on each INSERT

### incidents (implemented)
- Key: shipment_id (HASH). One item per shipment = the current incident.
- Rule: a new incident can be written only if none exists or the existing one has status RESOLVED
  (conditional write), so one problem = one alert.
- Common fields: incident_id (uuid), issue_type, status, sensor_id, opened_at
- issue_type = sustained_excursion: also trigger_seq_no, trigger_temp_c, readings_considered
- issue_type = sensor_silence: also last_seen_at, silent_for_seconds
- status values: OPEN (implemented); RESOLVED and ESCALATED (set by the Step Functions workflow, planned)
- Note: a resolved incident is overwritten by the next one, so history lives in the actions and followups tables, keyed by incident_id.

### sensors (implemented)
- Key: sensor_id (HASH)
- Fields: shipment_id, last_seen (server-side ingest time), last_seq_no
- Updated by the detect function on every stored reading; read by the silence function.

### actions (planned)
- Key: incident_id (HASH), action_ts (RANGE); fields: action_type, issue_type, requested_by (system or reviewer)

### followups (planned)
- Key: incident_id (HASH), check_ts (RANGE); fields: problem_still_present, result (resolved or escalated)

### notes (planned)
- Key: incident_id (HASH), note_ts (RANGE); fields: author, text, override_flag

## Response flow (planned, Step Functions)
incident opened -> choose action by issue_type
(sustained_excursion: inspect or reroute request; sensor_silence: sensor check request)
-> record action -> wait -> follow-up check
(new readings in range, or a simulated status update when the sensor is silent)
-> mark incident RESOLVED, or retry once and mark ESCALATED.
A reviewer override can interrupt at any point (status flag checked before each step).

## Deviations from the first plan
- The simulator publishes with boto3 (IAM credentials) instead of device certificates.
- Thresholds are set as Lambda environment variables in template.yaml, not in a config table, for now.
