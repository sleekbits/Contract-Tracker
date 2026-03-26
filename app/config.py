from __future__ import annotations

from pathlib import Path
import json

APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent
CONFIG_PATH = ROOT_DIR / "config.json"

DEFAULT_CONFIG = {
    "excel_path": "./data/contracts.xlsx",
    "main_sheet": "contracts_filtered",
    "variation_orders_sheet": "variation_orders",
    "auto_refresh_seconds": 5,
    "expiring_thresholds": [30, 60, 90],
}


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()

    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)

    merged = DEFAULT_CONFIG.copy()
    merged.update(data)
    return merged


def save_config(config: dict) -> None:
    merged = DEFAULT_CONFIG.copy()
    merged.update(config)
    with CONFIG_PATH.open("w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)
