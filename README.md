# Contract Management Tracker - Offline Browser App

This project is now a **single offline web app** that runs by opening `index.html` directly in a browser (no install, no localhost, no server, no PHP/MySQL/XAMPP).

## What you get

- ✅ Fully offline app (local files only)
- ✅ Opens directly in browser from folder
- ✅ Reads Excel workbook (`.xlsx`) from your PC
- ✅ Uses sheet `contracts_filtered` as source of truth
- ✅ Auto-refreshes when the Excel file is edited and saved
- ✅ Dashboard with KPI cards + charts
- ✅ Register with search, sorting, filtering, row numbering
- ✅ Contract detail popup
- ✅ Expiry tracker, extension tracker, variation orders tracker
- ✅ CSV export and print support
- ✅ No online CDN or internet dependency

## Files

```text
Contract-Tracker/
├─ index.html          # Main app UI
├─ styles.css          # Styling
├─ app.js              # Dashboard/filter/table logic
├─ xlsx-lite.js        # Built-in XLSX parser (no external library)
├─ README.md
└─ .gitignore
```

## How to run (Windows)

1. Put your Excel file anywhere on your PC.
2. Open `index.html` in **Microsoft Edge** or **Google Chrome**.
3. Click **Open Excel File** and choose your workbook.
4. The app loads sheet `contracts_filtered`.
5. If workbook has a `variation_orders` sheet, VO module loads automatically.
6. Keep the app open; when Excel is saved, app auto-refreshes every 5 seconds.

> Recommended browser: latest Edge/Chrome (for File System Access API and auto-refresh).

## Required sheet and columns

Sheet: `contracts_filtered`

Columns expected:
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

Optional VO sheet: `variation_orders`
- contractKey
- voNumber
- voDate
- voDescription
- voAmount
- voStatus

## Important note about browser security

Browser apps cannot silently open local files without your permission.
So you select the workbook once using **Open Excel File**. After that, this app can automatically detect file changes and refresh while it remains open.

