"""Evaluate production circuit-breaker and release identity compliance."""

from __future__ import annotations

import re
from typing import Any


RELEASE_ID_PATTERN = re.compile(r"^\d{8}T\d{6}Z$")


def evaluate_compliance(
    *,
    health: dict[str, Any],
    environment: dict[str, str],
    container_release_label: str | None,
    image_release_label: str | None,
    container_artifact_label: str | None,
    image_artifact_label: str | None,
    temporarily_disabled: int,
    expected_release_id: str | None = None,
    expected_release_sha256: str | None = None,
) -> dict[str, Any]:
    release_id = environment.get("MG_RELEASE_ID")
    health_release_id = health.get("releaseId")
    release_sha256 = environment.get("MG_RELEASE_SHA256")
    health_release_sha256 = health.get("releaseSha256")
    effective_policy = health.get("policies", {}).get(
        "autoCircuitBreakerEnabled"
    )
    checks = {
        "productionEnvironment": environment.get("NODE_ENV") == "production",
        "environmentFlagDisabled": environment.get(
            "AUTO_CIRCUIT_BREAKER_ENABLED"
        )
        == "false",
        "effectivePolicyDisabled": effective_policy is False,
        "noTemporaryCircuitState": temporarily_disabled == 0,
        "releaseIdentityValid": bool(
            release_id and RELEASE_ID_PATTERN.fullmatch(release_id)
        ),
        "releaseIdentityConsistent": bool(
            release_id
            and release_id == health_release_id
            and release_id == container_release_label
            and release_id == image_release_label
        ),
        "expectedReleaseMatches": bool(
            not expected_release_id or release_id == expected_release_id
        ),
        "artifactIdentityValid": bool(
            release_sha256 and re.fullmatch(r"[a-f0-9]{64}", release_sha256)
        ),
        "artifactIdentityConsistent": bool(
            release_sha256
            and release_sha256 == health_release_sha256
            and release_sha256 == container_artifact_label
            and release_sha256 == image_artifact_label
        ),
        "expectedArtifactMatches": bool(
            not expected_release_sha256
            or release_sha256 == expected_release_sha256
        ),
    }
    return {
        "compliant": all(checks.values()),
        "checks": checks,
        "release": {
            "expected": expected_release_id,
            "environment": release_id,
            "health": health_release_id,
            "containerLabel": container_release_label,
            "imageLabel": image_release_label,
        },
        "artifact": {
            "expected": expected_release_sha256,
            "environment": release_sha256,
            "health": health_release_sha256,
            "containerLabel": container_artifact_label,
            "imageLabel": image_artifact_label,
        },
    }
