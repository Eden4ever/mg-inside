from __future__ import annotations

import base64
import hashlib
import io
import unittest
from unittest import mock

import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

try:
    from production_ssh import (
        DEFAULT_HOST_KEY_SHA256,
        FingerprintPolicy,
        ProductionSshSession,
        connect_production,
        credential_from_environment,
        is_connection_error,
        key_fingerprint_sha256,
        load_private_key,
    )
except ModuleNotFoundError:
    from scripts.production_ssh import (
        DEFAULT_HOST_KEY_SHA256,
        FingerprintPolicy,
        ProductionSshSession,
        connect_production,
        credential_from_environment,
        is_connection_error,
        key_fingerprint_sha256,
        load_private_key,
    )


class ProductionSshTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.key = paramiko.PKey.from_type_string(
            "ssh-ed25519",
            base64.b64decode(
                "AAAAC3NzaC1lZDI1NTE5AAAAIITzbJ7WaDnmDCRwpo8pZox7TyfMuL7g3pKLy4fulYzo"
            ),
        )

    def test_fingerprint_matches_openssh_sha256_format(self) -> None:
        expected = "SHA256:" + base64.b64encode(
            hashlib.sha256(self.key.asbytes()).digest()
        ).decode("ascii").rstrip("=")
        self.assertEqual(key_fingerprint_sha256(self.key), expected)
        self.assertEqual(expected, DEFAULT_HOST_KEY_SHA256)

    def test_policy_accepts_exact_ed25519_fingerprint(self) -> None:
        policy = FingerprintPolicy(key_fingerprint_sha256(self.key))
        policy.missing_host_key(None, "production.example", self.key)  # type: ignore[arg-type]

    def test_policy_rejects_wrong_fingerprint(self) -> None:
        policy = FingerprintPolicy("SHA256:wrong")
        with self.assertRaisesRegex(paramiko.SSHException, "指纹不匹配"):
            policy.missing_host_key(  # type: ignore[arg-type]
                None, "production.example", self.key
            )

    def test_connect_enables_keepalive_after_fingerprint_checked_connection(self) -> None:
        transport = mock.Mock()
        transport.is_active.return_value = True
        client = mock.Mock()
        client.get_transport.return_value = transport

        with mock.patch("production_ssh.paramiko.SSHClient", return_value=client):
            connected = connect_production(
                host="production.example", password="redacted"
            )

        self.assertIs(connected, client)
        client.set_missing_host_key_policy.assert_called_once()
        client.connect.assert_called_once()
        transport.set_keepalive.assert_called_once_with(30)

    def test_connect_closes_client_when_handshake_fails(self) -> None:
        client = mock.Mock()
        client.connect.side_effect = ConnectionResetError("connection reset")

        with mock.patch("production_ssh.paramiko.SSHClient", return_value=client):
            with self.assertRaises(ConnectionResetError):
                connect_production(host="production.example", password="redacted")

        client.close.assert_called_once()

    def test_banner_reset_is_the_only_retryable_ssh_exception(self) -> None:
        self.assertTrue(
            is_connection_error(
                paramiko.SSHException("Error reading SSH protocol banner")
            )
        )
        self.assertFalse(is_connection_error(paramiko.SSHException("host key mismatch")))
        self.assertFalse(is_connection_error(paramiko.AuthenticationException("denied")))

    def test_session_retries_initial_banner_reset_with_injected_backoff(self) -> None:
        transport = mock.Mock()
        transport.is_active.return_value = True
        connected = mock.Mock()
        connected.get_transport.return_value = transport
        sleep = mock.Mock()

        with mock.patch(
            "production_ssh.connect_production",
            side_effect=[
                paramiko.SSHException("Error reading SSH protocol banner"),
                connected,
            ],
        ) as connect:
            session = ProductionSshSession(
                host="production.example",
                password="redacted",
                connect_attempts=3,
                connect_retry_backoff_seconds=0.25,
                sleep=sleep,
            )

        self.assertIs(session.client, connected)
        self.assertEqual(connect.call_count, 2)
        sleep.assert_called_once_with(0.25)

    def test_session_does_not_retry_initial_fingerprint_or_authentication_error(self) -> None:
        for error in (
            paramiko.SSHException("生产 SSH 主机指纹不匹配"),
            paramiko.AuthenticationException("denied"),
        ):
            with self.subTest(error=type(error).__name__), mock.patch(
                "production_ssh.connect_production", side_effect=error
            ) as connect, self.assertRaises(type(error)):
                ProductionSshSession(
                    host="production.example",
                    password="redacted",
                    connect_attempts=3,
                    sleep=mock.Mock(),
                )
            self.assertEqual(connect.call_count, 1)

    def test_session_reconnect_retries_banner_reset(self) -> None:
        first_transport = mock.Mock()
        first_transport.is_active.return_value = True
        first = mock.Mock()
        first.get_transport.return_value = first_transport
        second_transport = mock.Mock()
        second_transport.is_active.return_value = True
        second = mock.Mock()
        second.get_transport.return_value = second_transport
        sleep = mock.Mock()

        with mock.patch(
            "production_ssh.connect_production",
            side_effect=[
                first,
                paramiko.SSHException("Error reading SSH protocol banner"),
                second,
            ],
        ) as connect:
            session = ProductionSshSession(
                host="production.example",
                password="redacted",
                connect_attempts=3,
                connect_retry_backoff_seconds=0.1,
                sleep=sleep,
            )
            self.assertIs(session.reconnect(), second)

        first.close.assert_called_once()
        self.assertEqual(connect.call_count, 3)
        sleep.assert_called_once_with(0.1)

    def test_session_reconnects_before_recovery_when_idle_transport_is_dead(self) -> None:
        first_transport = mock.Mock()
        first_transport.is_active.return_value = True
        first = mock.Mock()
        first.get_transport.return_value = first_transport
        second_transport = mock.Mock()
        second_transport.is_active.return_value = True
        second = mock.Mock()
        second.get_transport.return_value = second_transport

        with mock.patch(
            "production_ssh.connect_production", side_effect=[first, second]
        ) as connect:
            session = ProductionSshSession(host="production.example", password="redacted")
            first_transport.is_active.return_value = False
            observed = session.run_recovery(
                lambda client: "recovered" if client is second else "stale",
                retry_after_connection_loss=True,
            )

        self.assertEqual(observed, "recovered")
        self.assertEqual(connect.call_count, 2)
        first.close.assert_called_once()

    def test_non_idempotent_recovery_is_not_retried_after_connection_error(self) -> None:
        first_transport = mock.Mock()
        first_transport.is_active.return_value = True
        first = mock.Mock()
        first.get_transport.return_value = first_transport
        second_transport = mock.Mock()
        second_transport.is_active.return_value = True
        second = mock.Mock()
        second.get_transport.return_value = second_transport
        calls: list[object] = []

        with mock.patch(
            "production_ssh.connect_production", side_effect=[first, second]
        ):
            session = ProductionSshSession(host="production.example", password="redacted")
            with self.assertRaisesRegex(RuntimeError, "未重复执行"):
                session.run_recovery(
                    lambda client: (calls.append(client), (_ for _ in ()).throw(EOFError()))[1],
                    retry_after_connection_loss=False,
                )

        self.assertEqual(calls, [first])
        first.close.assert_called_once()

    def test_idempotent_recovery_retries_once_after_connection_error(self) -> None:
        first_transport = mock.Mock()
        first_transport.is_active.return_value = True
        first = mock.Mock()
        first.get_transport.return_value = first_transport
        second_transport = mock.Mock()
        second_transport.is_active.return_value = True
        second = mock.Mock()
        second.get_transport.return_value = second_transport
        calls: list[object] = []

        def operation(client: object) -> str:
            calls.append(client)
            if client is first:
                raise EOFError()
            return "cleaned"

        with mock.patch(
            "production_ssh.connect_production", side_effect=[first, second]
        ):
            session = ProductionSshSession(host="production.example", password="redacted")
            self.assertEqual(
                session.run_recovery(operation, retry_after_connection_loss=True),
                "cleaned",
            )

        self.assertEqual(calls, [first, second])

    def test_recovery_can_use_a_less_strict_retry_operation(self) -> None:
        first_transport = mock.Mock()
        first_transport.is_active.return_value = True
        first = mock.Mock()
        first.get_transport.return_value = first_transport
        second_transport = mock.Mock()
        second_transport.is_active.return_value = True
        second = mock.Mock()
        second.get_transport.return_value = second_transport

        with mock.patch(
            "production_ssh.connect_production", side_effect=[first, second]
        ):
            session = ProductionSshSession(host="production.example", password="redacted")
            result = session.run_recovery(
                lambda _: (_ for _ in ()).throw(EOFError()),
                retry_after_connection_loss=True,
                retry_operation=lambda client: "already-clean" if client is second else "wrong",
            )

        self.assertEqual(result, "already-clean")


