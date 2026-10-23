import { resolveItemNative } from "./item_pipeline.js";

export class ItemSelectorBulkAdder {
	constructor(selector) {
		this.selector = selector;
		this.frm = selector.frm;
		this.added_count = 0;
		this.failed_items = [];
		this.batch_serial_rows = [];
	}

	// Processes a single batch of item codes and returns aggregate stats.
	// Chunking (splitting a large selection into batches) and the progress
	// dialog are orchestrated by the selector, so this stays a focused worker.
	async execute(itemCodes) {
		this.added_count = 0;
		this.failed_items = [];
		this.batch_serial_rows = [];

		// Map item_code -> rows already present in the document (O(1) merge lookup).
		this._existingRowsMap = new Map();
		(this.frm.doc.items || []).forEach((row) => {
			if (row.item_code) this._trackRow(row.item_code, row);
		});

		// Item details are resolved per row with `get_item_details`, which only
		// updates the individual child row (never syncs the whole document), so
		// concurrent calls are safe and do not truncate unsaved rows.
		await Promise.all(
			itemCodes.map(async (code) => {
				try {
					await this.addSingleItemOptimized(code);
					this.added_count++;
				} catch (e) {
					this.selector.config.debug("Failed to add item:", code, e);
					this.failed_items.push({ code, error: e.message });
				}
			})
		);

		this.frm.refresh_field("items");

		return {
			added: this.added_count,
			failed: this.failed_items.length,
			failed_items: this.failed_items,
			batch_serial_rows: this.batch_serial_rows,
		};
	}

	_trackRow(itemCode, row) {
		const rows = this._existingRowsMap.get(itemCode) || [];
		rows.push(row);
		this._existingRowsMap.set(itemCode, rows);
	}

	_findMergeRow(itemCode, uom) {
		const rows = this._existingRowsMap.get(itemCode) || [];
		return rows.find((row) => row.uom === uom) || null;
	}

	_fallbackUom() {
		return (
			(frappe.boot && frappe.boot.sysdefaults && frappe.boot.sysdefaults.stock_uom) ||
			"Unit"
		);
	}

	// Mirror ERPNext's default for the serial/batch field: when the user opted
	// into entering batch/serial numbers inline, new rows should start with it on.
	_applySerialBatchDefault(row) {
		if (cint(frappe.user_defaults && frappe.user_defaults.use_serial_batch_fields) !== 1) {
			return;
		}
		if (row.use_serial_batch_fields) return;

		try {
			if (frappe.meta.get_docfield(row.doctype, "use_serial_batch_fields")) {
				row.use_serial_batch_fields = 1;
			}
		} catch (e) {
			// meta not available (tests) -> ignore
		}
	}

	async addSingleItemOptimized(itemCode) {
		const data = this.selector.selected_items[itemCode];

		if (!data || data.qty <= 0) {
			throw new Error(`Invalid quantity for ${itemCode}`);
		}

		// UOM / conversion factor chosen by the user take precedence over the
		// item defaults; `get_item_details` receives them through `ctx`.
		const selectedUom = data.uom || data.stock_uom || this._fallbackUom();
		const selectedConversionFactor = data.conversion_factor || 1;

		// Merge: sum qty on the first existing row with this item_code and UOM.
		if (data._action === "merge") {
			const existingRow = this._findMergeRow(itemCode, selectedUom);
			if (existingRow) {
				existingRow.qty = flt(existingRow.qty) + flt(data.qty);
				await this._resolveItemDetails(existingRow, selectedUom, selectedConversionFactor);
				return existingRow;
			}
			// Fallback: no matching row -> add as a new line.
		}

		const row = this.frm.add_child("items");
		this._trackRow(itemCode, row);

		row.item_code = itemCode;
		row.qty = data.qty;
		row.uom = selectedUom;
		row.conversion_factor = selectedConversionFactor;
		this._applySerialBatchDefault(row);

		// Inherit "Required By" from the header (PO / Material Request / Supplier Quotation)
		const scheduleDoctypes = ["Purchase Order", "Material Request", "Supplier Quotation"];
		if (scheduleDoctypes.includes(this.frm.doctype) && this.frm.doc.schedule_date) {
			row.schedule_date = this.frm.doc.schedule_date;
		}

		// Inherit the delivery date from the header, mirroring the native
		// `Sales Order Item.item_code` handler (`sales_order.js`). That handler
		// only runs on interactive field changes, so a programmatic bulk add has
		// to replicate it. When the header has no date, fall back to the first
		// row that already carries one (native `copy_from_first_row`).
		if (this.frm.doctype === "Sales Order") {
			if (this.frm.doc.delivery_date) {
				row.delivery_date = this.frm.doc.delivery_date;
			} else {
				const firstRow = (this.frm.doc.items || [])[0];
				if (firstRow && firstRow !== row && firstRow.delivery_date) {
					row.delivery_date = firstRow.delivery_date;
				}
			}
		}

		// Inherit warehouse from the header (Material Request, Purchase Receipt, Purchase Invoice)
		const warehouseDoctypes = ["Material Request", "Purchase Receipt", "Purchase Invoice"];
		if (warehouseDoctypes.includes(this.frm.doctype) && this.frm.doc.set_warehouse) {
			row.warehouse = this.frm.doc.set_warehouse;
		}

		// Stock Entry inherits both source and target warehouses from the header
		// (mirrors the `items_add` handler in Stock Entry).
		if (this.frm.doctype === "Stock Entry") {
			if (this.frm.doc.from_warehouse) row.s_warehouse = this.frm.doc.from_warehouse;
			if (this.frm.doc.to_warehouse) row.t_warehouse = this.frm.doc.to_warehouse;
		}

		await this._resolveItemDetails(row, selectedUom, selectedConversionFactor);
		return row;
	}

	// Resolves item defaults, price, taxes, discounts and stock fields for a
	// single row, replicating ERPNext's native item-selection pipeline. Only the
	// child row is updated (no whole-document sync), which keeps locally added
	// rows from being truncated.
	async _resolveItemDetails(row, selectedUom, selectedConversionFactor) {
		const { needs_batch_serial } = await resolveItemNative(
			this.frm,
			row,
			selectedUom,
			selectedConversionFactor
		);

		if (needs_batch_serial) {
			this.batch_serial_rows.push(row);
		}
	}
}
