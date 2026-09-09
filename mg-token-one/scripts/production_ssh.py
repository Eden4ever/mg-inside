"""Strict host-key verification for Token One production SSH connections."""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import hmac
import io
import os
import time
from collections.abc import Callable, Mapping
from typing import TypeVar

import paramiko
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization


DEFAULT_HOST_KEY_SHA256 = (
    "SHA256:HdfL3U1v0pZGZwdt7Pum7PwCevVsuPLBI5gvGoni7do"
)
DEFAULT_KEEPALIVE_SECONDS = 30
DEFAULT_CONNECT_ATTEMPTS = 3
DEFAULT_CONNECT_RETRY_BACKOFF_SECONDS = 0.5
PASSWORD_ENVIRONMENT_VARIABLE = "MG_DEPLOY_PASSWORD"
PRIVATE_KEY_ENVIRONMENT_VARIABLE = "MG_DEPLOY_SSH_KEY"
PRIVATE_KEY_PASSPHRASE_ENVIRONMENT_VARIABLE = "MG_DEPLOY_SSH_KEY_PASSPHRASE"
# 任何子进程都不得继承这些变量，除非调用方明确需要复用同一凭据。
CREDENTIAL_ENVIRONMENT_VARIABLES = frozenset(
    {
        PASSWORD_ENVIRONMENT_VARIABLE,
        PRIVATE_KEY_ENVIRONMENT_VARIABLE,
        PRIVATE_KEY_PASSPHRASE_ENVIRONMENT_VARIABLE,
    }
)
# paramiko 5 已移除 DSSKey；DSA 本就不该用于生产，这里只保留现代密钥类型。
PRIVATE_KEY_CLASSES = (
    paramiko.Ed25519Key,
    paramiko.ECDSAKey,
    paramiko.RSAKey,
)
T = TypeVar("T")


def key_fingerprint_sha256(key: paramiko.PKey) -> str:
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode("ascii").rstrip("=")


class FingerprintPolicy(paramiko.MissingHostKeyPolicy):
    def __init__(self, expected_fingerprint: str) -> None:
        self.expected_fingerprint = expected_fingerprint

    def missing_host_key(
        self,
        client: paramiko.SSHClient,
        hostname: str,
        key: paramiko.PKey,
    ) -> None:
        actual = key_fingerprint_sha256(key)
        if key.get_name() != "ssh-ed25519" or not hmac.compare_digest(
            actual, self.expected_fingerprint
        ):
            raise paramiko.SSHException(
                f"生产 SSH 主机指纹不匹配：{hostname} ({key.get_name()} {actual})"
            )


def _parse_openssh_material(
    material: str, passphrase: str | None
) -> tuple[paramiko.PKey | None, bool]:
    """尝试按 OpenSSH 私钥解析；返回 (密钥, 是否因加密而失败)。"""
    encrypted = False
    for key_class in PRIVATE_KEY_CLASSES:
        try:
            return (
                key_class.from_private_key(
                    io.StringIO(material), password=passphrase
                ),
                False,
            )
        except paramiko.PasswordRequiredException:
            encrypted = True
        except paramiko.SSHException:
            continue
    return None, encrypted


def _openssh_material_from_pem(
    material: str, passphrase: str | None
) -> tuple[str | None, bool]:
    """把 PKCS#8/传统 PEM 私钥转成 OpenSSH 文本；返回 (文本, 是否因加密而失败)。

    1Password 等密钥库默认导出 `BEGIN PRIVATE KEY`（PKCS#8），而 paramiko 只解析
    OpenSSH 格式。这里做一次内存内转换，让两种导出都能直接使用。
    """
    try:
        private = serialization.load_pem_private_key(
            material.encode("utf-8"),
            password=passphrase.encode("utf-8") if passphrase else None,
        )
    except TypeError:
        # cryptography 用 TypeError 表示“密钥已加密但未提供口令”。
        return None, True
    except (ValueError, UnsupportedAlgorithm):
        return None, False
    try:
        return (
            private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.OpenSSH,
                encryption_algorithm=serialization.NoEncryption(),
            ).decode("ascii"),
            False,
        )
    except (ValueError, UnsupportedAlgorithm):
        return None, False


