import json, math, os
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import boto3
from botocore.exceptions import ClientError

table = boto3.resource("dynamodb").Table(os.environ["READINGS_TABLE"])
REQUIRED = ("shipment_id", "sensor_id", "timestamp", "temp_c", "seq_no")

def validate(m):
    for f in REQUIRED:
        if m.get(f) is None:
            return f"missing_{f}"
    t = m["temp_c"]
    if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t):
        return "bad_temp_type"
    if not -60 <= t <= 60:
        return "impossible_temp"
    if isinstance(m["seq_no"], bool) or not isinstance(m["seq_no"], int):
        return "bad_seq_no"
    try:
        ts = datetime.fromisoformat(str(m["timestamp"]).replace("Z", "+00:00"))
    except ValueError:
        return "bad_timestamp"
    if ts.tzinfo is None or ts > datetime.now(timezone.utc) + timedelta(minutes=5):
        return "bad_timestamp"
    return None

def handler(event, context):
    reason = validate(event)
    if reason:
        print(json.dumps({"result": "invalid", "reason": reason, "msg": event}, default=str))
        return {"status": "invalid", "reason": reason}
    item = {
        "shipment_id": event["shipment_id"],
        "sensor_id": event["sensor_id"],
        "seq_no": event["seq_no"],
        "timestamp": event["timestamp"],
        "temp_c": Decimal(str(event["temp_c"])),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(sensor_id)")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            print(json.dumps({"result": "duplicate", "sensor_id": event["sensor_id"], "seq_no": event["seq_no"]}))
            return {"status": "duplicate"}
        raise
    return {"status": "stored"}