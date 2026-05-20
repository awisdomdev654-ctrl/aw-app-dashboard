"""FFmpeg-based audio transcoding for Gatekeeper stems."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

# Gatekeeper-allowed MIME types for stem uploads
FORMAT_PROFILES: dict[str, dict[str, str | int]] = {
    "flac": {
        "extension": ".flac",
        "content_type": "audio/flac",
        "codec": "flac",
    },
    "wav": {
        "extension": ".wav",
        "content_type": "audio/wav",
        "codec": "pcm_s16le",
    },
    "mp3": {
        "extension": ".mp3",
        "content_type": "audio/mpeg",
        "codec": "libmp3lame",
    },
    "aac": {
        "extension": ".m4a",
        "content_type": "audio/mp4",
        "codec": "aac",
    },
}


class TranscodeError(Exception):
    """Raised when ffmpeg is missing or transcoding fails."""


@dataclass(frozen=True)
class TranscodeResult:
    input_path: Path
    output_path: Path
    format: str
    content_type: str
    duration_seconds: float | None


class AudioTranscoder:
    """Transcode local audio files to Gatekeeper-safe formats via ffmpeg."""

    def __init__(self, ffmpeg_bin: str | None = None) -> None:
        self.ffmpeg_bin = ffmpeg_bin or shutil.which("ffmpeg")
        if not self.ffmpeg_bin:
            raise TranscodeError(
                "ffmpeg not found on PATH. Install ffmpeg to use transcoding."
            )

    @staticmethod
    def supported_formats() -> list[str]:
        return list(FORMAT_PROFILES.keys())

    def transcode(
        self,
        input_path: Path | str,
        output_path: Path | str | None = None,
        *,
        output_format: str = "flac",
        sample_rate: int = 48000,
        channels: int = 2,
        bitrate: str = "320k",
        strip_metadata: bool = True,
    ) -> TranscodeResult:
        """Transcode audio to a normalized, allowlisted format."""
        src = Path(input_path).resolve()
        if not src.is_file():
            raise FileNotFoundError(str(src))

        profile = FORMAT_PROFILES.get(output_format.lower())
        if not profile:
            raise TranscodeError(
                f"Unsupported format {output_format!r}. "
                f"Choose from: {', '.join(FORMAT_PROFILES)}"
            )

        if output_path is None:
            dst = src.with_suffix(str(profile["extension"]))
        else:
            dst = Path(output_path).resolve()

        dst.parent.mkdir(parents=True, exist_ok=True)

        cmd: list[str] = [
            self.ffmpeg_bin,
            "-y",
            "-i",
            str(src),
            "-vn",
            "-ac",
            str(channels),
            "-ar",
            str(sample_rate),
        ]

        if strip_metadata:
            cmd.extend(["-map_metadata", "-1"])

        codec = str(profile["codec"])
        if codec == "libmp3lame":
            cmd.extend(["-c:a", codec, "-b:a", bitrate])
        elif codec == "aac":
            cmd.extend(["-c:a", codec, "-b:a", bitrate])
        else:
            cmd.extend(["-c:a", codec])

        cmd.append(str(dst))

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            stderr = (proc.stderr or "").strip()
            raise TranscodeError(
                f"ffmpeg failed (exit {proc.returncode}): {stderr[-500:]}"
            )

        duration = self._probe_duration(dst)
        return TranscodeResult(
            input_path=src,
            output_path=dst,
            format=output_format.lower(),
            content_type=str(profile["content_type"]),
            duration_seconds=duration,
        )

    def _probe_duration(self, path: Path) -> float | None:
        ffprobe = shutil.which("ffprobe")
        if not ffprobe:
            return None

        proc = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            return None
        try:
            return float(proc.stdout.strip())
        except ValueError:
            return None