def load_private_key(
    material: str,
    *,
    passphrase: str | None = None,
) -> paramiko.PKey:
    """把内存中的私钥文本解析成 paramiko 密钥，绝不落盘也绝不回显内容。

    同时接受 OpenSSH 与 PEM（含 PKCS#8）两种导出格式。错误信息只描述失败原因，
    不包含任何密钥内容，避免私钥进入日志。
    """
    if not material or not material.strip():
        raise ValueError("SSH 私钥内容为空")
    # op read / 剪贴板常常吃掉结尾换行，而 OpenSSH 解析器要求它存在。
    normalized = material.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.endswith("\n"):
        normalized += "\n"
    passphrase = passphrase or None

    key, encrypted = _parse_openssh_material(normalized, passphrase)
    if key is not None:
        return key

    converted, pem_encrypted = _openssh_material_from_pem(normalized, passphrase)
    if converted is not None:
        key, _ = _parse_openssh_material(converted, None)
        if key is not None:
            return key

    if encrypted or pem_encrypted:
        raise paramiko.PasswordRequiredException(
            "SSH 私钥已加密，请通过 "
            f"{PRIVATE_KEY_PASSPHRASE_ENVIRONMENT_VARIABLE} 提供口令"
        )
    raise ValueError("无法解析 SSH 私钥：不是受支持的 OpenSSH/PEM 私钥格式")


@dataclasses.dataclass(frozen=True)
class SshCredential:
    """一次生产连接使用的认证材料，口令与私钥互斥。"""

    password: str | None = None
    private_key: paramiko.PKey | None = None

    def connect_kwargs(self) -> dict[str, object]:
        return {"password": self.password, "private_key": self.private_key}


def credential_from_environment(
    environ: Mapping[str, str] | None = None,
) -> SshCredential:
    """从环境变量解析生产 SSH 凭据；口令与私钥必须且只能提供一个。"""
    source = os.environ if environ is None else environ
    key_material = source.get(PRIVATE_KEY_ENVIRONMENT_VARIABLE, "")
    password = source.get(PASSWORD_ENVIRONMENT_VARIABLE, "")
    if key_material and password:
        raise SystemExit(
            f"{PRIVATE_KEY_ENVIRONMENT_VARIABLE} 与 "
            f"{PASSWORD_ENVIRONMENT_VARIABLE} 只能提供一个"
        )
    if key_material:
        return SshCredential(
            private_key=load_private_key(
                key_material,
                passphrase=source.get(
                    PRIVATE_KEY_PASSPHRASE_ENVIRONMENT_VARIABLE, ""
                )
                or None,
            )
        )
    if password:
        return SshCredential(password=password)
    raise SystemExit(
        f"{PASSWORD_ENVIRONMENT_VARIABLE} or "
        f"{PRIVATE_KEY_ENVIRONMENT_VARIABLE} is required"
    )


def connect_production(
    *,
    host: str,
    password: str | None = None,
    private_key: paramiko.PKey | None = None,
    port: int = 22,
    username: str = "root",
) -> paramiko.SSHClient:
    password = password or None
    if (password is None) == (private_key is None):
        raise ValueError("必须且只能提供 password 或 private_key 之一")

    expected = os.environ.get(
        "MG_DEPLOY_HOST_KEY_SHA256", DEFAULT_HOST_KEY_SHA256
    ).strip()
    if not expected.startswith("SHA256:") or len(expected) <= len("SHA256:"):
        raise ValueError("MG_DEPLOY_HOST_KEY_SHA256 格式无效")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(FingerprintPolicy(expected))
    try:
        client.connect(
            host,
            port=port,
            username=username,
            password=password,
            pkey=private_key,
            timeout=20,
            # 只使用显式传入的凭据：既不读 ssh-agent，也不扫描本机密钥，
            # 避免发布进程意外用上一把没打算使用的钥匙。
            allow_agent=False,
            look_for_keys=False,
        )
        transport = client.get_transport()
        if transport is None or not transport.is_active():
            raise paramiko.SSHException("生产 SSH 连接建立后不可用")
        # 发布验收会在本机执行较长时间的 Codex 调用。保持底层 SSH 会话活跃，
        # 以便失败处理仍能使用已验证的会话回滚和释放锁。
        transport.set_keepalive(DEFAULT_KEEPALIVE_SECONDS)
        return client
    except BaseException:
        # Paramiko 在握手中途失败时不会保证释放套接字。每次重试前必须关闭它，
        # 防止 banner reset 连续发生时累积半开连接。
        client.close()
        raise


