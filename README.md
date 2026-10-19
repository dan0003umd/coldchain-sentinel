# ColdChain Sentinel

AWS prototype that monitors simulated temperature sensors on food shipments, detects sustained
temperature excursions and silent sensors, and records one incident per problem.
MSML 650 Cloud Computing, Fall 2026, Group 8.

## What is built so far

| Stage | AWS services | Status |
|---|---|---|
| Simulated sensors publish readings | Python script, IoT Core (MQTT topic `coldchain/readings`) | Done |
| Validate and de-duplicate readings | IoT rule, Lambda (`ValidateFunction`), DynamoDB `ReadingsTable` | Done |
| Sustained excursion vs. brief spike | DynamoDB Stream, Lambda (`DetectFunction`), `IncidentsTable` | Done |
| Silent sensor detection | EventBridge Scheduler (every minute), Lambda (`SilenceFunction`), `SensorsTable` | Done |
| Response workflow and follow-up | Step Functions | Not started |
| Reviewer dashboard, API, auth | API Gateway, Lambda, Cognito, S3/CloudFront | Not started |

## Repository layout

```
template.yaml        # SAM template: all AWS resources
samconfig.toml       # saved deploy settings
src/validate/app.py  # validates readings, drops invalid and duplicate ones
src/detect/app.py    # sustained-vs-spike logic, opens incidents, tracks last-seen per sensor
src/silence/app.py   # scheduled check for sensors that stopped reporting
simulator/sim.py     # sends test readings (6 scenario modes)
docs/contract.md     # agreed message format, issue definitions, tables
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

Use a new shipment and sensor ID for each test. An open incident blocks new ones on the same shipment.

```
python simulator/sim.py normal    --shipment SHP-101 --sensor SNS-101
python simulator/sim.py spike     --shipment SHP-102 --sensor SNS-102
python simulator/sim.py sustained --shipment SHP-103 --sensor SNS-103
python simulator/sim.py dropout   --shipment SHP-104 --sensor SNS-104
python simulator/sim.py invalid   --shipment SHP-105 --sensor SNS-105
python simulator/sim.py duplicate --shipment SHP-106 --sensor SNS-106
```

| Mode | What it sends | Expected result |
|---|---|---|
| normal | 20 in-range readings | Stored; later a silence incident once the run ends |
| spike | 2 high readings in a row | Logged as below threshold, no incident |
| sustained | 12 high readings in a row | One `sustained_excursion` incident, later alerts suppressed |
| dropout | 8 readings, then stops | `sensor_silence` incident after about 2 to 3 minutes |
| invalid | every 5th reading is 999 C | Those readings rejected, not stored |
| duplicate | every 5th reading sent twice | Repeats dropped, no extra rows |

Every finished run stops reporting, so about 90 seconds later it opens a silence incident.
This is expected behavior.

## Check results

```
aws dynamodb list-tables --region us-east-1
aws dynamodb scan --table-name <READINGS_TABLE_NAME> --select COUNT --region us-east-1
aws dynamodb scan --table-name <INCIDENTS_TABLE_NAME> --region us-east-1
```

Logs: `aws logs tail /aws/lambda/<function-log-group> --since 1h --region us-east-1`

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

## Team workflow

- Pull before you start (`git pull`), and commit small changes with clear messages.
- Each person tests their own component and writes their own report section.
- Do not create resources by clicking in the console. Add them to `template.yaml` so the stack stays reproducible.
- Keep the simulator off when not testing, and keep the billing alarm active.
