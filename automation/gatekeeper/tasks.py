"""JSON task entrypoints invoked by the Next.js automation API."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from gatekeeper.client import GatekeeperClient
from gatekeeper.security import SecurityRemediator, SecurityScanner, _finding_to_dict


def _client() -> GatekeeperClient:
    return GatekeeperClient(
        base_url=os.environ.get("GATEKEEPER_BASE_URL", "http://127.0.0.1:3000"),
        actor_id=os.environ.get("GATEKEEPER_ACTOR_ID", "dashboard"),
        actor_label=os.environ.get(
            "GATEKEEPER_ACTOR_LABEL", "gatekeeper-automation"
        ),
    )


def scan_api() -> dict[str, Any]:
    scanner = SecurityScanner()
    findings = scanner.scan_api(_client())
    critical = sum(
        1 for f in findings if f.severity.value in ("high", "critical")
    )
    return {
        "ok": critical == 0,
        "findingCount": len(findings),
        "findings": [_finding_to_dict(f) for f in findings],
    }


def scan_file(file_path: str) -> dict[str, Any]:
    scanner = SecurityScanner()
    findings = scanner.scan_file(file_path)
    critical = sum(
        1 for f in findings if f.severity.value in ("high", "critical")
    )
    return {
        "ok": critical == 0,
        "findingCount": len(findings),
        "findings": [_finding_to_dict(f) for f in findings],
    }


def pipeline(
    file_path: str,
    title: str,
    owner: str,
    output_format: str = "flac",
) -> dict[str, Any]:
    remediator = SecurityRemediator(output_format=output_format)
    return remediator.remediate_and_upload(
        _client(),
        file_path,
        title=title,
        owner=owner,
    )


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print(json.dumps({"error": "task name required"}))
        return 2

    task = args[0]
    try:
        if task == "scan-api":
            result = scan_api()
        elif task == "scan-file" and len(args) >= 2:
            result = scan_file(args[1])
        elif task == "pipeline" and len(args) >= 4:
            result = pipeline(args[1], args[2], args[3], args[4] if len(args) > 4 else "flac")
        else:
            print(json.dumps({"error": f"unknown or incomplete task: {task}"}))
            return 2
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    print(json.dumps(result, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