class ProductionSshCredentialTest(unittest.TestCase):
    """密钥认证：解析、互斥校验，以及绝不回落到本机的其它钥匙。"""

    @classmethod
    def setUpClass(cls) -> None:
        # paramiko 没有 Ed25519 生成接口，直接用它的底层依赖生成 OpenSSH 私钥文本。
        cls.generated = ed25519.Ed25519PrivateKey.generate()
        cls.private_key_material = cls.generated.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.OpenSSH,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii")
        cls.public_blob = load_private_key(cls.private_key_material).asbytes()

    def test_load_private_key_parses_openssh_ed25519_material(self) -> None:
        key = load_private_key(self.private_key_material)
        self.assertEqual(key.asbytes(), self.public_blob)

    def test_load_private_key_tolerates_missing_trailing_newline(self) -> None:
        # op read 与剪贴板常常吃掉结尾换行，OpenSSH 解析器却要求它存在。
        key = load_private_key(self.private_key_material.rstrip("\n"))
        self.assertEqual(key.asbytes(), self.public_blob)

    def test_load_private_key_accepts_pkcs8_pem_export(self) -> None:
        # 1Password 等密钥库默认导出 PKCS#8（BEGIN PRIVATE KEY），paramiko 不认。
        pem = self.generated.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii")
        self.assertIn("BEGIN PRIVATE KEY", pem)
        self.assertEqual(load_private_key(pem).asbytes(), self.public_blob)

    def test_load_private_key_rejects_blank_and_malformed_material(self) -> None:
        with self.assertRaisesRegex(ValueError, "为空"):
            load_private_key("   ")
        with self.assertRaisesRegex(ValueError, "不是受支持的"):
            load_private_key("not-a-key")

    def test_load_private_key_error_never_leaks_key_material(self) -> None:
        secret = "-----BEGIN OPENSSH PRIVATE KEY-----\nSUPERSECRETBODY\n"
        with self.assertRaises(ValueError) as caught:
            load_private_key(secret)
        self.assertNotIn("SUPERSECRETBODY", str(caught.exception))

    def test_environment_prefers_nothing_when_both_credentials_are_supplied(self) -> None:
        with self.assertRaisesRegex(SystemExit, "只能提供一个"):
            credential_from_environment(
                {
                    "MG_DEPLOY_PASSWORD": "redacted",
                    "MG_DEPLOY_SSH_KEY": self.private_key_material,
                }
            )

    def test_environment_requires_one_credential(self) -> None:
        with self.assertRaisesRegex(SystemExit, "is required"):
            credential_from_environment({})

    def test_environment_builds_password_and_key_credentials(self) -> None:
        password_credential = credential_from_environment(
            {"MG_DEPLOY_PASSWORD": "redacted"}
        )
        self.assertEqual(password_credential.password, "redacted")
        self.assertIsNone(password_credential.private_key)

        key_credential = credential_from_environment(
            {"MG_DEPLOY_SSH_KEY": self.private_key_material}
        )
        self.assertIsNone(key_credential.password)
        self.assertEqual(key_credential.private_key.asbytes(), self.public_blob)

    def test_connect_rejects_both_or_neither_credential(self) -> None:
        with self.assertRaisesRegex(ValueError, "只能提供"):
            connect_production(host="production.example")
        with self.assertRaisesRegex(ValueError, "只能提供"):
            connect_production(
                host="production.example",
                password="redacted",
                private_key=load_private_key(self.private_key_material),
            )

    def test_connect_uses_only_the_supplied_key_and_never_ambient_keys(self) -> None:
        transport = mock.Mock()
        transport.is_active.return_value = True
        client = mock.Mock()
        client.get_transport.return_value = transport
        key = load_private_key(self.private_key_material)

        with mock.patch("paramiko.SSHClient", return_value=client):
            connect_production(host="production.example", private_key=key)

        _, kwargs = client.connect.call_args
        self.assertIs(kwargs["pkey"], key)
        self.assertIsNone(kwargs["password"])
        # ssh-agent 与本机密钥扫描必须保持关闭，否则可能用上非预期的钥匙。
        self.assertFalse(kwargs["allow_agent"])
        self.assertFalse(kwargs["look_for_keys"])

    def test_session_reconnects_with_the_same_key(self) -> None:
        key = load_private_key(self.private_key_material)
        first_transport = mock.Mock()
        first_transport.is_active.return_value = False
        first = mock.Mock()
        first.get_transport.return_value = first_transport
        second_transport = mock.Mock()
        second_transport.is_active.return_value = True
        second = mock.Mock()
        second.get_transport.return_value = second_transport

        with mock.patch(
            "production_ssh.connect_production", side_effect=[first, second]
        ) as connect:
            session = ProductionSshSession(host="production.example", private_key=key)
            session.ensure_connected()

        for call in connect.call_args_list:
            self.assertIs(call.kwargs["private_key"], key)
            self.assertIsNone(call.kwargs["password"])


if __name__ == "__main__":
    unittest.main()
