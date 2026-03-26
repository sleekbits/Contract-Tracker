from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Tuple

import pandas as pd


EXPECTED_COLUMNS = [
    "contractKey",
    "businessUnit",
    "madeBy",
    "contractType",
    "referenceNumber",
    "description",
    "contractorName",
    "poNumber",
    "signingDate",
    "commencementDate",
    "expiryDate",
    "extensionCount",
    "extensionDates",
    "baseValue",
    "__source",
    "signingDateObj",
    "commencementDateObj",
    "expiryDateObj",
    "revisedExpiryDateObj",
    "revisedExpiryWithVOObj",
]

VO_DEFAULT_COLUMNS = [
    "contractKey",
    "voNumber",
    "voDate",
    "voDescription",
    "voAmount",
    "voStatus",
]


@dataclass
class WorkbookState:
    contracts: pd.DataFrame
    variation_orders: pd.DataFrame
    warnings: list[str]


class ExcelRepository:
    def __init__(self, excel_path: str, main_sheet: str, vo_sheet: str):
        self.excel_path = Path(excel_path).expanduser().resolve()
        self.main_sheet = main_sheet
        self.vo_sheet = vo_sheet
        self._last_mtime: float | None = None

    def exists(self) -> bool:
        return self.excel_path.exists()

    def is_modified(self) -> bool:
        if not self.exists():
            return False
        mtime = self.excel_path.stat().st_mtime
        if self._last_mtime is None:
            self._last_mtime = mtime
            return True
        if mtime > self._last_mtime:
            self._last_mtime = mtime
            return True
        return False

    def load(self) -> WorkbookState:
        warnings: list[str] = []

        if not self.exists():
            return WorkbookState(
                contracts=pd.DataFrame(columns=EXPECTED_COLUMNS),
                variation_orders=pd.DataFrame(columns=VO_DEFAULT_COLUMNS),
                warnings=[f"Excel file not found: {self.excel_path}"],
            )

        contracts = pd.read_excel(self.excel_path, sheet_name=self.main_sheet)

        missing = [c for c in EXPECTED_COLUMNS if c not in contracts.columns]
        if missing:
            warnings.append(f"Main sheet is missing columns: {', '.join(missing)}")

        for col in EXPECTED_COLUMNS:
            if col not in contracts.columns:
                contracts[col] = pd.NA

        contracts = contracts[EXPECTED_COLUMNS + [c for c in contracts.columns if c not in EXPECTED_COLUMNS]]

        try:
            vo = pd.read_excel(self.excel_path, sheet_name=self.vo_sheet)
            for col in VO_DEFAULT_COLUMNS:
                if col not in vo.columns:
                    vo[col] = pd.NA
            vo = vo[VO_DEFAULT_COLUMNS + [c for c in vo.columns if c not in VO_DEFAULT_COLUMNS]]
        except ValueError:
            vo = pd.DataFrame(columns=VO_DEFAULT_COLUMNS)
            warnings.append(
                f"Variation order sheet '{self.vo_sheet}' not found. You can add it later with fields: {', '.join(VO_DEFAULT_COLUMNS)}"
            )

        self._last_mtime = self.excel_path.stat().st_mtime
        return WorkbookState(contracts=contracts, variation_orders=vo, warnings=warnings)


def split_multi_date_field(value: object) -> list[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return []
    text = str(value).strip()
    if not text:
        return []
    separators = [";", "|", ",", "\n"]
    result = [text]
    for sep in separators:
        next_result: list[str] = []
        for item in result:
            next_result.extend(item.split(sep))
        result = next_result
    return [r.strip() for r in result if r.strip()]
