"""Command-line interface for Gatekeeper automation."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from gatekeeper.client import GatekeeperClient, GatekeeperError


def _client_from_env(args: argparse.Namespace) -> GatekeeperClient:
    return GatekeeperClient(
        base_url=args.base_url
        or os.environ.get("GATEKEEPER_BASE_URL", "http://127.0.0.1:3000"),
        actor_id=args.actor_id or os.environ.get("GATEKEEPER_ACTOR_ID"),
        actor_label=args.actor_label or os.environ.get("GATEKEEPER_ACTOR_LABEL"),
        timeout=args.timeout,
    )


def _print_json(data: object) -> None:
    print(json.dumps(data, indent=2, default=str))


def _cmd_health(args: argparse.Namespace) -> int:
    client = _client_from_env(args)
    _print_json(client.health())
    return 0


def _cmd_stems(args: argparse.Namespace) -> int:
    client = _client_from_env(args)
    _print_json(client.list_stems())
    return 0


def _cmd_audit(args: argparse.Namespace) -> int:
    client = _client_from_env(args)
    _print_json(client.audit_events(limit=args.limit))
    return 0


def _cmd_upload(args: argparse.Namespace) -> int:
    client = _client_from_env(args)
    result = client.upload_file(
        args.file,
        title=args.title,
        owner=args.owner,
        content_type=args.content_type,
    )
    _print_json(result)
    if result.get("mockCloud") and not result.get("uploadedToS3"):
        print(
            "\nNote: mock cloud mode — metadata recorded but file was not sent to S3.",
            file=sys.stderr,
        )
    return 0


def _cmd_download(args: argparse.Namespace) -> int:
    client = _client_from_env(args)
    _print_json(client.download_file(args.stem_id, args.output))
    return 0


def _cmd_presign_upload(args: argparse.Namespace) -> int:
    client = _client_from_env(args)
    _print_json(
        client.presign_upload(
            file_path=Path(args.file),
            title=args.title,
            owner=args.owner,
            content_type=args.content_type,
        )
    )
    return 0


def _cmd_complete_upload(args: argparse.Namespace) -> int:
    client = _client_from_env(args)
    size = Path(args.file).stat().st_size if args.file else None
    _print_json(client.complete_upload(args.stem_id, size_bytes=size))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gatekeeper",
        description="Automate the Gatekeeper Audio API from Python",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="API base URL (default: GATEKEEPER_BASE_URL or http://127.0.0.1:3000)",
    )
    parser.add_argument("--actor-id", default=None, help="Actor ID for audit events")
    parser.add_argument(
        "--actor-label",
        default=None,
        help="Human-readable actor label for audit events",
    )
    parser.add_argument("--timeout", type=float, default=60.0, help="HTTP timeout seconds")

    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("health", help="Check API, MongoDB, and S3 configuration").set_defaults(
        func=_cmd_health
    )

    sub.add_parser("stems", help="List recent stems").set_defaults(func=_cmd_stems)

    audit = sub.add_parser("audit", help="List recent audit events")
    audit.add_argument("--limit", type=int, default=50)
    audit.set_defaults(func=_cmd_audit)

    upload = sub.add_parser("upload", help="Upload a file (presign → S3 → complete)")
    upload.add_argument("file", type=Path, help="Local file to upload")
    upload.add_argument("--title", required=True)
    upload.add_argument("--owner", required=True)
    upload.add_argument("--content-type", default=None)
    upload.set_defaults(func=_cmd_upload)

    download = sub.add_parser("download", help="Download a stem by ID")
    download.add_argument("stem_id", help="Stem ID from upload or list")
    download.add_argument("-o", "--output", type=Path, required=True, help="Output file path")
    download.set_defaults(func=_cmd_download)

    presign = sub.add_parser("presign-upload", help="Only request an upload presign URL")
    presign.add_argument("file", type=Path)
    presign.add_argument("--title", required=True)
    presign.add_argument("--owner", required=True)
    presign.add_argument("--content-type", default=None)
    presign.set_defaults(func=_cmd_presign_upload)

    complete = sub.add_parser("complete-upload", help="Mark an upload as complete")
    complete.add_argument("stem_id")
    complete.add_argument(
        "--file",
        type=Path,
        default=None,
        help="If set, sizeBytes is taken from this file",
    )
    complete.set_defaults(func=_cmd_complete_upload)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except GatekeeperError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        if exc.body is not None:
            _print_json(exc.body)
        return 1
    except FileNotFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
