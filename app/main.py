from __future__ import annotations

from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import pandas as pd
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure

from app.calculations import compute_kpis, enrich_contracts
from app.config import load_config, save_config
from app.data_loader import ExcelRepository


def fmt_date(v: object) -> str:
    if pd.isna(v):
        return ""
    return pd.Timestamp(v).strftime("%Y-%m-%d")


def fmt_money(v: float) -> str:
    return f"{v:,.2f}"


class ContractTrackerApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Contract Management Tracker - Offline")
        self.geometry("1500x900")
        self.configure(bg="#f4f6fb")

        self.config_data = load_config()
        self.repo = ExcelRepository(
            excel_path=self.config_data["excel_path"],
            main_sheet=self.config_data["main_sheet"],
            vo_sheet=self.config_data["variation_orders_sheet"],
        )
        self.contracts = pd.DataFrame()
        self.vos = pd.DataFrame()
        self.filtered = pd.DataFrame()

        self._build_layout()
        self.load_and_render(show_popup=False)
        self.after(self.config_data["auto_refresh_seconds"] * 1000, self.auto_refresh)

    def _build_layout(self) -> None:
        top = ttk.Frame(self)
        top.pack(fill="x", padx=10, pady=10)

        ttk.Label(top, text="Excel File:").pack(side="left")
        self.path_var = tk.StringVar(value=str(self.repo.excel_path))
        ttk.Entry(top, textvariable=self.path_var, width=90).pack(side="left", padx=6)
        ttk.Button(top, text="Browse", command=self.choose_excel).pack(side="left", padx=4)
        ttk.Button(top, text="Refresh", command=lambda: self.load_and_render(show_popup=True)).pack(side="left", padx=4)

        self.status_var = tk.StringVar(value="Ready")
        ttk.Label(top, textvariable=self.status_var).pack(side="right")

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        self.dashboard_tab = ttk.Frame(self.notebook)
        self.register_tab = ttk.Frame(self.notebook)
        self.expiry_tab = ttk.Frame(self.notebook)
        self.extension_tab = ttk.Frame(self.notebook)
        self.vo_tab = ttk.Frame(self.notebook)
        self.summary_tab = ttk.Frame(self.notebook)
        self.reports_tab = ttk.Frame(self.notebook)

        self.notebook.add(self.dashboard_tab, text="Dashboard")
        self.notebook.add(self.register_tab, text="All Contracts Register")
        self.notebook.add(self.expiry_tab, text="Expiry Tracker")
        self.notebook.add(self.extension_tab, text="Extension Tracker")
        self.notebook.add(self.vo_tab, text="Variation Orders")
        self.notebook.add(self.summary_tab, text="Summaries")
        self.notebook.add(self.reports_tab, text="Reports / Export")

        self._build_dashboard()
        self._build_register()
        self._build_expiry()
        self._build_extension()
        self._build_vo()
        self._build_summary()
        self._build_reports()

    def choose_excel(self) -> None:
        selected = filedialog.askopenfilename(
            title="Choose contracts Excel file",
            filetypes=[("Excel files", "*.xlsx *.xlsm *.xls")],
        )
        if not selected:
            return
        self.path_var.set(selected)
        self.config_data["excel_path"] = selected
        save_config(self.config_data)
        self.repo = ExcelRepository(selected, self.config_data["main_sheet"], self.config_data["variation_orders_sheet"])
        self.load_and_render(show_popup=True)

    def auto_refresh(self) -> None:
        try:
            if self.repo.is_modified():
                self.load_and_render(show_popup=False)
        finally:
            self.after(self.config_data["auto_refresh_seconds"] * 1000, self.auto_refresh)

    def load_and_render(self, show_popup: bool) -> None:
        wb = self.repo.load()
        enriched, calc_warnings = enrich_contracts(wb.contracts, wb.variation_orders)
        self.contracts = enriched
        self.vos = wb.variation_orders
        self.filtered = self.contracts.copy()
        self.apply_filters()
        self.render_dashboard()
        self.render_register()
        self.render_expiry()
        self.render_extension()
        self.render_vo()
        self.render_summary()
        self.status_var.set(f"Loaded {len(self.contracts)} contracts from {Path(self.repo.excel_path).name}")

        warnings = wb.warnings + calc_warnings
        self.warning_text.delete("1.0", "end")
        self.warning_text.insert("1.0", "\n".join(warnings) if warnings else "No validation warnings")
        if show_popup:
            messagebox.showinfo("Data refreshed", self.status_var.get())

    def _build_dashboard(self) -> None:
        self.kpi_frame = ttk.Frame(self.dashboard_tab)
        self.kpi_frame.pack(fill="x", padx=10, pady=10)

        chart_wrap = ttk.Frame(self.dashboard_tab)
        chart_wrap.pack(fill="both", expand=True, padx=10, pady=10)

        self.fig = Figure(figsize=(14, 7), dpi=100)
        self.ax1 = self.fig.add_subplot(221)
        self.ax2 = self.fig.add_subplot(222)
        self.ax3 = self.fig.add_subplot(223)
        self.ax4 = self.fig.add_subplot(224)
        self.canvas = FigureCanvasTkAgg(self.fig, master=chart_wrap)
        self.canvas.get_tk_widget().pack(fill="both", expand=True)

        warning_frame = ttk.LabelFrame(self.dashboard_tab, text="Validation Warnings")
        warning_frame.pack(fill="both", expand=False, padx=10, pady=(0, 10))
        self.warning_text = tk.Text(warning_frame, height=6, wrap="word")
        self.warning_text.pack(fill="both", expand=True)

    def _build_register(self) -> None:
        controls = ttk.Frame(self.register_tab)
        controls.pack(fill="x", padx=8, pady=8)

        self.search_var = tk.StringVar()
        ttk.Label(controls, text="Search:").pack(side="left")
        ttk.Entry(controls, textvariable=self.search_var, width=35).pack(side="left", padx=4)

        self.filter_status = tk.StringVar(value="All")
        self.filter_bu = tk.StringVar(value="All")
        self.filter_type = tk.StringVar(value="All")

        self.status_combo = ttk.Combobox(controls, textvariable=self.filter_status, width=16, state="readonly")
        self.bu_combo = ttk.Combobox(controls, textvariable=self.filter_bu, width=20, state="readonly")
        self.type_combo = ttk.Combobox(controls, textvariable=self.filter_type, width=20, state="readonly")

        for lbl, w in [("Status", self.status_combo), ("Business Unit", self.bu_combo), ("Contract Type", self.type_combo)]:
            ttk.Label(controls, text=lbl).pack(side="left", padx=(10, 2))
            w.pack(side="left")

        ttk.Button(controls, text="Apply Filters", command=self.apply_filters).pack(side="left", padx=6)
        ttk.Button(controls, text="Reset", command=self.reset_filters).pack(side="left")

        cols = [
            "#", "contractKey", "referenceNumber", "businessUnit", "contractType", "contractorName", "poNumber",
            "contractStatus", "commencementDateObj", "effectiveExpiryDate", "daysRemaining", "baseValue", "totalVOValue", "finalRevisedValue"
        ]
        self.tree = ttk.Treeview(self.register_tab, columns=cols, show="headings")
        for c in cols:
            self.tree.heading(c, text=c, command=lambda x=c: self.sort_tree(x, False))
            self.tree.column(c, width=120, anchor="w")
        self.tree.column("#", width=50)
        self.tree.pack(fill="both", expand=True, padx=8, pady=8)
        self.tree.bind("<Double-1>", self.open_detail)

    def _build_expiry(self) -> None:
        cols = ["contractKey", "referenceNumber", "contractorName", "effectiveExpiryDate", "daysRemaining", "contractStatus", "expiring30", "expiring60", "expiring90"]
        self.expiry_tree = ttk.Treeview(self.expiry_tab, columns=cols, show="headings")
        for c in cols:
            self.expiry_tree.heading(c, text=c)
            self.expiry_tree.column(c, width=150)
        self.expiry_tree.pack(fill="both", expand=True, padx=8, pady=8)

    def _build_extension(self) -> None:
        cols = ["contractKey", "referenceNumber", "extensionCount", "extensionDates", "expiryDateObj", "revisedExpiryDateObj", "revisedDurationDays"]
        self.ext_tree = ttk.Treeview(self.extension_tab, columns=cols, show="headings")
        for c in cols:
            self.ext_tree.heading(c, text=c)
            self.ext_tree.column(c, width=180)
        self.ext_tree.pack(fill="both", expand=True, padx=8, pady=8)

    def _build_vo(self) -> None:
        cols = ["contractKey", "referenceNumber", "contractorName", "voCount", "totalVOValue", "finalRevisedValue"]
        self.vo_summary_tree = ttk.Treeview(self.vo_tab, columns=cols, show="headings", height=8)
        for c in cols:
            self.vo_summary_tree.heading(c, text=c)
            self.vo_summary_tree.column(c, width=190)
        self.vo_summary_tree.pack(fill="x", padx=8, pady=8)

        vo_cols = ["contractKey", "voNumber", "voDate", "voDescription", "voAmount", "voStatus"]
        self.vo_tree = ttk.Treeview(self.vo_tab, columns=vo_cols, show="headings")
        for c in vo_cols:
            self.vo_tree.heading(c, text=c)
            self.vo_tree.column(c, width=180)
        self.vo_tree.pack(fill="both", expand=True, padx=8, pady=8)

    def _build_summary(self) -> None:
        self.summary_text = tk.Text(self.summary_tab, wrap="word")
        self.summary_text.pack(fill="both", expand=True, padx=10, pady=10)

    def _build_reports(self) -> None:
        frame = ttk.Frame(self.reports_tab)
        frame.pack(fill="both", expand=True, padx=10, pady=10)
        ttk.Label(frame, text="Export currently filtered register to CSV:").pack(anchor="w")
        ttk.Button(frame, text="Export CSV", command=self.export_csv).pack(anchor="w", pady=6)

        ttk.Label(frame, text="Print-friendly selected contract summary:").pack(anchor="w", pady=(20, 0))
        ttk.Button(frame, text="Export selected contract as TXT", command=self.export_selected_contract).pack(anchor="w", pady=6)

    def render_dashboard(self) -> None:
        for widget in self.kpi_frame.winfo_children():
            widget.destroy()
        kpis = compute_kpis(self.filtered)
        for i, (k, v) in enumerate(kpis.items()):
            card = ttk.Frame(self.kpi_frame, borderwidth=1, relief="solid")
            card.grid(row=i // 5, column=i % 5, padx=5, pady=5, sticky="nsew")
            ttk.Label(card, text=k, font=("Segoe UI", 9, "bold")).pack(padx=8, pady=(8, 2))
            val = fmt_money(v) if "Value" in k else str(v)
            ttk.Label(card, text=val, font=("Segoe UI", 12)).pack(padx=8, pady=(0, 8))

        self.ax1.clear(); self.ax2.clear(); self.ax3.clear(); self.ax4.clear()
        self.filtered.groupby("businessUnit").size().sort_values(ascending=False).head(10).plot(kind="bar", ax=self.ax1, title="By Business Unit")
        self.filtered.groupby("contractType").size().sort_values(ascending=False).head(10).plot(kind="bar", ax=self.ax2, title="By Contract Type", color="#4895ef")
        self.filtered.groupby("contractStatus").size().plot(kind="pie", ax=self.ax3, title="By Status", autopct="%1.0f%%")
        self.ax3.set_ylabel("")
        expiry_month = self.filtered.dropna(subset=["effectiveExpiryDate"]).copy()
        expiry_month["expiryMonth"] = expiry_month["effectiveExpiryDate"].dt.to_period("M").astype(str)
        expiry_month.groupby("expiryMonth").size().tail(12).plot(kind="line", marker="o", ax=self.ax4, title="Expiry Trend")
        self.fig.tight_layout()
        self.canvas.draw()

    def apply_filters(self) -> None:
        df = self.contracts.copy()
        search = self.search_var.get().strip().lower() if hasattr(self, "search_var") else ""
        if search:
            mask = (
                df["referenceNumber"].astype(str).str.lower().str.contains(search)
                | df["description"].astype(str).str.lower().str.contains(search)
                | df["contractorName"].astype(str).str.lower().str.contains(search)
                | df["poNumber"].astype(str).str.lower().str.contains(search)
                | df["contractKey"].astype(str).str.lower().str.contains(search)
            )
            df = df[mask]

        if hasattr(self, "filter_status") and self.filter_status.get() != "All":
            df = df[df["contractStatus"] == self.filter_status.get()]
        if hasattr(self, "filter_bu") and self.filter_bu.get() != "All":
            df = df[df["businessUnit"] == self.filter_bu.get()]
        if hasattr(self, "filter_type") and self.filter_type.get() != "All":
            df = df[df["contractType"] == self.filter_type.get()]

        self.filtered = df
        if hasattr(self, "status_combo"):
            self.status_combo["values"] = ["All"] + sorted(self.contracts["contractStatus"].dropna().astype(str).unique().tolist())
            self.bu_combo["values"] = ["All"] + sorted(self.contracts["businessUnit"].dropna().astype(str).unique().tolist())
            self.type_combo["values"] = ["All"] + sorted(self.contracts["contractType"].dropna().astype(str).unique().tolist())
        self.render_dashboard()
        self.render_register()
        self.render_expiry()
        self.render_extension()
        self.render_vo()
        self.render_summary()

    def reset_filters(self) -> None:
        self.search_var.set("")
        self.filter_status.set("All")
        self.filter_bu.set("All")
        self.filter_type.set("All")
        self.apply_filters()

    def _clear_tree(self, tree: ttk.Treeview) -> None:
        for i in tree.get_children():
            tree.delete(i)

    def render_register(self) -> None:
        self._clear_tree(self.tree)
        view = self.filtered.fillna("")
        for idx, row in enumerate(view.itertuples(index=False), start=1):
            self.tree.insert("", "end", values=(
                idx, row.contractKey, row.referenceNumber, row.businessUnit, row.contractType, row.contractorName,
                row.poNumber, row.contractStatus, fmt_date(row.commencementDateObj), fmt_date(row.effectiveExpiryDate),
                row.daysRemaining if pd.notna(row.daysRemaining) else "", fmt_money(row.baseValue), fmt_money(row.totalVOValue), fmt_money(row.finalRevisedValue)
            ))

    def render_expiry(self) -> None:
        self._clear_tree(self.expiry_tree)
        subset = self.filtered.sort_values("daysRemaining", na_position="last")
        for _, r in subset.iterrows():
            self.expiry_tree.insert("", "end", values=(
                r["contractKey"], r["referenceNumber"], r["contractorName"], fmt_date(r["effectiveExpiryDate"]), r["daysRemaining"], r["contractStatus"],
                "Yes" if r["expiring30"] else "No", "Yes" if r["expiring60"] else "No", "Yes" if r["expiring90"] else "No"
            ))

    def render_extension(self) -> None:
        self._clear_tree(self.ext_tree)
        subset = self.filtered[self.filtered["hasExtension"]]
        for _, r in subset.iterrows():
            self.ext_tree.insert("", "end", values=(
                r["contractKey"], r["referenceNumber"], r["extensionCount"], r["extensionDates"],
                fmt_date(r["expiryDateObj"]), fmt_date(r["revisedExpiryDateObj"]), r["revisedDurationDays"]
            ))

    def render_vo(self) -> None:
        self._clear_tree(self.vo_summary_tree)
        subset = self.filtered[self.filtered["hasVO"]]
        for _, r in subset.iterrows():
            self.vo_summary_tree.insert("", "end", values=(
                r["contractKey"], r["referenceNumber"], r["contractorName"], r["voCount"], fmt_money(r["totalVOValue"]), fmt_money(r["finalRevisedValue"])
            ))

        self._clear_tree(self.vo_tree)
        vo_view = self.vos.fillna("")
        for _, r in vo_view.iterrows():
            self.vo_tree.insert("", "end", values=(
                r.get("contractKey", ""), r.get("voNumber", ""), fmt_date(r.get("voDate", "")), r.get("voDescription", ""), fmt_money(float(r.get("voAmount", 0) or 0)), r.get("voStatus", "")
            ))

    def render_summary(self) -> None:
        self.summary_text.delete("1.0", "end")
        top_contractors = self.filtered.groupby("contractorName").size().sort_values(ascending=False).head(10)
        top_bus = self.filtered.groupby("businessUnit").size().sort_values(ascending=False)

        lines = [
            "CONTRACTOR SUMMARY (Top 10)",
            "-" * 40,
        ]
        for name, count in top_contractors.items():
            lines.append(f"{name}: {count}")

        lines += ["", "BUSINESS UNIT SUMMARY", "-" * 40]
        for name, count in top_bus.items():
            lines.append(f"{name}: {count}")

        lines += ["", "EXPIRING ALERTS", "-" * 40]
        expiring = self.filtered[self.filtered["expiring90"]].sort_values("daysRemaining")
        for _, r in expiring.head(30).iterrows():
            lines.append(f"{r['referenceNumber']} | {r['contractorName']} | {int(r['daysRemaining']) if pd.notna(r['daysRemaining']) else 'N/A'} days")

        self.summary_text.insert("1.0", "\n".join(lines))

    def open_detail(self, _event=None) -> None:
        selected = self.tree.selection()
        if not selected:
            return
        item = self.tree.item(selected[0])["values"]
        contract_key = item[1]
        row = self.filtered[self.filtered["contractKey"].astype(str) == str(contract_key)]
        if row.empty:
            return
        r = row.iloc[0]

        detail = tk.Toplevel(self)
        detail.title(f"Contract Details - {r['referenceNumber']}")
        detail.geometry("900x700")

        text = tk.Text(detail, wrap="word")
        text.pack(fill="both", expand=True, padx=10, pady=10)

        vo_rows = self.vos[self.vos["contractKey"].astype(str) == str(contract_key)]
        timeline = [
            f"Signing Date: {fmt_date(r['signingDateObj'])}",
            f"Commencement Date: {fmt_date(r['commencementDateObj'])}",
            f"Original Expiry Date: {fmt_date(r['expiryDateObj'])}",
            f"Revised Expiry Date (Extensions): {fmt_date(r['revisedExpiryDateObj'])}",
            f"Revised Expiry Date (with VO): {fmt_date(r['revisedExpiryWithVOObj'])}",
            f"Effective Expiry Date: {fmt_date(r['effectiveExpiryDate'])}",
        ]
        body = [
            f"Contract Key: {r['contractKey']}",
            f"Reference Number: {r['referenceNumber']}",
            f"Business Unit: {r['businessUnit']}",
            f"Made By: {r['madeBy']}",
            f"Type: {r['contractType']}",
            f"Description: {r['description']}",
            f"Contractor: {r['contractorName']}",
            f"PO Number: {r['poNumber']}",
            f"Status: {r['contractStatus']}",
            f"Days Remaining: {r['daysRemaining']}",
            f"Duration (days): {r['durationDays']}",
            f"Revised Duration (days): {r['revisedDurationDays']}",
            f"Extension Count: {r['extensionCount']}",
            f"Extension Dates: {r['extensionDates']}",
            f"Base Value: {fmt_money(r['baseValue'])}",
            f"Total VO Value: {fmt_money(r['totalVOValue'])}",
            f"Final Revised Value: {fmt_money(r['finalRevisedValue'])}",
            "",
            "Timeline",
            "-" * 30,
            *timeline,
            "",
            "Variation Orders",
            "-" * 30,
        ]

        if vo_rows.empty:
            body.append("No variation orders found for this contract.")
        else:
            for _, vo in vo_rows.iterrows():
                body.append(f"{vo.get('voNumber', '')} | {fmt_date(vo.get('voDate', ''))} | {vo.get('voDescription', '')} | {fmt_money(float(vo.get('voAmount', 0) or 0))} | {vo.get('voStatus', '')}")

        text.insert("1.0", "\n".join(map(str, body)))

    def sort_tree(self, col: str, reverse: bool) -> None:
        if col == "#":
            return
        data = [(self.tree.set(k, col), k) for k in self.tree.get_children("")]
        data.sort(reverse=reverse)
        for idx, (_, k) in enumerate(data):
            self.tree.move(k, "", idx)
        self.tree.heading(col, command=lambda: self.sort_tree(col, not reverse))

    def export_csv(self) -> None:
        path = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV file", "*.csv")])
        if not path:
            return
        self.filtered.to_csv(path, index=False)
        messagebox.showinfo("Export", f"CSV exported to {path}")

    def export_selected_contract(self) -> None:
        selected = self.tree.selection()
        if not selected:
            messagebox.showwarning("No selection", "Select a contract in register first.")
            return
        contract_key = self.tree.item(selected[0])["values"][1]
        row = self.filtered[self.filtered["contractKey"].astype(str) == str(contract_key)]
        if row.empty:
            return
        path = filedialog.asksaveasfilename(defaultextension=".txt", filetypes=[("Text file", "*.txt")])
        if not path:
            return
        row.iloc[0].to_frame().to_csv(path, header=False)
        messagebox.showinfo("Export", f"Contract summary exported to {path}")


if __name__ == "__main__":
    app = ContractTrackerApp()
    app.mainloop()
