import argparse, json, random, time
from datetime import datetime, timezone
import boto3

REGION = "us-east-1"
TOPIC = "coldchain/readings"
ep = boto3.client("iot", region_name=REGION).describe_endpoint(endpointType="iot:Data-ATS")["endpointAddress"]
iot = boto3.client("iot-data", region_name=REGION, endpoint_url=f"https://{ep}")

def send(shipment, sensor, seq, temp, ts=None):
    msg = {"shipment_id": shipment, "sensor_id": sensor,
           "timestamp": ts or datetime.now(timezone.utc).isoformat(),
           "temp_c": temp, "seq_no": seq}
    iot.publish(topic=TOPIC, qos=1, payload=json.dumps(msg))
    print("sent", msg)

def run(mode, shipment="SHP-001", sensor="SNS-001", n=20, interval=1.0):
    for seq in range(1, n + 1):
        temp = round(random.uniform(2.0, 4.0), 1)
        if mode == "sustained" and seq > 8:
            temp = round(random.uniform(7.0, 9.0), 1)
        if mode == "spike" and seq in (8, 9):
            temp = 8.5
        if mode == "dropout" and seq > 8:
            return
        if mode == "invalid" and seq % 5 == 0:
            temp = 999
        send(shipment, sensor, seq, temp)
        if mode == "duplicate" and seq % 5 == 0:
            send(shipment, sensor, seq, temp)
        time.sleep(interval)

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["normal", "sustained", "spike", "dropout", "invalid", "duplicate"])
    run(p.parse_args().mode)