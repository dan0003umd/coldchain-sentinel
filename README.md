# ColdChain Sentinel

AWS prototype that monitors simulated temperature sensors on food shipments, detects sustained
temperature excursions and silent sensors, opens one incident per problem, and runs an automated
response workflow with a follow-up check. MSML 650 Cloud Computing, Fall 2026, Group 8.

## What is built so far

| Stage | AWS services | Status |
|---|---|---|
| Simulated sensors publish readings | Python script, IoT Core (MQTT topic `coldchain/readings`) | Done |
| Validate and de-duplicate readings | IoT rule, Lambda (`ValidateFunction`), DynamoDB `ReadingsTable` | Done |
| Sustained excursion vs. brief spike | DynamoDB Stream, Lambda (`DetectFunction`), `IncidentsTable` | Done |
| Silent sensor detection | EventBridge Scheduler (every minute), Lambda (`SilenceFunction`), `SensorsTable` | Done |
| Response workflow and follow-up | Step Functions (`IncidentWorkflow`), 3 Lambdas, `ActionsTable`, `FollowupsTable` | Done |
| Reviewer dashboard, API, auth | API Gateway, Lambda, Cognito, S3/CloudFront | Not started |
| Monitoring dashboards and test metrics | CloudWatch | Not started |

## How the pipeline works

1. `sim.py` publishes readings to IoT Core. An IoT rule sends each one to `ValidateFunction`, which rejects invalid
   readings and drops duplicates, then stores valid readings in `ReadingsTable`.
2. The table's stream triggers `DetectFunction`. If the latest 4 readings of a sensor are all outside 0-5 C it opens a
   `sustained_excursion` incident. Fewer than 4 is a brief spike and is only logged. It also records each sensor's last-seen time.
3. `SilenceFunction` runs every minute and opens a `sensor_silence` incident for any sensor quiet for more than 90 seconds.
4. Each new incident starts the `IncidentWorkflow` state machine, which:
   - picks an action by issue type (`inspect_or_reroute_request` or `sensor_check_request`) and records it,
   - waits 30 seconds, then runs a follow-up check (excursion: latest 4 readings in range; silence: sensor reporting again),
   - marks the incident `RESOLVED` if the problem is gone, otherwise retries once and marks it `ESCALATED`.
5. Only one incident can be open per shipment. A shipment with an `OPEN` or `ESCALATED` incident cannot get a new one until it is resolved.

## Repository layout

```
template.yaml          # SAM template: all AWS resources
samconfig.toml         # saved deploy settings
src/validate/app.py    # validates readings, drops invalid and duplicate ones
src/detect/app.py      # sustained-vs-spike logic, opens incidents, tracks last-seen, starts workflow
src/silence/app.py     # scheduled check for silent sensors, opens incidents, starts workflow
src/workflow/app.py    # workflow steps: record action, follow-up check, resolve or escalate
simulator/sim.py       # sends test readings (7 scenario modes)
docs/contract.md       # agreed message format, issue definitions, tables, response flow
```

## Prerequisites

1. An AWS account with a user that has programmatic access (access key and secret).
2. Python 3.12, Git, AWS CLI v2, and AWS SAM CLI installed.
3. Region: **us-east-1** (N. Virginia). Use the same region as everyone else on the team.

Check your tools:

```
git --version
python --version
aws --version
sam --version
```

## Setup

```
git clone https://github.com/dan0003umd/coldchain-sentinel.git
cd coldchain-sentinel
pip install boto3
aws configure
```

When `aws configure` asks, enter your access key, secret key, region `us-east-1`, and output `json`.
Never commit access keys to the repo.

Confirm you are using the right account:

```
aws sts get-caller-identity
```

## Deploy

```
sam build
sam deploy --guided
```

Answers for the guided prompts: stack name `coldchain-sentinel`, region `us-east-1`,
confirm changes `N`, allow IAM role creation `Y`, save arguments `Y`.
For later deploys, run `sam build` then `sam deploy`.

