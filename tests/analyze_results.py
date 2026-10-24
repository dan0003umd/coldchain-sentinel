
from datetime import datetime


def calculate_latency(start_time, end_time):
    """Calculate elapsed time in seconds between two timestamps."""
    start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
    end = datetime.fromisoformat(end_time.replace("Z", "+00:00"))

    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("Timestamps must include a timezone")

    return (end - start).total_seconds()


if __name__ == "__main__":
    # Example timestamps for testing locally
    reading_time = "2026-10-24T10:00:00+00:00"
    incident_time = "2026-10-24T10:00:02.500000+00:00"

    latency = calculate_latency(reading_time, incident_time)

    print(f"Detection latency: {latency:.2f} seconds")
