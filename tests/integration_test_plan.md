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

## Current Status

- Seven local simulator unit tests completed successfully.
- Integration tests not yet executed.
- AWS environment and access arrangements pending confirmation from Dhanraj.
- No live performance measurements collected yet.