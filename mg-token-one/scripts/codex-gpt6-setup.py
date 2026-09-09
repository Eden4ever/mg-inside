"""Install a local Codex catalog entry for Token One GPT-6 Astra."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import shutil
import tempfile


MODEL = "gpt-6-astra"
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
TEMPLATE = SCRIPT_DIR / "codex-gpt6-model.json"


def toml_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def backup_path(path: pathlib.Path, stamp: str) -> pathlib.Path:
    return path.with_name(f"{path.name}.bak.gpt6-{stamp}")


def atomic_write(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="", dir=path.parent, delete=False
    ) as handle:
        temporary = pathlib.Path(handle.name)
        handle.write(content)
    try:
        if path.exists():
            shutil.copymode(path, temporary)
        else:
            try:
                os.chmod(temporary, 0o600)
            except OSError:
                pass
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def top_level_lines(text: str) -> list[str]:
    return text.splitlines(keepends=True)


def set_top_level_key(text: str, key: str, value: str) -> str:
    lines = top_level_lines(text)
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
    matches: list[int] = []
    first_table: int | None = None
    in_table = False
    for index, line in enumerate(lines):
        if re.match(r"^\s*\[[^\[]", line):
            in_table = True
            if first_table is None:
                first_table = index
        if not in_table and pattern.match(line):
            matches.append(index)
    if len(matches) > 1:
        raise ValueError(f"配置文件包含重复的顶层键：{key}")
    replacement = f"{key} = {value}\n"
    if matches:
        lines[matches[0]] = replacement
    elif first_table is None:
        if lines and lines[-1].strip():
            lines.append("\n")
        lines.append(replacement)
    else:
        lines.insert(first_table, replacement)
    return "".join(lines)


def codex_home_from_args(value: str | None) -> pathlib.Path:
    if value:
        return pathlib.Path(value).expanduser()
    configured = os.environ.get("CODEX_HOME", "").strip()
    if configured:
        return pathlib.Path(configured).expanduser()
    return pathlib.Path.home() / ".codex"


def install(codex_home: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path | None]:
    if not TEMPLATE.is_file():
        raise FileNotFoundError(f"缺少模型目录模板：{TEMPLATE}")
    catalog = json.loads(TEMPLATE.read_text(encoding="utf-8"))
    models = catalog.get("models")
    if not isinstance(models, list) or not any(
        isinstance(model, dict) and model.get("slug") == MODEL for model in models
    ):
        raise ValueError("模型目录模板缺少 gpt-6-astra")

    codex_home.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    catalog_path = codex_home / "token-one-gpt6-models.json"
    config_path = codex_home / "config.toml"
    config_backup: pathlib.Path | None = None

    catalog_content = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    if catalog_path.exists() and catalog_path.read_text(encoding="utf-8") != catalog_content:
        catalog_backup = backup_path(catalog_path, stamp)
        shutil.copy2(catalog_path, catalog_backup)
    atomic_write(catalog_path, catalog_content)

    original = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    updated = set_top_level_key(original, "model", toml_string(MODEL))
    updated = set_top_level_key(updated, "model_catalog_json", toml_string(str(catalog_path)))
    if config_path.exists() and original != updated:
        config_backup = backup_path(config_path, stamp)
        shutil.copy2(config_path, config_backup)
    if original != updated or not config_path.exists():
        atomic_write(config_path, updated)
    return catalog_path, config_backup


def main() -> int:
    parser = argparse.ArgumentParser(description="配置 Codex Desktop 的 Token One GPT-6 Astra")
    parser.add_argument("--codex-home", help="覆盖 Codex 用户目录，主要用于测试")
    args = parser.parse_args()

    catalog_path, config_backup = install(codex_home_from_args(args.codex_home))
    print(f"已安装模型目录：{catalog_path}")
    if config_backup:
        print(f"已备份原配置：{config_backup}")
    print(f"默认模型：{MODEL}")
    print("已保留现有 CC Switch provider 配置；未写入 API key")
    print("请重启 Codex Desktop 使模型选择器重新加载配置")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
