"""Security scanning and auto-remediation for Gatekeeper audio workflows."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, TYPE_CHECKING

from gatekeeper.transcoder import FORMAT_PROFILES, AudioTranscoder, TranscodeError

if TYPE_CHECKING:
    from gatekeeper.client import GatekeeperClient

ALLOWED_CONTENT_TYPES = frozenset(
    profile["content_type"] for profile in FORMAT_PROFILES.values()
)
ALLOWED_EXTENSIONS = frozenset(
    profile["extension"] for profile in FORMAT_PROFILES.values()
)
BLOCKED_EXTENSIONS = frozenset(
    {
        ".exe",
        ".dll",
        ".sh",
        ".bat",
        ".cmd",
        ".ps1",
        ".js",
        ".html",
        ".php",
        ".zip",
        ".jar",
    }
)
PATH_TRAVERSAL_RE = re.compile(r"(\.\./|\.\\|/|\\)")


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass
class SecurityFinding:
    code: str
    message: str
    severity: Severity
    remediated: bool = False
    resource_id: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class RemediationResult:
    findings: list[SecurityFinding]
    output_path: Path | None = None
    content_type: str | None = None


class SecurityScanner:
    """Detect security risks in local files and remote Gatekeeper state."""

    def scan_file(self, file_path: Path | str) -> list[SecurityFinding]:
        path = Path(file_path).resolve()
        findings: list[SecurityFinding] = []

        if not path.is_file():
            findings.append(
                SecurityFinding(
                    code="file_missing",
                    message=f"File does not exist: {path}",
                    severity=Severity.CRITICAL,
                )
            )
            return findings

        suffix = path.suffix.lower()
        if suffix in BLOCKED_EXTENSIONS:
            findings.append(
                SecurityFinding(
                    code="blocked_extension",
                    message=f"Blocked file type {suffix} (possible executable or archive)",
                    severity=Severity.CRITICAL,
                    detail={"extension": suffix},
                )
            )

        if suffix and suffix not in ALLOWED_EXTENSIONS:
            findings.append(
                SecurityFinding(
                    code="extension_not_allowlisted",
                    message=f"Extension {suffix} is not in Gatekeeper allowlist",
                    severity=Severity.MEDIUM,
                    detail={"extension": suffix},
                )
            )

        if PATH_TRAVERSAL_RE.search(path.name):
            findings.append(
                SecurityFinding(
                    code="path_traversal_filename",
                    message="Filename contains path traversal characters",
                    severity=Severity.HIGH,
                    detail={"filename": path.name},
                )
            )

        if path.stat().st_size == 0:
            findings.append(
                SecurityFinding(
                    code="empty_file",
                    message="File is empty",
                    severity=Severity.HIGH,
                )
            )

        return findings

    def scan_api(self, client: GatekeeperClient) -> list[SecurityFinding]:
        findings: list[SecurityFinding] = []

        try:
            health = client.health()
        except Exception as exc:  # noqa: BLE001 — surface API reachability
            findings.append(
                SecurityFinding(
                    code="api_unreachable",
                    message=f"Cannot reach Gatekeeper API: {exc}",
                    severity=Severity.CRITICAL,
                )
            )
            return findings

        if not health.get("mongo"):
            findings.append(
                SecurityFinding(
                    code="mongo_not_configured",
                    message="MongoDB is not connected — audit trail may be incomplete",
                    severity=Severity.HIGH,
                )
            )

        if not health.get("s3"):
            findings.append(
                SecurityFinding(
                    code="s3_not_configured",
                    message="S3 is not configured — uploads use mock mode or fail",
                    severity=Severity.HIGH,
                )
            )

        try:
            stems = client.list_stems()
        except Exception as exc:  # noqa: BLE001
            findings.append(
                SecurityFinding(
                    code="stems_list_failed",
                    message=f"Could not list stems: {exc}",
                    severity=Severity.MEDIUM,
                )
            )
            return findings

        for stem in stems:
            stem_id = stem.get("stemId", "?")
            content_type = stem.get("contentType", "")
            status = stem.get("status", "")

            if content_type and content_type not in ALLOWED_CONTENT_TYPES:
                findings.append(
                    SecurityFinding(
                        code="stem_content_type_risk",
                        message=(
                            f"Stem {stem_id} has non-allowlisted content type "
                            f"{content_type!r}"
                        ),
                        severity=Severity.MEDIUM,
                        resource_id=stem_id,
                        detail={"contentType": content_type},
                    )
                )

            if status == "pending_upload":
                findings.append(
                    SecurityFinding(
                        code="stale_pending_upload",
                        message=f"Stem {stem_id} is still pending_upload",
                        severity=Severity.LOW,
                        resource_id=stem_id,
                    )
                )

            s3_key = stem.get("s3Key", "")
            if PATH_TRAVERSAL_RE.search(s3_key):
                findings.append(
                    SecurityFinding(
                        code="stem_s3_key_risk",
                        message=f"Stem {stem_id} s3Key contains suspicious path segments",
                        severity=Severity.HIGH,
                        resource_id=stem_id,
                        detail={"s3Key": s3_key},
                    )
                )

        return findings


class SecurityRemediator:
    """Auto-fix local file risks before upload (transcode, sanitize, validate)."""

    def __init__(
        self,
        transcoder: AudioTranscoder | None = None,
        output_format: str = "flac",
    ) -> None:
        self.output_format = output_format
        self._transcoder = transcoder

    def remediate_file(
        self,
        file_path: Path | str,
        *,
        output_dir: Path | str | None = None,
        force_transcode: bool = False,
    ) -> RemediationResult:
        path = Path(file_path).resolve()
        scanner = SecurityScanner()
        findings = scanner.scan_file(path)

        critical = [f for f in findings if f.severity == Severity.CRITICAL]
        if any(f.code == "blocked_extension" for f in critical):
            return RemediationResult(findings=findings)

        suffix = path.suffix.lower()
        needs_transcode = force_transcode or (
            suffix not in ALLOWED_EXTENSIONS
            or any(f.code == "extension_not_allowlisted" for f in findings)
        )

        output_path = path
        content_type: str | None = None

        if needs_transcode:
            try:
                transcoder = self._transcoder or AudioTranscoder()
            except TranscodeError as exc:
                findings.append(
                    SecurityFinding(
                        code="transcode_unavailable",
                        message=str(exc),
                        severity=Severity.HIGH,
                    )
                )
                return RemediationResult(findings=findings)

            if output_dir:
                out_dir = Path(output_dir)
                profile = FORMAT_PROFILES[self.output_format]
                safe_name = _sanitize_filename(path.stem) + str(profile["extension"])
                dst = out_dir / safe_name
            else:
                dst = None

            try:
                result = transcoder.transcode(
                    path,
                    dst,
                    output_format=self.output_format,
                    strip_metadata=True,
                )
            except (TranscodeError, FileNotFoundError) as exc:
                findings.append(
                    SecurityFinding(
                        code="transcode_failed",
                        message=str(exc),
                        severity=Severity.HIGH,
                    )
                )
                return RemediationResult(findings=findings)

            output_path = result.output_path
            content_type = result.content_type
            for finding in findings:
                if finding.code in {
                    "extension_not_allowlisted",
                    "empty_file",
                }:
                    finding.remediated = True
            findings.append(
                SecurityFinding(
                    code="transcoded",
                    message=(
                        f"Transcoded to {self.output_format} "
                        f"({result.content_type})"
                    ),
                    severity=Severity.LOW,
                    remediated=True,
                    detail={
                        "outputPath": str(result.output_path),
                        "durationSeconds": result.duration_seconds,
                    },
                )
            )
        else:
            content_type = None
            for profile in FORMAT_PROFILES.values():
                if suffix == profile["extension"]:
                    content_type = str(profile["content_type"])
                    break
            if content_type is None:
                content_type = str(FORMAT_PROFILES[self.output_format]["content_type"])

        safe_path = output_path.parent / _sanitize_filename(output_path.name)
        if safe_path != output_path:
            output_path.rename(safe_path)
            output_path = safe_path
            for finding in findings:
                if finding.code == "path_traversal_filename":
                    finding.remediated = True

        return RemediationResult(
            findings=findings,
            output_path=output_path,
            content_type=content_type,
        )

    def remediate_and_upload(
        self,
        client: GatekeeperClient,
        file_path: Path | str,
        *,
        title: str,
        owner: str,
        output_dir: Path | str | None = None,
    ) -> dict[str, Any]:
        """Scan, remediate locally, then upload the safe artifact."""
        remediation = self.remediate_file(file_path, output_dir=output_dir)

        unresolved = [
            f
            for f in remediation.findings
            if f.severity in (Severity.CRITICAL, Severity.HIGH) and not f.remediated
        ]
        if unresolved or remediation.output_path is None:
            return {
                "ok": False,
                "findings": [_finding_to_dict(f) for f in remediation.findings],
            }

        upload = client.upload_file(
            remediation.output_path,
            title=title,
            owner=owner,
            content_type=remediation.content_type,
        )
        return {
            "ok": True,
            "findings": [_finding_to_dict(f) for f in remediation.findings],
            "upload": upload,
            "uploadedPath": str(remediation.output_path),
            "contentType": remediation.content_type,
        }


def _sanitize_filename(name: str) -> str:
    cleaned = PATH_TRAVERSAL_RE.sub("_", name)
    cleaned = re.sub(r"[^\w.\- ]", "_", cleaned).strip()
    return cleaned[:200] or "stem"


def _finding_to_dict(finding: SecurityFinding) -> dict[str, Any]:
    return {
        "code": finding.code,
        "message": finding.message,
        "severity": finding.severity.value,
        "remediated": finding.remediated,
        "resourceId": finding.resource_id,
        "detail": finding.detail,
    }
