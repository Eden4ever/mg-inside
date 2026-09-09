"""Create and validate the minimal production release archive."""

from __future__ import annotations

import pathlib
import os
import re
import tarfile


GATEWAY_ITEMS = (
    "src",
    "scripts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.build.json",
    "nest-cli.json",
    ".npmrc",
)
ROOT_ITEMS = ("Dockerfile", "verify.sh", "verify2.sh")
REQUIRED_MEMBERS = {
    "apps/gateway/package.json",
    "apps/gateway/package-lock.json",
    "apps/gateway/src/main.ts",
    "apps/gateway/src/entities/model-route.entity.ts",
    "apps/gateway/src/entities/channel-route-health.entity.ts",
    "apps/gateway/src/modules/model-route/model-route.store.ts",
    "apps/gateway/src/modules/model-route/model-route.module.ts",
    "apps/gateway/scripts/migration-add-model-routes.sql",
    "apps/gateway/scripts/migration-add-channel-route-health.sql",
    "apps/gateway/scripts/migration-add-request-error-dimensions.sql",
    "apps/gateway/scripts/migration-add-availability-alerts.sql",
    "apps/gateway/scripts/migration-add-availability-alert-evaluation-key.sql",
    "apps/gateway/scripts/migration-add-user-quota-packages.sql",
    "apps/gateway/scripts/migration-add-user-quota-adjustments.sql",
    "apps/gateway/scripts/migration-add-quota-nonnegative-constraints.sql",
    "apps/gateway/scripts/migration-add-cctq-api-key-state.sql",
    "apps/gateway/scripts/migration-add-request-log-retention-index.sql",
    "apps/gateway/scripts/migrate.mjs",
    "apps/gateway/scripts/configure-codex-responses.mjs",
    "apps/gateway/scripts/configure-codex-upstream.mjs",
    "apps/gateway/scripts/configure-cctq-claude-upstream.mjs",
    "web-dist/index.html",
    "Dockerfile",
    "verify.sh",
}
ALLOWED_DIRECTORY_ROOTS = {"apps", "apps/gateway", "web-dist"}
CREDENTIAL_RISK_NAME = re.compile(
    r"(?:credential|secret|password|passwd|private|seed-admin|id_rsa|id_ed25519)",
    re.IGNORECASE,
)
CREDENTIAL_RISK_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".kdbx"}
DEFAULT_CREDENTIAL_MARKERS = (b'admin123',)
NPM_CREDENTIAL_PATTERN = re.compile(
    rb"(?im)^(?:[^\r\n]*:_auth(?:Token)?|_authToken|_password)\s*=",
)


def credential_markers() -> tuple[bytes, ...]:
    """检查本机实际配置中的口令，不把数据库密码写在检查器源码中。"""
    values = dict(os.environ)
    local = pathlib.Path(__file__).resolve().parents[1] / "mg-gateway/apps/gateway/.env"
    if local.is_file():
        for line in local.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.strip().partition("=")
            if separator and not key.startswith("#"):
                values.setdefault(key.strip(), value.strip().strip("\"'"))
    return DEFAULT_CREDENTIAL_MARKERS + tuple(
        value.encode() for key, value in values.items()
        if re.fullmatch(r"[A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY)", key)
        and len(value) >= 8 and not value.startswith("${")
    )


def build_package(project: pathlib.Path, target: pathlib.Path) -> None:
    web_dist = project / "apps" / "web" / "dist"
    if not (web_dist / "index.html").is_file():
        raise SystemExit("apps/web/dist 不存在，请先执行前端生产构建")

    gateway_root = project / "apps" / "gateway"
    with tarfile.open(target, "w:gz") as archive:
        for item in GATEWAY_ITEMS:
            source = gateway_root / item
            if source.exists():
                archive.add(source, arcname=f"apps/gateway/{item}")
        archive.add(web_dist, arcname="web-dist")
        for item in ROOT_ITEMS:
            archive.add(project / item, arcname=item)

    validate_package(target)


def validate_package(target: pathlib.Path) -> None:
    with tarfile.open(target, "r:gz") as archive:
        members = archive.getmembers()
        member_files = [member for member in members if member.isfile()]

    names = {member.name.rstrip("/") for member in members}
    missing = sorted(REQUIRED_MEMBERS - names)
    if missing:
        raise ValueError(f"发布包缺少必要文件：{', '.join(missing)}")

    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"发布包包含不安全路径：{member.name}")
        if member.issym() or member.islnk():
            raise ValueError(f"发布包禁止包含链接：{member.name}")
        if path.name.startswith(".env"):
            raise ValueError(f"发布包禁止包含环境文件：{member.name}")
        if CREDENTIAL_RISK_NAME.search(path.name) or path.suffix.lower() in CREDENTIAL_RISK_SUFFIXES:
            raise ValueError(f"发布包禁止包含凭据或默认口令风险文件：{member.name}")
        if "node_modules" in path.parts or path.suffix == ".log":
            raise ValueError(f"发布包包含开发产物：{member.name}")
        if not (
            (member.isdir() and member.name.rstrip("/") in ALLOWED_DIRECTORY_ROOTS)
            or
            member.name == "Dockerfile"
            or member.name in {"verify.sh", "verify2.sh"}
            or member.name.startswith("apps/gateway/")
            or member.name.startswith("web-dist/")
        ):
            raise ValueError(f"发布包包含白名单外路径：{member.name}")

    # 文件名不能识别改名后的账号种子；扫描默认口令与本机已配置的机密。
    markers = credential_markers()
    with tarfile.open(target, "r:gz") as archive:
        for member in member_files:
            content = archive.extractfile(member)
            if content is None:
                raise ValueError(f"无法读取发布包成员：{member.name}")
            payload = content.read()
            if any(marker in payload for marker in markers):
                raise ValueError(f"发布包包含默认口令风险内容：{member.name}")
            if member.name == "apps/gateway/.npmrc" and NPM_CREDENTIAL_PATTERN.search(payload):
                raise ValueError(f"发布包包含凭据或默认口令风险内容：{member.name}")
