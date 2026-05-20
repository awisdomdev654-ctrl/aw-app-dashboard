"""Command-line interface for Gatekeeper automation."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from gatekeeper.client import GatekeeperClient, GatekeeperError
from gatekeeper.security import SecurityRemediator, SecurityScanner, _finding_to_dict
from gatekeeper.transcoder import AudioTranscoder, TranscodeError


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
            Path(args.file),
            title=args.title,
            owner=args.owner,
            content_type=args.content_type,
        )
    )
    return 0


def _cmd_complete_upload(args: argparse.Namespace) -> int:
    client = _client_from_env(args)
    size = None
    if args.file:
        size = Path(args.file).stat().st_size
    _print_json(client.complete_upload(args.stem_id, size_bytes=size))
    return 0


def _cmd_transcode(args: argparse.Namespace) -> int:
    transcoder = AudioTranscoder(ffmpeg_bin=args.ffmpeg)
    result = transcoder.transcode(
        args.file,
        args.output,
        output_format=args.format,
        sample_rate=args.sample_rate,
        channels=args.channels,
        bitrate=args.bitrate,
        strip_metadata=not args.keep_metadata,
    )
    _print_json(
        {
            "inputPath": str(result.input_path),
            "outputPath": str(result.output_path),
            "format": result.format,
            "contentType": result.content_type,
            "durationSeconds": result.duration_seconds,
        }
    )
    return 0


def _cmd_scan_security(args: argparse.Namespace) -> int:
    if not args.file and not args.api:
        print("Error: provide a file path and/or --api", file=sys.stderr)
        return 2

    scanner = SecurityScanner()
    findings: list = []

    if args.file:
        findings.extend(scanner.scan_file(args.file))

    if args.api:
        client = _client_from_env(args)
        findings.extend(scanner.scan_api(client))

    _print_json(
        {
            "findingCount": len(findings),
            "findings": [_finding_to_dict(f) for f in findings],
        }
    )
    return 1 if any(f.severity.value in ("high", "critical") for f in findings) else 0


def _cmd_remediate(args: argparse.Namespace) -> int:
    remediator = SecurityRemediator(output_format=args.format)

    if args.upload:
        client = _client_from_env(args)
        result = remediator.remediate_and_upload(
            client,
            args.file,
            title=args.title,
            owner=args.owner,
            output_dir=args.output_dir,
        )
        _print_json(result)
        return 0 if result.get("ok") else 1

    result = remediator.remediate_file(
        args.file,
        output_dir=args.output_dir,
        force_transcode=args.force_transcode,
    )
    _print_json(
        {
            "ok": not any(
                f.severity.value in ("high", "critical") and not f.remediated
                for f in result.findings
            ),
            "outputPath": str(result.output_path) if result.output_path else None,
            "contentType": result.content_type,
            "findings": [_finding_to_dict(f) for f in result.findings],
        }
    )
    return 0


def _cmd_pipeline(args: argparse.Namespace) -> int:
    """Transcode → security remediate → upload in one step."""
    remediator = SecurityRemediator(output_format=args.format)
    client = _client_from_env(args)
    result = remediator.remediate_and_upload(
        client,
        args.file,
        title=args.title,
        owner=args.owner,
        output_dir=args.output_dir,
    )
    _print_json(result)
    if not result.get("ok"):
        return 1
    if result.get("upload", {}).get("mockCloud"):
        print(
            "\nNote: mock cloud mode — metadata recorded but file was not sent to S3.",
            file=sys.stderr,
        )
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
    parser.add_argument("--actor-id", help="Actor ID for audit events")
    parser.add_argument(
        "--actor-label",
        help="Human-readable actor label for audit events",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=60.0,
        help="HTTP timeout seconds",
    )

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
    upload.add_argument("--content-type")
    upload.set_defaults(func=_cmd_upload)

    download = sub.add_parser("download", help="Download a stem by ID")
    download.add_argument("stem_id", help="Stem ID from upload or list")
    download.add_argument("-o", "--output", type=Path, required=True)
    download.set_defaults(func=_cmd_download)

    presign = sub.add_parser("presign-upload", help="Only request an upload presign URL")
    presign.add_argument("file", type=Path)
    presign.add_argument("--title", required=True)
    presign.add_argument("--owner", required=True)
    presign.add_argument("--content-type")
    presign.set_defaults(func=_cmd_presign_upload)

    complete = sub.add_parser("complete-upload", help="Mark an upload as complete")
    complete.add_argument("stem_id")
    complete.add_argument("--file", type=Path, help="If set, sizeBytes is taken from this file")
    complete.set_defaults(func=_cmd_complete_upload)

    transcode = sub.add_parser("transcode", help="Transcode audio via ffmpeg")
    transcode.add_argument("file", type=Path, help="Source audio file")
    transcode.add_argument("-o", "--output", type=Path, help="Output path")
    transcode.add_argument(
        "--format",
        choices=["flac", "wav", "mp3", "aac"],
        default="flac",
    )
    transcode.add_argument("--sample-rate", type=int, default=48000)
    transcode.add_argument("--channels", type=int, default=2)
    transcode.add_argument("--bitrate", default="320k")
    transcode.add_argument("--ffmpeg", help="Path to ffmpeg binary")
    transcode.add_argument("--keep-metadata", action="store_true")
    transcode.set_defaults(func=_cmd_transcode)

    scan = sub.add_parser("scan-security", help="Scan files and/or API for security risks")
    scan.add_argument("file", type=Path, nargs="?", help="Local file to scan")
    scan.add_argument(
        "--api",
        action="store_true",
        help="Also scan Gatekeeper API health and stem metadata",
    )
    scan.set_defaults(func=_cmd_scan_security)

    remediate = sub.add_parser(
        "remediate",
        help="Auto-fix local file risks (transcode, sanitize filename)",
    )
    remediate.add_argument("file", type=Path)
    remediate.add_argument(
        "--output-dir",
        type=Path,
        help="Directory for remediated output",
    )
    remediate.add_argument(
        "--format",
        choices=["flac", "wav", "mp3", "aac"],
        default="flac",
    )
    remediate.add_argument(
        "--force-transcode",
        action="store_true",
        help="Always transcode even if extension is allowlisted",
    )
    remediate.add_argument(
        "--upload",
        action="store_true",
        help="Upload remediated file after fixes",
    )
    remediate.add_argument("--title")
    remediate.add_argument("--owner")
    remediate.set_defaults(func=_cmd_remediate)

    pipeline = sub.add_parser(
        "pipeline",
        help="Transcode + remediate + upload (recommended for new stems)",
    )
    pipeline.add_argument("file", type=Path)
    pipeline.add_argument("--title", required=True)
    pipeline.add_argument("--owner", required=True)
    pipeline.add_argument("--output-dir", type=Path)
    pipeline.add_argument(
        "--format",
        choices=["flac", "wav", "mp3", "aac"],
        default="flac",
    )
    pipeline.set_defaults(func=_cmd_pipeline)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if getattr(args, "command", None) == "remediate" and args.upload:
        if not args.title or not args.owner:
            parser.error("remediate --upload requires --title and --owner")

    try:
        return args.func(args)
    except GatekeeperError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        if exc.body is not None:
            _print_json(exc.body)
        return 1
    except (TranscodeError, FileNotFoundError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
