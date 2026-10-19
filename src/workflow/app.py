import json, os
from datetime import datetime, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

ddb = boto3.resource("dynamodb")
readings = ddb.Table(os.environ["READINGS_TABLE"])
sensors = ddb.Table(os.environ["SENSORS_TABLE"])
incidents = ddb.Table(os.environ["INCIDENTS_TABLE"])
actions = ddb.Table(os.environ["ACTIONS_TABLE"])
followups = ddb.Table(os.environ["FOLLOWUPS_TABLE"])
SAFE_MIN = Decimal(os.environ["SAFE_MIN"])
SAFE_MAX = Decimal(os.environ["SAFE_MAX"])
N = int(os.environ["N_CONSECUTIVE"])
SILENCE = int(os.environ["SILENCE_SECONDS"])

def now():
    return datetime.now(timezone.utc).isoformat()

def out_of_range(t):
    return t < SAFE_MIN or t > SAFE_MAX

def record_action(event, context):
    ts = now()
    actions.put_item(Item={
        "incident_id": event["incident_id"], "action_ts": ts,
        "shipment_id": event["shipment_id"], "issue_type": event["issue_type"],
        "action_type": event["action_type"], "requested_by": "system",
    })
    print(json.dumps({"result": "action_recorded", "incident_id": event["incident_id"],
                      "action_type": event["action_type"]}))
    return {"action_ts": ts}

def followup_check(event, context):
    if event["issue_type"] == "sustained_excursion":
        latest = readings.query(
            KeyConditionExpression=Key("sensor_id").eq(event["sensor_id"]),
            ScanIndexForward=False, Limit=N)["Items"]
        still = len(latest) < N or any(out_of_range(i["temp_c"]) for i in latest)
        detail = f"checked latest {len(latest)} readings"
    else:
        s = sensors.get_item(Key={"sensor_id": event["sensor_id"]}).get("Item")
        age = None
        if s:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(s["last_seen"])).total_seconds()
        still = s is None or age > SILENCE
        detail = f"seconds since last reading: {int(age) if age is not None else 'unknown'}"
    ts = now()
    followups.put_item(Item={
        "incident_id": event["incident_id"], "check_ts": ts,
        "attempt": int(event["attempt"]), "problem_still_present": still, "detail": detail,
    })
    print(json.dumps({"result": "followup_done", "incident_id": event["incident_id"],
                      "still_present": still, "detail": detail}))
    return {"still_present": still, "check_ts": ts}

def update_incident(event, context):
    try:
        incidents.update_item(
            Key={"shipment_id": event["shipment_id"]},
            UpdateExpression="SET #s = :new, closed_at = :t",
            ConditionExpression="incident_id = :id AND #s = :open",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":new": event["new_status"], ":t": now(),
                                       ":id": event["incident_id"], ":open": "OPEN"},
        )
        print(json.dumps({"result": "incident_updated", "new_status": event["new_status"],
                          "incident_id": event["incident_id"]}))
        return {"updated": True}
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            print(json.dumps({"result": "update_skipped", "incident_id": event["incident_id"]}))
            return {"updated": False}
        raise