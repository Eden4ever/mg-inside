from __future__ import annotations

import pathlib
import os
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

try:
    from production_deploy_package import REQUIRED_MEMBERS, build_package, validate_package
    from production_deploy_preflight import build_preflight_script
except ModuleNotFoundError:
    from scripts.production_deploy_package import REQUIRED_MEMBERS, build_package, validate_package
    from scripts.production_deploy_preflight import build_preflight_script


ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT = ROOT / "mg-gateway"


class ProductionDeploySafetyTest(unittest.TestCase):
    def test_real_release_package_is_minimal_and_valid(self) -> None:
        with tempfile.TemporaryDirectory(prefix="token-one-package-test-") as temp:
            target = pathlib.Path(temp) / "release.tar.gz"
            build_package(PROJECT, target)
            validate_package(target)
            with tarfile.open(target, "r:gz") as archive:
                names = {member.name for member in archive.getmembers()}

        self.assertIn("apps/gateway/src/main.ts", names)
        self.assertIn("apps/gateway/src/entities/model-route.entity.ts", names)
        self.assertIn("apps/gateway/src/entities/channel-route-health.entity.ts", names)
        self.assertIn("apps/gateway/src/modules/model-route/model-route.store.ts", names)
        self.assertIn("apps/gateway/src/modules/model-route/model-route.module.ts", names)
        self.assertIn("apps/gateway/scripts/migration-add-model-routes.sql", names)
        self.assertIn("apps/gateway/scripts/migration-add-channel-route-health.sql", names)
        self.assertIn("apps/gateway/scripts/migration-add-user-quota-packages.sql", names)
        self.assertIn("apps/gateway/scripts/migration-add-user-quota-adjustments.sql", names)
        self.assertIn("apps/gateway/scripts/migration-add-quota-nonnegative-constraints.sql", names)
        self.assertIn("apps/gateway/scripts/migration-add-cctq-api-key-state.sql", names)
        self.assertIn("apps/gateway/scripts/configure-codex-responses.mjs", names)
        self.assertIn("apps/gateway/scripts/configure-codex-upstream.mjs", names)
        self.assertIn("apps/gateway/scripts/configure-cctq-claude-upstream.mjs", names)
        self.assertNotIn("apps/gateway/scripts/configure-production.mjs", names)
        self.assertIn("web-dist/index.html", names)
        self.assertNotIn("apps/gateway/seed-admin.js", names)
        self.assertFalse(any(path.endswith("/.env") for path in names))
        self.assertFalse(any(path.name.startswith(".env") for path in map(pathlib.PurePosixPath, names)))
        self.assertFalse(any(path.endswith("docker-compose.yml") for path in names))
        self.assertFalse(any("node_modules" in path.split("/") for path in names))

        dockerfile = (PROJECT / "Dockerfile").read_text(encoding="utf-8")
        self.assertNotIn("seed-admin.js", dockerfile)

    def test_release_package_never_copies_upstream_secret_environment(self) -> None:
        codex_secret = "package-must-not-contain-codex-secret"
        claude_secret = "package-must-not-contain-claude-secret"
        with tempfile.TemporaryDirectory(prefix="token-one-package-secret-") as temp:
            target = pathlib.Path(temp) / "release.tar.gz"
            previous_codex = os.environ.get("CCTQ_CODEX_KEY")
            previous_claude = os.environ.get("CCTQ_CLAUDE_KEY")
            try:
                os.environ["CCTQ_CODEX_KEY"] = codex_secret
                os.environ["CCTQ_CLAUDE_KEY"] = claude_secret
                build_package(PROJECT, target)
            finally:
                if previous_codex is None:
                    os.environ.pop("CCTQ_CODEX_KEY", None)
                else:
                    os.environ["CCTQ_CODEX_KEY"] = previous_codex
                if previous_claude is None:
                    os.environ.pop("CCTQ_CLAUDE_KEY", None)
                else:
                    os.environ["CCTQ_CLAUDE_KEY"] = previous_claude

            with tarfile.open(target, "r:gz") as archive:
                payload = bytearray()
                for member in archive.getmembers():
                    if not member.isfile():
                        continue
                    content = archive.extractfile(member)
                    if content is not None:
                        payload.extend(content.read())
        self.assertNotIn(codex_secret.encode(), payload)
        self.assertNotIn(claude_secret.encode(), payload)

    def test_package_validator_rejects_environment_files(self) -> None:
        with tempfile.TemporaryDirectory(prefix="token-one-package-reject-") as temp:
            target = pathlib.Path(temp) / "bad.tar.gz"
            payload = pathlib.Path(temp) / "payload"
            payload.write_text("secret", encoding="utf-8")
            with tarfile.open(target, "w:gz") as archive:
                for required in sorted(REQUIRED_MEMBERS):
                    archive.add(payload, arcname=required)
                archive.add(payload, arcname="apps/gateway/.env")

            with self.assertRaisesRegex(ValueError, "环境文件"):
                validate_package(target)

    def test_package_validator_rejects_seed_and_credential_risk_files(self) -> None:
        with tempfile.TemporaryDirectory(prefix="token-one-package-reject-") as temp:
            target = pathlib.Path(temp) / "bad.tar.gz"
            payload = pathlib.Path(temp) / "payload"
            payload.write_text("safe", encoding="utf-8")
            with tarfile.open(target, "w:gz") as archive:
                for required in sorted(REQUIRED_MEMBERS):
                    archive.add(payload, arcname=required)
                archive.add(payload, arcname="apps/gateway/seed-admin.js")

            with self.assertRaisesRegex(ValueError, "凭据或默认口令风险文件"):
                validate_package(target)

    def test_package_validator_rejects_renamed_default_credential_content(self) -> None:
        with tempfile.TemporaryDirectory(prefix="token-one-package-reject-") as temp:
            target = pathlib.Path(temp) / "bad.tar.gz"
            safe_payload = pathlib.Path(temp) / "safe-payload"
            risk_payload = pathlib.Path(temp) / "risk-payload"
            safe_payload.write_text("safe", encoding="utf-8")
            risk_payload.write_text("admin123", encoding="utf-8")
            with tarfile.open(target, "w:gz") as archive:
                for required in sorted(REQUIRED_MEMBERS):
                    archive.add(safe_payload, arcname=required)
                archive.add(risk_payload, arcname="apps/gateway/src/bootstrap.js")

            with self.assertRaisesRegex(ValueError, "默认口令风险内容"):
                validate_package(target)

    def test_package_validator_rejects_configured_database_password(self) -> None:
        password = "isolated-package-password-fixture"
        with tempfile.TemporaryDirectory(prefix="token-one-package-secret-") as temp:
            target = pathlib.Path(temp) / "bad.tar.gz"
            payload = pathlib.Path(temp) / "payload"
            payload.write_text("safe", encoding="utf-8")
            with tarfile.open(target, "w:gz") as archive:
                for required in sorted(REQUIRED_MEMBERS):
                    archive.add(payload, arcname=required)
                payload.write_text(password, encoding="utf-8")
                archive.add(payload, arcname="apps/gateway/src/config.js")
            with patch.dict(os.environ, {"DB_PASSWORD": password}):
                with self.assertRaisesRegex(ValueError, "默认口令风险内容"):
                    validate_package(target)

    def test_package_validator_rejects_registry_credential_in_npmrc(self) -> None:
        with tempfile.TemporaryDirectory(prefix="token-one-package-reject-") as temp:
            target = pathlib.Path(temp) / "bad.tar.gz"
            safe_payload = pathlib.Path(temp) / "safe-payload"
            risk_payload = pathlib.Path(temp) / "risk-payload"
            safe_payload.write_text("safe", encoding="utf-8")
            risk_payload.write_text("//registry.example/:_authToken=redacted", encoding="utf-8")
            with tarfile.open(target, "w:gz") as archive:
                for required in sorted(REQUIRED_MEMBERS):
                    archive.add(safe_payload, arcname=required)
                archive.add(risk_payload, arcname="apps/gateway/.npmrc")

            with self.assertRaisesRegex(ValueError, "凭据或默认口令风险内容"):
                validate_package(target)

    def test_package_validator_requires_path_health_entity_and_migration(self) -> None:
        required_path_health_members = {
            "apps/gateway/src/entities/channel-route-health.entity.ts",
            "apps/gateway/scripts/migration-add-channel-route-health.sql",
        }
        self.assertTrue(required_path_health_members.issubset(REQUIRED_MEMBERS))
        with tempfile.TemporaryDirectory(prefix="token-one-package-missing-") as temp:
            payload = pathlib.Path(temp) / "payload"
            payload.write_text("safe", encoding="utf-8")
            for missing in required_path_health_members:
                target = pathlib.Path(temp) / f"missing-{pathlib.PurePosixPath(missing).name}.tar.gz"
                with tarfile.open(target, "w:gz") as archive:
                    for required in sorted(REQUIRED_MEMBERS - {missing}):
                        archive.add(payload, arcname=required)
                with self.assertRaisesRegex(ValueError, pathlib.PurePosixPath(missing).name):
                    validate_package(target)

    def test_package_validator_requires_cctq_api_key_state_migration(self) -> None:
        migration = "apps/gateway/scripts/migration-add-cctq-api-key-state.sql"
        self.assertIn(migration, REQUIRED_MEMBERS)
        with tempfile.TemporaryDirectory(prefix="token-one-package-missing-") as temp:
            target = pathlib.Path(temp) / "missing-cctq-api-key-state.tar.gz"
            payload = pathlib.Path(temp) / "payload"
            payload.write_text("safe", encoding="utf-8")
            with tarfile.open(target, "w:gz") as archive:
                for required in sorted(REQUIRED_MEMBERS - {migration}):
                    archive.add(payload, arcname=required)

            with self.assertRaisesRegex(ValueError, "migration-add-cctq-api-key-state.sql"):
                validate_package(target)

    def test_package_validator_requires_request_log_retention_migration(self) -> None:
        migration = "apps/gateway/scripts/migration-add-request-log-retention-index.sql"
        self.assertIn(migration, REQUIRED_MEMBERS)
        with tempfile.TemporaryDirectory(prefix="token-one-package-missing-") as temp:
            target = pathlib.Path(temp) / "missing-request-log-retention.tar.gz"
            payload = pathlib.Path(temp) / "payload"
            payload.write_text("safe", encoding="utf-8")
            with tarfile.open(target, "w:gz") as archive:
                for required in sorted(REQUIRED_MEMBERS - {migration}):
                    archive.add(payload, arcname=required)

            with self.assertRaisesRegex(ValueError, "migration-add-request-log-retention-index.sql"):
                validate_package(target)

    def test_preflight_checks_runtime_before_upload(self) -> None:
        script = build_preflight_script(
            remote="/opt/mg-gateway",
            minimum_free_kilobytes=2 * 1024 * 1024,
        )
        self.assertIn("docker compose config --images", script)
        self.assertIn("MYSQL_ROOT_PASSWORD", script)
        self.assertIn("mysqldump", script)
        self.assertIn("free_kilobytes", script)
        self.assertIn("/api/health/ready", script)
        self.assertNotIn("echo \"$db_root", script)

        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe")
        if bash.is_file():
            result = subprocess.run(
                [str(bash), "-n"],
                input=script,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_main_script_runs_preflight_before_any_remote_write(self) -> None:
        source = (ROOT / "scripts" / "production-deploy.py").read_text(
            encoding="utf-8"
        )
        preflight = source.index('"发布前置检查"')
        lock = source.index('"获取生产发布锁"')
        lock_acquired = source.index("deployment_lock_acquired = True")
        upload_marker = source.index("remote_artifacts_may_exist = True")
        upload = source.index("sftp.put(")
        backup = source.index('"备份生产文件、数据库和镜像"')

        self.assertLess(preflight, upload_marker)
        self.assertLess(preflight, lock)
        self.assertLess(lock, lock_acquired)
        self.assertLess(lock, upload_marker)
        self.assertLess(lock_acquired, upload_marker)
        self.assertLess(upload_marker, upload)
        self.assertLess(upload, backup)
        self.assertIn("if remote_artifacts_may_exist:", source)
        self.assertIn("rm -rf -- apps web-dist scripts", source)
        self.assertNotIn("tar -xzf {shlex.quote(REMOTE_PACKAGE)} --overwrite", source)
        local_gate = source.index("run_local_release_gate(PROJECT)")
        package = source.index("build_package(PROJECT, package)")
        connect = source.index("ProductionSshSession(host=HOST, **credential.connect_kwargs())")
        self.assertLess(local_gate, package)
        self.assertLess(package, connect)

    def test_package_is_verified_and_database_is_refreshed_after_build(self) -> None:
        source = (ROOT / "scripts" / "production-deploy.py").read_text(
            encoding="utf-8"
        )
        upload = source.index("sftp.put(")
        transfer_check = source.index('"校验发布包传输完整性"')
        initial_backup = source.index('"备份生产文件、数据库和镜像"')
        build = source.index('"更新发布文件并构建镜像"')
        freeze = source.index('"冻结写入并刷新最终数据库备份"')
        migration = source.index('"执行数据库迁移"')

        self.assertLess(upload, transfer_check)
        self.assertLess(transfer_check, initial_backup)
        self.assertLess(initial_backup, build)
        self.assertLess(build, freeze)
        self.assertLess(freeze, migration)
        self.assertIn("sha256sum {shlex.quote(REMOTE_PACKAGE)}", source)
        self.assertIn("tar -tzf {shlex.quote(REMOTE_PACKAGE)}", source)
        self.assertIn("docker stop mg-gateway", source)
        self.assertIn("database.final.sql", source)
        self.assertIn("tail -n 1 | tr -d '\\r'", source)
        self.assertIn("umask 077", source)
        self.assertIn("stat -c %a", source)
        self.assertIn("MG_RELEASE_ID={RELEASE}", source)
        self.assertIn("--build-arg MG_RELEASE_ID={RELEASE}", source)
        self.assertIn("MG_RELEASE_SHA256={package_sha256}", source)
        self.assertIn("--build-arg MG_RELEASE_SHA256={package_sha256}", source)
        self.assertIn("com.meta-gravity.token-one.release-id", source)
        self.assertIn("com.meta-gravity.token-one.artifact-sha256", source)
        self.assertIn("release-manifest.json", source)
        image_identity_check = source.index(
            "docker image inspect mg-gateway:latest --format"
        )
        freeze = source.index('"冻结写入并刷新最终数据库备份"')
        self.assertLess(image_identity_check, freeze)
        self.assertLess(
            source.index("database.final.sql"),
            source.index("database_may_have_changed = True"),
        )

    def test_deploy_runs_route_backed_responses_acceptance_before_success(self) -> None:
        source = (ROOT / "scripts" / "production-deploy.py").read_text(
            encoding="utf-8"
        )
        migration = source.index('"执行数据库迁移"')
        configuration = source.index('"配置 Codex 原生 Responses 元数据"')
        startup = source.index('"启动并检查生产服务"')
        # 函数定义与调用点同名，取最后一次出现才是发布流程里的调用点。
        acceptance = source.rindex("run_codex_responses_acceptance()")
        deployed = source.index("deployed = True")

        self.assertLess(migration, configuration)
        self.assertLess(configuration, startup)
        self.assertLess(startup, acceptance)
        self.assertLess(acceptance, deployed)
        self.assertIn("production-codex-acceptance.py", source)
        self.assertIn("ACCEPTANCE_TIMEOUT_SECONDS = 900", source)
        self.assertIn("ACCEPTANCE_OUTER_TIMEOUT_SECONDS = 1020", source)
        self.assertIn("MG_CODEX_ACCEPTANCE_TIMEOUT_SECONDS", source)
        self.assertIn("timeout=ACCEPTANCE_OUTER_TIMEOUT_SECONDS", source)
        self.assertLess(
            source.index("ACCEPTANCE_TIMEOUT_SECONDS = 900"),
            source.index("ACCEPTANCE_OUTER_TIMEOUT_SECONDS = 1020"),
        )

    def test_codex_credential_is_opt_in_separate_and_cleaned(self) -> None:
        source = (ROOT / "scripts" / "production-deploy.py").read_text(
            encoding="utf-8"
        )
        configure_metadata = source.index('"配置 Codex 原生 Responses 元数据"')
        configure_credential = source.index('"更新可选 Codex 上游凭据"')
        configure_claude = source.index('"更新可选 Claude 上游凭据"')
        startup = source.index('"启动并检查生产服务"')

        self.assertIn('CCTQ_CODEX_KEY', source)
        self.assertIn('REMOTE_CODEX_SECRETS', source)
        self.assertIn('REMOTE_CLAUDE_SECRETS', source)
        self.assertIn('if cctq_codex_key:', source)
        self.assertIn('if cctq_claude_key:', source)
        self.assertIn('gateway node scripts/configure-codex-upstream.mjs', source)
        self.assertIn('gateway node scripts/configure-cctq-claude-upstream.mjs', source)
        self.assertIn('-e CCTQ_CODEX_KEY', source)
        self.assertIn('sftp.chmod(REMOTE_CODEX_SECRETS, 0o600)', source)
        self.assertIn('sftp.chmod(REMOTE_CLAUDE_SECRETS, 0o600)', source)
        self.assertIn('CCTQ_CODEX_KEY="$(< {shlex.quote(REMOTE_CODEX_SECRETS)})"', source)
        self.assertIn('CCTQ_CLAUDE_KEY="$(< {shlex.quote(REMOTE_CLAUDE_SECRETS)})"', source)
        self.assertNotIn('. {shlex.quote(REMOTE_CODEX_SECRETS)}', source)
        self.assertNotIn('. {shlex.quote(REMOTE_CLAUDE_SECRETS)}', source)
        self.assertIn('rm -f {shlex.quote(REMOTE_PACKAGE)}', source)
        self.assertIn('shlex.quote(REMOTE_CODEX_SECRETS)', source)
        self.assertIn('shlex.quote(REMOTE_CLAUDE_SECRETS)', source)
        self.assertIn('if key not in {"CCTQ_CODEX_KEY", "CCTQ_CLAUDE_KEY"}', source)
        self.assertIn('AUTO_CIRCUIT_BREAKER_ENABLED=false', source)
        self.assertIn('"autoCircuitBreakerEnabled":false', source)
        self.assertNotIn('CCTQ_CLAUDE_KEY={cctq_codex_key}', source)
        self.assertNotIn('CCTQ_CODEX_KEY={cctq_claude_key}', source)
        self.assertNotIn('CCTQ_CLAUDE_ENABLED=false', source)
        self.assertNotIn('scripts/configure-production.mjs', source)
        self.assertLess(configure_metadata, configure_credential)
        self.assertLess(configure_credential, configure_claude)
        self.assertLess(configure_credential, startup)

        artifacts_marked = source.index('remote_artifacts_may_exist = True')
        codex_secret_create = source.index('"创建受保护的 Codex 临时密钥文件"')
        credential_write = source.index('secret_file.write(cctq_codex_key)')
        rollback = source.index('"恢复数据库、生产文件、环境和旧应用镜像"')
        cleanup = source.index('"清理临时发布文件"')
        outer_finally = source.rfind('    finally:', 0, cleanup)
        database_phase = source.index('database_may_have_changed = True')

        self.assertLess(artifacts_marked, codex_secret_create)
        self.assertLess(codex_secret_create, credential_write)
        self.assertLess(database_phase, configure_credential)
        self.assertLess(configure_credential, rollback)
        self.assertLess(rollback, outer_finally)
        self.assertLess(outer_finally, cleanup)
        self.assertIn('if remote_artifacts_may_exist:', source[outer_finally:cleanup])

    def test_credential_script_updates_only_existing_codex_ciphertext(self) -> None:
        credential = (
            PROJECT / "apps" / "gateway" / "scripts" / "configure-codex-upstream.mjs"
        ).read_text(encoding="utf-8")
        metadata = (
            PROJECT / "apps" / "gateway" / "scripts" / "configure-codex-responses.mjs"
        ).read_text(encoding="utf-8")

        self.assertIn("requireNonBlank('CCTQ_CODEX_KEY'", credential)
        self.assertIn("SELECT id FROM channels WHERE name = ? ORDER BY id FOR UPDATE", credential)
        self.assertIn("UPDATE channels SET keysEncrypted = ? WHERE id = ?", credential)
        self.assertIn("拒绝创建伪渠道", credential)
        self.assertIn("渠道不唯一，拒绝更新凭据", credential)
        self.assertIn("await db.rollback()", credential)
        self.assertNotIn("CCTQ-Claude", credential)
        self.assertNotIn("supplier_accounts", credential)
        self.assertNotIn("INSERT INTO channels", credential)
        self.assertNotIn("disabledUntil", credential)
        self.assertNotIn("consecutiveErrors", credential)
        self.assertNotIn("model_routes", credential)
        self.assertNotIn("status =", credential)
        self.assertNotIn("keysEncrypted", metadata)
        self.assertIn(
            "apps/gateway/scripts/configure-codex-upstream.mjs", REQUIRED_MEMBERS
        )

    def test_claude_credential_script_updates_only_existing_claude_ciphertext(self) -> None:
        credential = (
            PROJECT / "apps" / "gateway" / "scripts" / "configure-cctq-claude-upstream.mjs"
        ).read_text(encoding="utf-8")

        self.assertIn("requireNonBlank('CCTQ_CLAUDE_KEY'", credential)
        self.assertIn("SELECT id FROM channels WHERE name = ? ORDER BY id FOR UPDATE", credential)
        self.assertIn("UPDATE channels SET keysEncrypted = ? WHERE id = ?", credential)
        self.assertIn("拒绝创建伪渠道", credential)
        self.assertIn("渠道不唯一，拒绝更新凭据", credential)
        self.assertIn("await db.rollback()", credential)
        self.assertNotIn("CCTQ-Codex", credential)
        self.assertNotIn("supplier_accounts", credential)
        self.assertNotIn("INSERT INTO channels", credential)
        self.assertNotIn("disabledUntil", credential)
        self.assertNotIn("consecutiveErrors", credential)
        self.assertNotIn("model_routes", credential)
        self.assertNotIn("bindings", credential)
        self.assertNotIn("protocol", credential)
        self.assertNotIn("status =", credential)
        self.assertNotIn("priority", credential)
        self.assertNotIn("weight", credential)
        self.assertIn(
            "apps/gateway/scripts/configure-cctq-claude-upstream.mjs", REQUIRED_MEMBERS
        )
        self.assertFalse(
            (PROJECT / "apps" / "gateway" / "scripts" / "configure-production.mjs").exists()
        )

    def test_failure_recovery_reconnects_without_repeating_rollback(self) -> None:
        source = (ROOT / "scripts" / "production-deploy.py").read_text(
            encoding="utf-8"
        )
        rollback = source.index('"恢复数据库、生产文件、环境和旧应用镜像"')
        cleanup = source.index('"清理临时发布文件"')
        release_lock = source.index('"释放生产发布锁"')

        self.assertIn("session.run_recovery(", source)
        self.assertIn("retry_after_connection_loss=True", source[rollback:cleanup])
        self.assertIn("retry_after_connection_loss=True", source[cleanup:release_lock])
        self.assertIn("retry_after_connection_loss=True", source[release_lock:])
        self.assertIn("确认生产发布锁已释放", source[release_lock:])
        self.assertIn("require_owned=False", source[release_lock:])

    def test_acceptance_has_bounded_inner_deadline_before_parent_timeout(self) -> None:
        acceptance = (ROOT / "scripts" / "production-codex-acceptance.py").read_text(
            encoding="utf-8"
        )

        self.assertIn("AcceptanceDeadline", acceptance)
        self.assertIn('os.environ.get("MG_CODEX_ACCEPTANCE_TIMEOUT_SECONDS", "900")', acceptance)
        self.assertIn("HTTP_TIMEOUT_SECONDS = 90", acceptance)
        self.assertIn("CODEX_TIMEOUT_SECONDS = 150", acceptance)
        self.assertIn("REMOTE_SQL_TIMEOUT_SECONDS = 60", acceptance)
        self.assertIn("TOKEN_CLEANUP_TIMEOUT_SECONDS = 60", acceptance)
        self.assertIn("deadline.timeout(CODEX_TIMEOUT_SECONDS, \"Codex CLI\")", acceptance)
        self.assertIn("deadline.timeout(REMOTE_SQL_TIMEOUT_SECONDS, \"创建临时 token\")", acceptance)
        self.assertIn("timeout=TOKEN_CLEANUP_TIMEOUT_SECONDS", acceptance)
        self.assertIn("session.run_recovery(", acceptance)
        self.assertIn("retry_after_connection_loss=True", acceptance)

    def test_verify_script_requires_matching_release_identity(self) -> None:
        source = (PROJECT / "verify.sh").read_text(encoding="utf-8")
        self.assertIn("live_release=", source)
        self.assertIn("ready_release=", source)
        self.assertIn("live_sha256=", source)
        self.assertIn("ready_sha256=", source)
        self.assertIn('test "$live_release" = "$ready_release"', source)
        self.assertIn('test "$live_sha256" = "$ready_sha256"', source)

        bash = pathlib.Path("C:/Program Files/Git/bin/bash.exe")
        if bash.is_file():
            result = subprocess.run(
                [str(bash), "-n", str(PROJECT / "verify.sh")],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_codex_configuration_and_acceptance_require_explicit_model_routes(self) -> None:
        gateway_scripts = PROJECT / "apps" / "gateway" / "scripts"
        configure = (gateway_scripts / "configure-codex-responses.mjs").read_text(
            encoding="utf-8"
        )
        acceptance = (ROOT / "scripts" / "production-codex-acceptance.py").read_text(
            encoding="utf-8"
        )

        self.assertIn("INSERT INTO model_routes", configure)
        self.assertIn("ON DUPLICATE KEY UPDATE id = id", configure)
        self.assertIn("FOR UPDATE", configure)
        self.assertIn("${label} 不唯一，拒绝修改", configure)
        self.assertNotIn("DELETE route", configure)
        self.assertNotIn("disabledUntil = NULL", configure)
        self.assertNotIn("consecutiveErrors = 0", configure)
        self.assertNotIn("status = 1", configure)
        self.assertIn("JOIN model_routes", acceptance)
        self.assertNotIn("JOIN model_configs m ON m.name IN", configure)

    def test_migration_runner_executes_path_health_migration(self) -> None:
        migrate = (PROJECT / "apps" / "gateway" / "scripts" / "migrate.mjs").read_text(
            encoding="utf-8"
        )
        self.assertIn("'migration-add-channel-route-health.sql'", migrate)


if __name__ == "__main__":
    unittest.main()
