# Contract Management Tracker - Offline Browser App

Single-folder offline web app. Open `index.html` in Edge/Chrome and manage contracts directly from Excel.

## Key capabilities

- Open local `.xlsx` directly from browser (no server / no install / no internet)
- Read from `contracts_filtered` sheet as source of truth
- Auto-refresh on external Excel save (5-second polling)
- Dashboard KPIs + trend charts
- Contract register with search, filters, sorting, row numbering
- Color status badges (Active / Expired / Expiring Soon / Draft)
- Contract detail popup
- **Add / Edit / Delete contract from the UI**
- **Save changes back to the same Excel file from UI**
- Expiry / Extension / Variation Order trackers
- CSV export and print view

## Files

- `index.html` – layout/pages/dialogs
- `styles.css` – modern colorful UX/UI theme
- `app.js` – app logic, calculations, edit workflow, save to workbook
- `xlsx-lite.js` – local XLSX read/write implementation (no CDN)

## Run

1. Open `index.html` in latest **Edge** or **Chrome**.
2. Click **Open Excel File** and choose workbook.
3. Use dashboard and register.
4. Use **+ Add Contract** or **Edit** button in register.
5. Click **Save Changes to Excel** to persist edits to workbook.

## Required sheet

`contracts_filtered`

Expected fields:
`contractKey, businessUnit, madeBy, contractType, referenceNumber, description, contractorName, poNumber, signingDate, commencementDate, expiryDate, extensionCount, extensionDates, baseValue, __source, signingDateObj, commencementDateObj, expiryDateObj, revisedExpiryDateObj, revisedExpiryWithVOObj`

Optional sheet:
`variation_orders` with columns:
`contractKey, voNumber, voDate, voDescription, voAmount, voStatus`

## Note

Browser security requires one-time file selection permission. After selecting, app can auto-refresh and save changes to the same file.
