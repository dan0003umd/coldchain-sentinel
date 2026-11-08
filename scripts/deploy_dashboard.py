#!/usr/bin/env python3
"""Configure and publish the static reviewer dashboard for a deployed SAM stack."""

import argparse
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = ROOT / "dashboard"


def run(command):
    return subprocess.run(command, check=True, text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stack", default="coldchain-sentinel")
    parser.add_argument("--region", default="us-east-1")
    args = parser.parse_args()

    result = run([
        "aws", "cloudformation", "describe-stacks",
        "--stack-name", args.stack,
        "--region", args.region,
        "--output", "json",
    ])
    outputs = {
        item["OutputKey"]: item["OutputValue"]
        for item in json.loads(result.stdout)["Stacks"][0].get("Outputs", [])
    }
    required = {
        "ReviewerApiUrl", "DashboardBucketName", "DashboardDistributionId",
        "ReviewerUserPoolId", "ReviewerUserPoolClientId",
    }
    missing = required - outputs.keys()
    if missing:
        raise SystemExit(
            "Stack outputs missing: " + ", ".join(sorted(missing)) +
            ". Deploy the updated template first."
        )

    # read by dashboard/api.js (loadConfig); sign-in uses SRP, so no hosted-UI domain
    config = {
        "apiUrl": outputs["ReviewerApiUrl"],
        "userPoolId": outputs["ReviewerUserPoolId"],
        "clientId": outputs["ReviewerUserPoolClientId"],
    }
    config_path = DASHBOARD_DIR / "config.json"
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

    run([
        "aws", "s3", "sync", str(DASHBOARD_DIR),
        f"s3://{outputs['DashboardBucketName']}",
        "--delete", "--cache-control", "max-age=300",
        "--region", args.region,
    ])
    run([
        "aws", "cloudfront", "create-invalidation",
        "--distribution-id", outputs["DashboardDistributionId"],
        "--paths", "/*",
    ])
    print("Dashboard deployed: " + outputs.get("DashboardUrl", "(see CloudFormation stack outputs)"))


if __name__ == "__main__":
    main()
