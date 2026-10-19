import json, os, uuid
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError

ddb = boto3.resource("dynamodb")
sfn = boto3.client("stepfunctions")
sensors = ddb.Table(os.environ["SENSORS_TABLE"])
incidents = ddb.Table(os.environ["INCIDENTS_TABLE"])
SILENCE = int(os.environ["SILENCE_SECONDS"])
WORKFLOW_ARN = os.environ["WORKFLOW_ARN"]
WAIT = int(os.environ["WAIT_SECONDS"])

def start_workflow(item):
    payload = {"shipment_id": item["shipment_id"], "incident_id": item["incident_id"],
               "issue_type": item["issue_type"], "sensor_id": item["sensor_id"],
               "attempt": 0, "wait_seconds": WAIT}
    sfn.start_execution(stateMachineArn=WORKFLOW_ARN, name=item["incident_id"],
                        input=json.dumps(payload))
    print(json.dumps({"result": "workflow_started", "incident_id": item["incident_id"]}))

def open_incident(s, silent_for):
    item = {
        "shipment_id": s["shipment_id"],
        "incident_id": str(uuid.uuid4()),
        "issue_type": "sensor_silence",
        "status": "OPEN",
        "sensor_id": s["sensor_id"],
        "opened_at": datetime.now(timezone.utc).isoformat(),
        "last_seen_at": s["last_seen"],
        "silent_for_seconds": silent_for,
    }
    try:
        incidents.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(shipment_id) OR #s = :resolved",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":resolved": "RESOLVED"},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            print(json.dumps({"result": "duplicate_alert_suppressed", "shipment_id": s["shipment_id"]}))
            return
        raise
    print(json.dumps({"result": "incident_opened", **item}, default=str))
    start_workflow(item)

def handler(event, context):
    now = datetime.now(timezone.utc)
    resp = sensors.scan()
    items = resp["Items"]
    while "LastEvaluatedKey" in resp:
        resp = sensors.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items += resp["Items"]
    silent = 0
    for s in items:
        silent_for = (now - datetime.fromisoformat(s["last_seen"])).total_seconds()
        if silent_for > SILENCE:
            silent += 1
            open_incident(s, int(silent_for))
    print(json.dumps({"result": "silence_check_done", "sensors_checked": len(items), "sensors_silent": silent}))