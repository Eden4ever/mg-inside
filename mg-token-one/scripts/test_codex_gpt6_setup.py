from __future__ import annotations

import json
import importlib.util
import pathlib
import re
import tempfile
import unittest

_module_path = pathlib.Path(__file__).with_name("codex-gpt6-setup.py")
_spec = importlib.util.spec_from_file_location("codex_gpt6_setup", _module_path)
if _spec is None or _spec.loader is None:
    raise ImportError(f"无法加载 {_module_path}")
setup = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(setup)


class CodexGpt6SetupTest(unittest.TestCase):
    def test_platform_scripts_embed_a_complete_catalog_schema(self) -> None:
        scripts_directory = pathlib.Path(__file__).parent
        shell_text = (scripts_directory / "codex-gpt6-setup.sh").read_text(encoding="utf-8")
        shell_match = re.search(r"cat > \"\$catalog_path\" <<'JSON'\n(?P<json>\{.*?\})\nJSON", shell_text, re.S)
        self.assertIsNotNone(shell_match)

        powershell_text = (scripts_directory / "codex-gpt6-setup.ps1").read_text(encoding="utf-8")
        powershell_match = re.search(r"\$catalog = @'\r?\n(?P<json>\{.*?\})\r?\n'@", powershell_text, re.S)
        self.assertIsNotNone(powershell_match)

        for match in (shell_match, powershell_match):
            catalog = json.loads(match.group("json"))
            self.assertEqual(catalog["models"][0]["slug"], "gpt-6-astra")
            self.assertTrue(catalog["models"][0]["description"])
            self.assertTrue(catalog["models"][0]["model_messages"]["instructions_template"])
            for level in catalog["models"][0]["supported_reasoning_levels"]:
                self.assertTrue(level.get("description"))

    def test_install_writes_catalog_without_changing_provider(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            codex_home = pathlib.Path(directory)
            original_config = (
                'model_provider = "token_one"\n'
                'model = "gpt-5.6-terra"\n\n'
                '[model_providers.token_one]\n'
                'name = "Token One via CC Switch"\n'
                'wire_api = "responses"\n'
                'base_url = "https://cc-switch.example/v1"\n'
                'env_key = "TOKEN_ONE_API_KEY"\n'
            )
            (codex_home / "config.toml").write_text(original_config, encoding="utf-8")
            catalog_path, config_backup = setup.install(codex_home)

            self.assertIsNotNone(config_backup)
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            self.assertEqual(catalog["models"][0]["slug"], "gpt-6-astra")
            config = (codex_home / "config.toml").read_text(encoding="utf-8")
            self.assertIn('model_provider = "token_one"', config)
            self.assertIn('model = "gpt-6-astra"', config)
            self.assertIn('model_catalog_json = "', config)
            self.assertIn('base_url = "https://cc-switch.example/v1"', config)
            self.assertIn('env_key = "TOKEN_ONE_API_KEY"', config)
            self.assertNotIn("experimental_bearer_token", config)

    def test_install_is_idempotent_and_backups_changed_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            codex_home = pathlib.Path(directory)
            setup.install(codex_home)
            config_path = codex_home / "config.toml"
            first_config = config_path.read_text(encoding="utf-8")

            catalog_path, config_backup = setup.install(codex_home)

            self.assertEqual(catalog_path.name, "token-one-gpt6-models.json")
            self.assertIsNone(config_backup)
            self.assertEqual(config_path.read_text(encoding="utf-8"), first_config)
            self.assertNotIn("model_providers.", first_config)


if __name__ == "__main__":
    unittest.main()