The first time an account uses IoT Core, its endpoint name can take a few minutes to resolve.
If the simulator fails with a DNS error, wait and retry.

## Run the simulator

Use a new shipment and sensor ID for each test. An open or escalated incident blocks new ones on the same shipment.

```
python simulator/sim.py normal    --shipment SHP-101 --sensor SNS-101
python simulator/sim.py spike     --shipment SHP-102 --sensor SNS-102
python simulator/sim.py sustained --shipment SHP-103 --sensor SNS-103
python simulator/sim.py dropout   --shipment SHP-104 --sensor SNS-104
python simulator/sim.py invalid   --shipment SHP-105 --sensor SNS-105
python simulator/sim.py duplicate --shipment SHP-106 --sensor SNS-106
python simulator/sim.py recover   --shipment SHP-107 --sensor SNS-107
```

| Mode | What it sends | Expected result |
|---|---|---|
| normal | 20 in-range readings | Stored; a silence incident opens after the run ends |
| spike | 2 high readings in a row | Logged as below threshold, no incident |
| sustained | 12 high readings in a row, then stops | `sustained_excursion` incident, then ESCALATED after 2 follow-ups (about 60 s) |
| dropout | 8 readings, then stops | `sensor_silence` incident after about 2 to 3 minutes, then ESCALATED |
| invalid | every 5th reading is 999 C | Those readings rejected, not stored |
| duplicate | every 5th reading sent twice | Repeats dropped, no extra rows |
| recover | normal, 6 high readings, then normal (45 s) | Incident RESOLVED after 1 follow-up |

Every finished run stops reporting, so about 90 seconds later it opens a silence incident. This is expected behavior.
To see a RESOLVED incident in the table, scan it within a minute after a `recover` run ends.

## Check results

```
aws dynamodb list-tables --region us-east-1
aws dynamodb scan --table-name <READINGS_TABLE_NAME> --select COUNT --region us-east-1
aws dynamodb scan --table-name <INCIDENTS_TABLE_NAME> --region us-east-1
aws dynamodb scan --table-name <ACTIONS_TABLE_NAME> --region us-east-1
aws dynamodb scan --table-name <FOLLOWUPS_TABLE_NAME> --region us-east-1
```

Find the real table names with the first command, then replace the angle-bracket placeholders (without the brackets).
Logs: `aws logs tail /aws/lambda/<function-log-group> --since 1h --region us-east-1`
Workflow runs: AWS Console > Step Functions > IncidentWorkflow > Executions (the graph view shows the path taken).
To reset a test, delete the shipment's item in the incidents table (AWS Console > DynamoDB), or use a new ID.

## Clean up (stops all charges)

```
sam delete --stack-name coldchain-sentinel --region us-east-1
```

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| `sam build` crashes with `NoneType` has no attribute `get` | `template.yaml` is empty or unsaved. Save it and check its size. |
| Lambda has no code | `app.py` file is empty. Paste the code in and save before building. |
| DynamoDB console shows no tables | Console region is wrong. Switch to N. Virginia. |
| Simulator DNS error | New IoT endpoint still propagating. Wait a few minutes, check with `nslookup`. |
| Wrong account | Run `aws sts get-caller-identity` and compare with the console account ID. |
| No new incident for a shipment | An OPEN or ESCALATED incident already exists. Use a new shipment ID or delete the item. |

## Team workflow

- Pull before you start (`git pull`), and commit small changes with clear messages.
- Each person tests their own component and writes their own report section.
- Do not create resources by clicking in the console. Add them to `template.yaml` so the stack stays reproducible.
- Keep the simulator off when not testing, and keep the billing alarm active.

## Remaining work

Reviewer dashboard and API (history, notes, override), Cognito authentication and dashboard hosting,
CloudWatch dashboards and alarms, accuracy and latency measurements, final report and demo.
