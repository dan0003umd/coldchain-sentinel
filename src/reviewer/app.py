import base64
import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

ddb = boto3.resource("dynamodb")
incidents = ddb.Table(os.environ["INCIDENTS_TABLE"])
actions = ddb.Table(os.environ["ACTIONS_TABLE"])
followups = ddb.Table(os.environ["FOLLOWUPS_TABLE"])
notes = ddb.Table(os.environ["NOTES_TABLE"])
readings = ddb.Table(os.environ["READINGS_TABLE"])
ALLOWED_ORIGIN = os.environ["ALLOWED_ORIGIN"]
ALLOWED_STATUSES = {"OPEN", "ESCALATED", "RESOLVED"}
OVERRIDE_STATUSES = ("RESOLVED", "ESCALATED")
READINGS_LIMIT = 100


def _encode_key(key):
    raw = json.dumps(key, separators=(",", ":"), default=str).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_key(token):
    padded = token + "=" * (-len(token) % 4)
    key = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
    if not isinstance(key, dict) or not isinstance(key.get("shipment_id"), str):
        raise ValueError("Invalid key")
    return key


def handler(event, context):
    """Return a page of incidents. API Gateway requires a Cognito user-pool token."""
    params = event.get("queryStringParameters") or {}
    try:
        limit = max(1, min(int(params.get("limit", "50")), 100))
    except (TypeError, ValueError):
        return _response(400, {"message": "limit must be an integer"})

    scan_args = {"Limit": limit}
    status = params.get("status")
    if status:
        status = status.upper()
        if status not in ALLOWED_STATUSES:
            return _response(400, {"message": "status must be OPEN, ESCALATED, or RESOLVED"})
        scan_args["FilterExpression"] = Attr("status").eq(status)

    token = params.get("nextToken")
    if token:
        try:
            scan_args["ExclusiveStartKey"] = _decode_key(token)
        except (ValueError, TypeError, json.JSONDecodeError):
            return _response(400, {"message": "Invalid nextToken"})

    result = incidents.scan(**scan_args)
    rows = sorted(
        result.get("Items", []),
        key=lambda item: item.get("opened_at", ""),
        reverse=True,
    )
    last_key = result.get("LastEvaluatedKey")
    return _response(200, {
        "items": rows,
        "nextToken": _encode_key(last_key) if last_key else None,
    })

def get_incident(event, context):
    """GET /shipments/{shipment_id}/incident: current incident plus its history."""
    shipment_id = event["pathParameters"]["shipment_id"]
    incident = incidents.get_item(Key={"shipment_id": shipment_id}).get("Item")
    if not incident:
        return _response(404, {"message": "No incident for this shipment"})
    by_incident = Key("incident_id").eq(incident["incident_id"])
    return _response(200, {
        "incident": incident,
        "actions": actions.query(KeyConditionExpression=by_incident)["Items"],
        "followups": followups.query(KeyConditionExpression=by_incident)["Items"],
        "notes": notes.query(KeyConditionExpression=by_incident)["Items"],
    })


def get_readings(event, context):
    """GET /shipments/{shipment_id}/readings: latest readings, oldest first, for the chart."""
    result = readings.query(
        IndexName="by-shipment",
        KeyConditionExpression=Key("shipment_id").eq(event["pathParameters"]["shipment_id"]),
        ScanIndexForward=False,  # newest first, so Limit keeps the latest ones
        Limit=READINGS_LIMIT,
    )
    items = [{"timestamp": r["timestamp"], "temp_c": r["temp_c"]} for r in reversed(result["Items"])]
    return _response(200, {"items": items})


def add_note(event, context):
    """POST /incidents/{incident_id}/notes  body: {text}"""
    if not _is_reviewer(event):
        return _response(403, {"message": "Only reviewers can do this"})
    text = (_body(event) or {}).get("text")
    if not isinstance(text, str) or not text.strip():
        return _response(400, {"message": "text is required"})
    note = _save_note(event["pathParameters"]["incident_id"], _user(event), text.strip(), False)
    return _response(201, note)


def override(event, context):
    """POST /shipments/{shipment_id}/override  body: {incident_id, new_status, reason}"""
    if not _is_reviewer(event):
        return _response(403, {"message": "Only reviewers can do this"})
    body = _body(event) or {}
    incident_id, new_status, reason = body.get("incident_id"), body.get("new_status"), body.get("reason")
    if not isinstance(incident_id, str) or new_status not in OVERRIDE_STATUSES \
            or not isinstance(reason, str) or not reason.strip():
        return _response(400, {"message": "incident_id, new_status (RESOLVED or ESCALATED) and reason are required"})

    user = _user(event)
    try:
        incidents.update_item(
            Key={"shipment_id": event["pathParameters"]["shipment_id"]},
            # keep what the workflow decided the first time it is overridden
            UpdateExpression="SET workflow_status = if_not_exists(workflow_status, #s), "
                             "#s = :new, overridden_by = :u, overridden_at = :t",
            ConditionExpression="incident_id = :id",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":new": new_status, ":u": user, ":t": _now(), ":id": incident_id},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return _response(409, {"message": "This incident is no longer the current one for this shipment"})
        raise

    _save_note(incident_id, user, f"Status set to {new_status}: {reason.strip()}", True)
    return _response(200, {"incident_id": incident_id, "status": new_status})


def _save_note(incident_id, author, text, override_flag):
    item = {"incident_id": incident_id, "note_ts": _now(), "author": author,
            "text": text, "override_flag": override_flag}
    notes.put_item(Item=item)
    return item


def _body(event):
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return None
    return body if isinstance(body, dict) else None


def _claims(event):
    return event["requestContext"]["authorizer"]["claims"]


def _user(event):
    return _claims(event)["email"]


def _is_reviewer(event):
    groups = _claims(event).get("cognito:groups", "")
    if isinstance(groups, str):  # can arrive as text like "[reviewers]"
        groups = groups.strip("[]").replace(",", " ").split()
    return "reviewers" in groups


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json_default(value):
    # DynamoDB returns numbers as Decimal; send them as real JSON numbers
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return str(value)

def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Vary": "Origin",
        },
        "body": json.dumps(body, default=_json_default),
    }
