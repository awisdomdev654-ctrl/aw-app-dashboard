#!/usr/bin/env python3
"""Example: upload every file in a directory via Gatekeeper."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow running without installing the package
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gatekeeper import GatekeeperClient, GatekeeperError


def main() -> int:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <directory> <owner>", file=sys.stderr)
        return 2

    directory = Path(sys.argv[1])
    owner = sys.argv[2]
    if not directory.is_dir():
        print(f"Not a directory: {directory}", file=sys.stderr)
        return 2

    client = GatekeeperClient(
        base_url=os.environ.get("GATEKEEPER_BASE_URL", "http://127.0.0.1:3000"),
        actor_id=os.environ.get("GATEKEEPER_ACTOR_ID", "batch-upload"),
        actor_label=os.environ.get("GATEKEEPER_ACTOR_LABEL", "batch_upload.py"),
    )

    files = sorted(p for p in directory.iterdir() if p.is_file())
    if not files:
        print("No files found.", file=sys.stderr)
        return 1

    print(f"Uploading {len(files)} file(s) to {client.base_url} …")
    for path in files:
        try:
            result = client.upload_file(path, title=path.stem, owner=owner)
            print(f"  OK  {path.name} → stemId={result['stemId']}")
        except (GatekeeperError, FileNotFoundError) as exc:
            print(f"  FAIL {path.name}: {exc}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
