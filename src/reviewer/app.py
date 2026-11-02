import base64
import json
import os

import boto3
from boto3.dynamodb.conditions import Attr

incidents = boto3.resource("dynamodb").Table(os.environ["INCIDENTS_TABLE"])
ALLOWED_ORIGIN = os.environ["ALLOWED_ORIGIN"]
ALLOWED_STATUSES = {"OPEN", "ESCALATED", "RESOLVED"}


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


def _response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Vary": "Origin",
        },
        "body": json.dumps(body, default=str),
    }
