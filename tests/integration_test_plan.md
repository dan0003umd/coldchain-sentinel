# ColdChain Sentinel — Integration Test Plan

**Project:** MSML 650 Cloud Computing — Group 8
**Testing responsibility:** Simulation and Testing

## Objective

Evaluate whether ColdChain Sentinel correctly processes simulated temperature readings, detects temperature excursions and sensor silence, prevents duplicate alerts, records automated responses, and performs follow-up checks.

Testing will also measure detection accuracy and the time required to detect and respond to incidents.

## Test Scenarios

| Scenario | Expected Result |
|---|---|
| Normal | Valid readings are stored without creating a temperature-excursion incident. |
| Brief spike | Two consecutive high-temperature readings do not trigger a sustained-excursion incident. |
| Sustained excursion | Four consecutive out-of-range readings trigger an incident and an inspect/reroute request. |
| Sensor dropout | A sensor that stops reporting is identified as silent after the configured threshold and triggers a sensor-check request. |
| Invalid readings | Readings containing impossible temperatures are rejected and do not trigger excursion incidents. |
| Duplicate readings | Repeated sensor/sequence combinations are rejected without creating duplicate incidents. |
| Recovery | An excursion incident is resolved if the latest required readings return to the safe range before follow-up evaluation. |

## Verification

Integration testing will examine the following DynamoDB tables:

- **Readings:** Accepted readings and duplicate handling
- **Sensors:** Latest sensor activity
- **Incidents:** Issue classification, status, and detection timestamps
- **Actions:** Recorded automated responses
- **Followups:** Follow-up attempts and outcomes

CloudWatch logs and Step Functions execution histories may be used to investigate unexpected results.

## Performance Metrics

- **Detection accuracy:** Percentage of test scenarios in which the expected issue was correctly identified
- **False alerts:** Unexpected incidents generated during a defined test observation window
- **Duplicate suppression:** Percentage of deliberately repeated readings rejected
- **Detection latency:** Time between the threshold-triggering event and incident creation
- **Action latency:** Time between incident creation and action recording
- **Resolution time:** Time between incident creation and incident closure

## Testing Controls

Each test will use a distinct shipment ID and sensor ID to reduce interference between scenarios.

Results will be recorded as expected versus actual outcomes. Any suspected backend defects will be documented and communicated to the backend developer rather than modified as part of the testing role.

## Integration Test Results

**Test date:** October 30, 2026
**Environment:** AWS, us-east-1 (individual testing account)
**Overall result:** 7 of 7 scenarios passed

| Scenario | Actual Result | Status |
|---|---|---|
| Normal | 20 readings stored; no sustained-temperature excursion. A sensor-silence incident occurred after transmission stopped. | PASS |
| Brief spike | 20 readings stored; two consecutive high readings did not trigger a sustained excursion. | PASS |
| Sustained excursion | 20 readings sent; four consecutive high readings triggered an incident, an inspect/reroute request, follow-up checks, and escalation. | PASS |
| Sensor dropout | 8 readings stored; sensor silence detected, sensor-check action recorded, two follow-ups completed, and incident escalated. | PASS |
| Invalid readings | 20 readings transmitted; 4 invalid readings rejected and 16 valid readings stored. | PASS |
| Duplicate readings | 24 messages transmitted; 4 duplicates suppressed and 20 unique readings stored. | PASS |
| Recovery | 45 readings stored; sustained excursion detected, inspect/reroute request recorded, first follow-up confirmed recovery, and incident resolved. | PASS |

## Observed Performance Metrics

| Metric | Observed Result |
|---|---|
| Scenario pass rate | 7/7 (100%) |
| Invalid-reading rejection | 4/4 (100%) |
| Duplicate-reading suppression | 4/4 (100%) |
| Sustained excursion detection latency | 0.44 seconds |
| Sustained excursion action latency | 0.92 seconds |
| Sustained excursion reading-to-action latency | 1.36 seconds |
| Sensor dropout detection delay | 137.27 seconds |
| Sustained incident duration | 63.05 seconds |
| Dropout incident duration | 62.93 seconds |

Performance measurements represent individual observed executions, not averages from repeated trials.

The simulator stops transmitting after each scenario. Subsequent sensor-silence incidents may therefore occur and should not automatically be classified as false temperature-excursion alerts.

Recorded automated actions represent requests stored by the workflow, not confirmation of physical inspection or rerouting.

## Current Status

- Seven local simulator unit tests passed.
- Seven AWS integration scenarios passed based on the recorded observations.
- Recovery workflow verified through Readings, Incidents, Actions, and Followups tables.
- Backend implementation was not modified during testing.
