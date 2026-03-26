# Offline Contract Management Tracker Dashboard

A fully offline Windows-friendly desktop app for contract management that reads directly from an Excel workbook (`.xlsx`) as the single source of truth.

## What this app does

- Runs locally with **no web server, no cloud, no database server, no internet requirement**.
- Reads contracts from Excel sheet **`contracts_filtered`**.
- Optionally reads variation orders from sheet **`variation_orders`**.
- Auto-detects Excel changes (file modified + saved) and reloads data automatically.
- Provides:
  - Dashboard KPIs
  - Charts
  - Contract register with search/sort/filter
  - Contract detail pop-up
  - Expiry tracker
  - Extension tracker
  - Variation orders tracker
  - Summary/alerts page
  - CSV export + printable text summary export

## Folder structure

```text
Contract-Tracker/
├─ app/
│  ├─ __init__.py
│  ├─ main.py                # Desktop UI and pages
│  ├─ config.py              # Config load/save
│  ├─ data_loader.py         # Excel reader + schema handling
│  └─ calculations.py        # Derived fields, KPIs, validations
├─ data/
│  └─ contracts.xlsx         # Put your live workbook here (or set path in config)
├─ config.json               # Local app configuration
├─ requirements.txt
└─ README.md
```

## Excel requirements

Main sheet name: `contracts_filtered`

Expected existing fields:

- contractKey
- businessUnit
- madeBy
- contractType
- referenceNumber
- description
- contractorName
- poNumber
- signingDate
- commencementDate
- expiryDate
- extensionCount
- extensionDates
- baseValue
- __source
- signingDateObj
- commencementDateObj
- expiryDateObj
- revisedExpiryDateObj
- revisedExpiryWithVOObj

Optional future sheet for variation orders: `variation_orders`

Recommended VO columns:
- contractKey
- voNumber
- voDate
- voDescription
- voAmount
- voStatus

## Automatic calculations included

- Duration from commencement to original expiry
- Revised duration to effective expiry
- Days remaining
- Status: Active / Expired / Expiring Soon / Draft
- Expiring flags (30 / 60 / 90)
- Base value
- VO count and total VO value
- Final revised value (base + VO)
- Missing key data flag
- Date consistency warning (expiry before commencement)

## Setup (Windows)

1. Install Python 3.11+.
2. Open terminal in this project folder.
3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Put your workbook at `data/contracts.xlsx` (or use **Browse** in app to select your file).
5. Run:

```bash
python -m app.main
```

## Configuration

Edit `config.json` to set:

- `excel_path`: path to workbook
- `main_sheet`: contracts sheet name
- `variation_orders_sheet`: VO sheet name
- `auto_refresh_seconds`: polling interval

## Notes for non-technical users

- Keep Excel file closed while editing if a save conflict appears.
- Save Excel after updates; app refreshes automatically within configured seconds.
- Use **Refresh** button for immediate reload.

## Future enhancements (ready structure)

You can add new columns and sheets without major rewrite:
- Extend expected schema in `data_loader.py`
- Add derived calculations in `calculations.py`
- Add new tabs/views in `main.py`

## Packaging as `.exe` (optional)

You can package into a single Windows executable with PyInstaller:

```bash
pip install pyinstaller
pyinstaller --noconfirm --windowed --name ContractTracker app/main.py
```

The generated `dist/ContractTracker` folder can be copied to another PC.
