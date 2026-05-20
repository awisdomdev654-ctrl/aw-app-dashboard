"""HTTP client for Gatekeeper API (stems, uploads, downloads, audit)."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

import requests


class GatekeeperError(Exception):
    """Raised when the API returns an error response."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class GatekeeperClient:
    """Automate stem upload/download against the Next.js Gatekeeper backend."""

    def __init__(
        self,
        base_url: str,
        actor_id: str | None = None,
        actor_label: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.actor_id = actor_id
        self.actor_label = actor_label
        self.timeout = timeout
        self._session = requests.Session()

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _actor_fields(self) -> dict[str, str]:
        fields: dict[str, str] = {}
        if self.actor_id:
            fields["actorId"] = self.actor_id
        if self.actor_label:
            fields["actorLabel"] = self.actor_label
        return fields

    def _request(
        self,
        method: str,
        path: str,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        response = self._session.request(
            method,
            self._url(path),
            timeout=self.timeout,
            json=json,
            params=params,
        )
        try:
            data = response.json()
        except ValueError:
            data = None

        if not response.ok:
            detail = data if data is not None else response.text
            raise GatekeeperError(
                f"{method} {path} failed ({response.status_code})",
                status_code=response.status_code,
                body=detail,
            )
        return data

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/health")

    def list_stems(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/stems")
        return data.get("stems", [])

    def audit_events(self, limit: int = 50) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/audit", params={"limit": limit})
        return data.get("events", [])

    def presign_upload(
        self,
        file_path: Path,
        title: str,
        owner: str,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        path = file_path.resolve()
        if not path.is_file():
            raise FileNotFoundError(str(path))

        guessed, _ = mimetypes.guess_type(path.name)
        payload = {
            "filename": path.name,
            "contentType": content_type or guessed or "application/octet-stream",
            "title": title,
            "owner": owner,
            **self._actor_fields(),
        }
        return self._request("POST", "/api/upload/presign", json=payload)

    def complete_upload(
        self,
        stem_id: str,
        size_bytes: int | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"stemId": stem_id, **self._actor_fields()}
        if size_bytes is not None:
            payload["sizeBytes"] = size_bytes
        return self._request("POST", "/api/upload/complete", json=payload)

    def presign_download(self, stem_id: str) -> dict[str, Any]:
        payload = {"stemId": stem_id, **self._actor_fields()}
        return self._request("POST", "/api/download/presign", json=payload)

    def upload_file(
        self,
        file_path: Path | str,
        title: str,
        owner: str,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        """Presign, PUT bytes to S3, then mark upload complete."""
        path = Path(file_path)
        presign = self.presign_upload(path, title, owner, content_type)

        guessed_type, _ = mimetypes.guess_type(path.name)
        upload_url = presign.get("uploadUrl")
        stem_id = presign["stemId"]

        uploaded_to_s3 = False
        if upload_url:
            with path.open("rb") as handle:
                put = self._session.put(
                    upload_url,
                    data=handle,
                    timeout=self.timeout,
                    headers={
                        "Content-Type": content_type
                        or guessed_type
                        or "application/octet-stream",
                        "x-amz-server-side-encryption": "AES256",
                    },
                )
            if not put.ok:
                raise GatekeeperError(
                    f"S3 PUT failed ({put.status_code})",
                    status_code=put.status_code,
                    body=put.text,
                )
            uploaded_to_s3 = True
        elif not presign.get("mockCloud"):
            raise GatekeeperError(
                "No uploadUrl in presign response (S3 may be misconfigured)",
                body=presign,
            )

        complete = self.complete_upload(stem_id, path.stat().st_size)
        return {
            "stemId": stem_id,
            "s3Key": presign.get("s3Key"),
            "mockCloud": bool(presign.get("mockCloud")),
            "uploadedToS3": uploaded_to_s3,
            "complete": complete,
        }

    def download_file(
        self,
        stem_id: str,
        output_path: Path | str,
    ) -> dict[str, Any]:
        """Presign GET URL and write object bytes to disk."""
        out = Path(output_path)
        presign = self.presign_download(stem_id)

        download_url = presign.get("downloadUrl")
        if presign.get("mockCloud"):
            raise GatekeeperError(
                "GATEKEEPER_MOCK_CLOUD is enabled; no real download URL",
                body=presign,
            )
        if not download_url:
            raise GatekeeperError(
                "No downloadUrl in presign response",
                body=presign,
            )

        get = self._session.get(download_url, timeout=self.timeout)
        if not get.ok:
            raise GatekeeperError(
                f"S3 GET failed ({get.status_code})",
                status_code=get.status_code,
                body=get.text,
            )

        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(get.content)

        return {
            "stemId": stem_id,
            "outputPath": str(out.resolve()),
            "bytesWritten": len(get.content),
            "expiresIn": presign.get("expiresIn"),
        }
