import json, os, uuid
from datetime import datetime, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import ClientError

ddb = boto3.resource("dynamodb")
sfn = boto3.client("stepfunctions")
readings = ddb.Table(os.environ["READINGS_TABLE"])
incidents = ddb.Table(os.environ["INCIDENTS_TABLE"])
sensors = ddb.Table(os.environ["SENSORS_TABLE"])
SAFE_MIN = Decimal(os.environ["SAFE_MIN"])
SAFE_MAX = Decimal(os.environ["SAFE_MAX"])
N = int(os.environ["N_CONSECUTIVE"])
WORKFLOW_ARN = os.environ["WORKFLOW_ARN"]
WAIT = int(os.environ["WAIT_SECONDS"])
deser = TypeDeserializer()

def out_of_range(t):
    return t < SAFE_MIN or t > SAFE_MAX

def touch_sensor(r):
    try:
        sensors.update_item(
            Key={"sensor_id": r["sensor_id"]},
            UpdateExpression="SET last_seen = :t, shipment_id = :s, last_seq_no = :q",
            ConditionExpression="attribute_not_exists(last_seen) OR last_seen < :t",
            ExpressionAttributeValues={":t": r["ingested_at"], ":s": r["shipment_id"], ":q": r["seq_no"]},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise

def start_workflow(item):
    payload = {"shipment_id": item["shipment_id"], "incident_id": item["incident_id"],
               "issue_type": item["issue_type"], "sensor_id": item["sensor_id"],
               "attempt": 0, "wait_seconds": WAIT}
    try:
        sfn.start_execution(stateMachineArn=WORKFLOW_ARN, name=item["incident_id"],
                            input=json.dumps(payload))
        print(json.dumps({"result": "workflow_started", "incident_id": item["incident_id"]}))
    except ClientError as e:
        print(json.dumps({"result": "workflow_start_failed", "error": str(e)}))
        raise

def open_incident(r):
    item = {
        "shipment_id": r["shipment_id"],
        "incident_id": str(uuid.uuid4()),
        "issue_type": "sustained_excursion",
        "status": "OPEN",
        "sensor_id": r["sensor_id"],
        "opened_at": datetime.now(timezone.utc).isoformat(),
        "trigger_seq_no": r["seq_no"],
        "trigger_temp_c": r["temp_c"],
        "readings_considered": N,
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
            print(json.dumps({"result": "duplicate_alert_suppressed", "shipment_id": r["shipment_id"]}))
            return
        raise
    print(json.dumps({"result": "incident_opened", **item}, default=str))
    start_workflow(item)

def handler(event, context):
    for rec in event["Records"]:
        if rec["eventName"] != "INSERT":
            continue
        r = {k: deser.deserialize(v) for k, v in rec["dynamodb"]["NewImage"].items()}
        touch_sensor(r)
        if not out_of_range(r["temp_c"]):
            continue
        latest = readings.query(
            KeyConditionExpression=Key("sensor_id").eq(r["sensor_id"]),
            ScanIndexForward=False,
            Limit=N,
        )["Items"]
        if len(latest) == N and all(out_of_range(i["temp_c"]) for i in latest):
            open_incident(r)
        else:
            print(json.dumps({"result": "out_of_range_below_threshold",
                              "sensor_id": r["sensor_id"], "seq_no": r["seq_no"],
                              "temp_c": r["temp_c"]}, default=str))