def is_connection_active(client: paramiko.SSHClient) -> bool:
    transport = client.get_transport()
    return transport is not None and transport.is_active()


def is_connection_error(error: BaseException) -> bool:
    if isinstance(
        error,
        (
            paramiko.AuthenticationException,
            paramiko.BadHostKeyException,
            paramiko.PasswordRequiredException,
            paramiko.ChannelException,
        ),
    ):
        return False
    if isinstance(error, (EOFError, OSError)):
        return True
    if not isinstance(error, paramiko.SSHException):
        return False

    # Paramiko 将 SSH banner 读取阶段的 socket reset 包装成普通 SSHException，
    # 因此不能仅依赖异常类型。只接受这一已知的瞬时握手错误，避免把指纹、配置
    # 或协议协商问题当作可重试问题。
    message = str(error).lower()
    return "error reading ssh protocol banner" in message


class ProductionSshSession:
    """管理已验证的生产 SSH 连接，并为恢复操作提供重连能力。

    只有幂等恢复命令可以在连接中断后重试。回滚调用方必须使用具备完成标记的
    幂等脚本，避免不确定状态下重复执行不可恢复的动作。
    """

    def __init__(
        self,
        *,
        host: str,
        password: str | None = None,
        private_key: paramiko.PKey | None = None,
        port: int = 22,
        username: str = "root",
        connect_attempts: int = DEFAULT_CONNECT_ATTEMPTS,
        connect_retry_backoff_seconds: float = DEFAULT_CONNECT_RETRY_BACKOFF_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if connect_attempts < 1:
            raise ValueError("connect_attempts 必须至少为 1")
        if connect_retry_backoff_seconds < 0:
            raise ValueError("connect_retry_backoff_seconds 不能小于 0")
        self.host = host
        self.password = password
        self.private_key = private_key
        self.port = port
        self.username = username
        self.connect_attempts = connect_attempts
        self.connect_retry_backoff_seconds = connect_retry_backoff_seconds
        self.sleep = sleep
        self.client = self._connect()

    def _connect(self) -> paramiko.SSHClient:
        for attempt in range(1, self.connect_attempts + 1):
            try:
                return connect_production(
                    host=self.host,
                    password=self.password,
                    private_key=self.private_key,
                    port=self.port,
                    username=self.username,
                )
            except BaseException as error:
                if not is_connection_error(error) or attempt == self.connect_attempts:
                    raise
                delay = self.connect_retry_backoff_seconds * attempt
                if delay:
                    self.sleep(delay)
        raise AssertionError("SSH 连接重试循环意外结束")

    def ensure_connected(self) -> paramiko.SSHClient:
        if not is_connection_active(self.client):
            self.reconnect()
        return self.client

    def reconnect(self) -> paramiko.SSHClient:
        previous = self.client
        try:
            previous.close()
        except Exception:
            # 旧连接已不可用于恢复；新的连接仍须由指纹策略重新验证。
            pass
        self.client = self._connect()
        return self.client

    def run_recovery(
        self,
        operation: Callable[[paramiko.SSHClient], T],
        *,
        retry_after_connection_loss: bool,
        retry_operation: Callable[[paramiko.SSHClient], T] | None = None,
    ) -> T:
        client = self.ensure_connected()
        try:
            return operation(client)
        except Exception as error:
            if not is_connection_error(error):
                raise
            # 空闲连接失效后先重连；仅允许幂等恢复操作在新连接上重试。
            self.reconnect()
            if retry_after_connection_loss:
                return (retry_operation or operation)(self.client)
            raise RuntimeError(
                "恢复命令执行期间 SSH 连接中断；已重连但未重复执行，避免双重回滚"
            ) from error

    def close(self) -> None:
        self.client.close()
