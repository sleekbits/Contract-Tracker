from __future__ import annotations

from datetime import datetime
import pandas as pd

from app.data_loader import split_multi_date_field


def parse_date(value: object) -> pd.Timestamp | pd.NaT:
    if pd.isna(value):
        return pd.NaT
    if isinstance(value, pd.Timestamp):
        return value
    if isinstance(value, datetime):
        return pd.Timestamp(value)
    parsed = pd.to_datetime(value, errors="coerce", dayfirst=False)
    return parsed


def parse_number(value: object) -> float:
    if pd.isna(value):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace(",", "").strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def enrich_contracts(contracts: pd.DataFrame, vos: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    df = contracts.copy()
    warnings: list[str] = []

    for col in ["signingDateObj", "commencementDateObj", "expiryDateObj", "revisedExpiryDateObj", "revisedExpiryWithVOObj"]:
        df[col] = df[col].apply(parse_date)

    df["baseValue"] = df["baseValue"].apply(parse_number)
    df["extensionCount"] = pd.to_numeric(df["extensionCount"], errors="coerce").fillna(0).astype(int)

    # fallback if Obj fields are blank
    fallback_map = {
        "signingDateObj": "signingDate",
        "commencementDateObj": "commencementDate",
        "expiryDateObj": "expiryDate",
    }
    for obj_col, source_col in fallback_map.items():
        empty_mask = df[obj_col].isna()
        df.loc[empty_mask, obj_col] = df.loc[empty_mask, source_col].apply(parse_date)

    vo = vos.copy()
    if len(vo):
        vo["voAmount"] = vo["voAmount"].apply(parse_number)
        vo["voDate"] = vo["voDate"].apply(parse_date)
        vo_summary = vo.groupby("contractKey", dropna=False).agg(
            voCount=("voNumber", "count"),
            totalVOValue=("voAmount", "sum"),
        )
    else:
        vo_summary = pd.DataFrame(columns=["voCount", "totalVOValue"])

    df = df.merge(vo_summary, how="left", left_on="contractKey", right_index=True)
    df["voCount"] = df["voCount"].fillna(0).astype(int)
    df["totalVOValue"] = df["totalVOValue"].fillna(0.0)

    today = pd.Timestamp.today().normalize()
    df["effectiveExpiryDate"] = df["revisedExpiryWithVOObj"].combine_first(df["revisedExpiryDateObj"]).combine_first(df["expiryDateObj"])
    df["contractStartDate"] = df["commencementDateObj"].combine_first(df["signingDateObj"])
    df["durationDays"] = (df["expiryDateObj"] - df["contractStartDate"]).dt.days
    df["revisedDurationDays"] = (df["effectiveExpiryDate"] - df["contractStartDate"]).dt.days
    df["contractAgeDays"] = (today - df["contractStartDate"]).dt.days
    df["daysRemaining"] = (df["effectiveExpiryDate"] - today).dt.days

    def status(row: pd.Series) -> str:
        expiry = row["effectiveExpiryDate"]
        if pd.isna(expiry):
            return "Draft"
        if row["daysRemaining"] < 0:
            return "Expired"
        if row["daysRemaining"] <= 90:
            return "Expiring Soon"
        return "Active"

    df["contractStatus"] = df.apply(status, axis=1)

    df["expiring30"] = df["daysRemaining"].between(0, 30, inclusive="both")
    df["expiring60"] = df["daysRemaining"].between(0, 60, inclusive="both")
    df["expiring90"] = df["daysRemaining"].between(0, 90, inclusive="both")
    df["hasExtension"] = df["extensionCount"] > 0
    df["hasVO"] = df["voCount"] > 0
    df["finalRevisedValue"] = df["baseValue"] + df["totalVOValue"]
    df["lastUpdatedDate"] = today

    required = ["contractKey", "referenceNumber", "contractorName", "businessUnit", "contractType"]
    df["missingDataFlag"] = False
    for req in required:
        mask = df[req].isna() | (df[req].astype(str).str.strip() == "")
        df.loc[mask, "missingDataFlag"] = True

    bad_dates = df[df["durationDays"].notna() & (df["durationDays"] < 0)]
    if len(bad_dates):
        warnings.append(f"{len(bad_dates)} row(s) have expiry before commencement date.")

    df["parsedExtensionDates"] = df["extensionDates"].apply(split_multi_date_field)

    defaults = {
        "remarks": "",
        "departmentOwner": "",
        "contractCategory": "",
        "renewalRequired": "No",
        "noticePeriod": "",
    }
    for key, default in defaults.items():
        if key not in df.columns:
            df[key] = default

    return df, warnings


def compute_kpis(df: pd.DataFrame) -> dict[str, float | int]:
    return {
        "Total Contracts": int(len(df)),
        "Active Contracts": int((df["contractStatus"] == "Active").sum()),
        "Expired Contracts": int((df["contractStatus"] == "Expired").sum()),
        "Expiring in 30 Days": int(df["expiring30"].sum()),
        "Expiring in 60 Days": int(df["expiring60"].sum()),
        "Expiring in 90 Days": int(df["expiring90"].sum()),
        "With Extensions": int(df["hasExtension"].sum()),
        "With Variation Orders": int(df["hasVO"].sum()),
        "Total Base Value": float(df["baseValue"].sum()),
        "Total Revised Value": float(df["finalRevisedValue"].sum()),
    }
