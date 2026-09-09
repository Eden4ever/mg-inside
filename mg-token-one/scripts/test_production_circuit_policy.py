from __future__ import annotations

import unittest

try:
    from production_circuit_policy import evaluate_compliance
except ModuleNotFoundError:
    from scripts.production_circuit_policy import evaluate_compliance


class ProductionCircuitPolicyTest(unittest.TestCase):
    def test_matching_policy_and_release_are_compliant(self) -> None:
        release = "20260819T120000Z"
        artifact = "a" * 64
        result = evaluate_compliance(
            health={
                "status": "ready",
                "releaseId": release,
                "releaseSha256": artifact,
                "policies": {"autoCircuitBreakerEnabled": False},
            },
            environment={
                "NODE_ENV": "production",
                "AUTO_CIRCUIT_BREAKER_ENABLED": "false",
                "MG_RELEASE_ID": release,
                "MG_RELEASE_SHA256": artifact,
            },
            container_release_label=release,
            image_release_label=release,
            container_artifact_label=artifact,
            image_artifact_label=artifact,
            temporarily_disabled=0,
            expected_release_id=release,
            expected_release_sha256=artifact,
        )
        self.assertTrue(result["compliant"])
        self.assertTrue(all(result["checks"].values()))

    def test_old_or_mixed_release_is_not_compliant(self) -> None:
        result = evaluate_compliance(
            health={"status": "ready", "policies": {}},
            environment={"NODE_ENV": "production"},
            container_release_label=None,
            image_release_label="20260819T120000Z",
            container_artifact_label=None,
            image_artifact_label=None,
            temporarily_disabled=0,
        )
        self.assertFalse(result["compliant"])
        self.assertFalse(result["checks"]["releaseIdentityValid"])
        self.assertFalse(result["checks"]["releaseIdentityConsistent"])
        self.assertFalse(result["checks"]["artifactIdentityValid"])

    def test_expected_release_mismatch_fails_even_when_runtime_is_consistent(self) -> None:
        actual = "20260819T120000Z"
        artifact = "b" * 64
        result = evaluate_compliance(
            health={
                "releaseId": actual,
                "releaseSha256": artifact,
                "policies": {"autoCircuitBreakerEnabled": False},
            },
            environment={
                "NODE_ENV": "production",
                "AUTO_CIRCUIT_BREAKER_ENABLED": "false",
                "MG_RELEASE_ID": actual,
                "MG_RELEASE_SHA256": artifact,
            },
            container_release_label=actual,
            image_release_label=actual,
            container_artifact_label=artifact,
            image_artifact_label=artifact,
            temporarily_disabled=0,
            expected_release_id="20260819T130000Z",
            expected_release_sha256="c" * 64,
        )
        self.assertFalse(result["compliant"])
        self.assertFalse(result["checks"]["expectedReleaseMatches"])
        self.assertFalse(result["checks"]["expectedArtifactMatches"])


if __name__ == "__main__":
    unittest.main()
