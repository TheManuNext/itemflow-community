// Copyright (c) 2025-2026 TheManuNext
// Portions Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// Licensed under the GNU General Public License v3. See LICENSE

import { buildItemDetailsCtx } from "./item_details_ctx.js";

/**
 * Native item-details pipeline.
 *
 * Ports the server-side `process_item_selection`
 * (`erpnext/utilities/transaction_base.py`) so Itemflow's bulk add produces the
 * same row data as selecting an item by hand in the desk: rate/discounts,
 * taxes, free items, internal-party valuation and stock conversion fields.
 *
 * `frm.call({ child })` only applies the raw `get_item_details` response to the
 * row. The derived values below (rate, discounts, stock_qty, ...) are computed
 * the same way ERPNext does, but with defensive `flt()` so an absent margin
 * field can never turn `rate` into `NaN`.
 */

// Item-specific fields ERPNext clears before re-fetching item details.
const RESET_FIELDS = ["weight_per_unit", "weight_uom", "barcode", "pricing_rules"];

function doctypeHasField(doctype, fieldname) {
	try {
		return Boolean(frappe.meta.get_docfield(doctype, fieldname));
	} catch (e) {
		return false;
	}
}

/**
 * Port of `set_item_rate_and_discounts` (`transaction_base.py:511`).
 * Always numeric thanks to `flt()` handling undefined/null.
 */
export function applyItemRateAndDiscounts(frm, row) {
	let effective_item_rate = flt(row.price_list_rate);

	if (
		["Sales Order", "Quotation"].includes(row.parenttype) &&
		row.blanket_order_rate
	) {
		effective_item_rate = row.blanket_order_rate;
	}

	if (row.margin_type === "Percentage") {
		row.rate_with_margin =
			flt(effective_item_rate) +
			flt(effective_item_rate) * (flt(row.margin_rate_or_amount) / 100);
	} else {
		row.rate_with_margin = flt(effective_item_rate) + flt(row.margin_rate_or_amount);
	}

	row.base_rate_with_margin = flt(row.rate_with_margin) * flt(frm.doc.conversion_rate);

	let item_rate = flt(row.rate_with_margin, precision("rate", row));

	if (row.discount_percentage) {
		row.discount_amount =
			(flt(row.rate_with_margin) * flt(row.discount_percentage)) / 100;
	}

	if (row.discount_amount) {
		item_rate = flt(
			row.rate_with_margin - row.discount_amount,
			precision("rate", row)
		);
	}

	row.rate = item_rate;
	return row;
}

/**
 * Port of `set_rate_based_on_price_list` (`transaction_base.py:453`).
 * Only overrides the rate when a discount percentage is present; the base rate
 * is set by `applyItemRateAndDiscounts`.
 */
export function setRateBasedOnPriceList(frm, row) {
	if (row.price_list_rate && row.discount_percentage) {
		row.rate = flt(
			row.price_list_rate * (1 - row.discount_percentage / 100.0),
			precision("rate", row)
		);
	}
	return row;
}

/**
 * Port of `conversion_factor` (`transaction_base.py:487`): stock quantity,
 * total weight and stock-UOM rate. `apply_price_list` is intentionally skipped
 * because `get_item_details` already resolves the price list for the row.
 */
export function applyConversionFactor(frm, row) {
	if (!doctypeHasField(row.doctype, "stock_qty")) {
		return row;
	}

	row.stock_qty = flt(row.qty * row.conversion_factor, precision("stock_qty", row));

	if (frm.doc.doctype !== "Material Request") {
		row.total_weight = flt(row.stock_qty * row.weight_per_unit);
	}

	if (row.rate) {
		row.stock_uom_rate = flt(row.rate) / flt(row.conversion_factor);
	}

	return row;
}

/**
 * Whether the row should trigger the serial/batch selector, mirroring
 * `show_batch_dialog_if_required` (`transaction.js:916`). Stock Entry handles
 * batch/serial through `use_serial_batch_fields`, so it is not included.
 */
export function requiresBatchSerial(frm, row) {
	let show = false;

	if (["Sales Invoice", "Purchase Invoice"].includes(frm.doc.doctype)) {
		show = cint(frm.doc.update_stock) === 1;
	} else if (
		["Purchase Receipt", "Delivery Note"].includes(frm.doc.doctype)
	) {
		show = true;
	}

	if (show && cint(row.use_serial_batch_fields) === 1) {
		show = false;
	}

	return Boolean(show && (row.has_batch_no || row.has_serial_no));
}

async function resolveIncomingRate(frm, row) {
	const item_args = {
		item_code: row.item_code,
		warehouse: row.warehouse || row.s_warehouse || row.t_warehouse,
		posting_date: frm.doc.posting_date || frm.doc.transaction_date,
		posting_time: frm.doc.posting_time,
		qty: row.qty * row.conversion_factor,
		serial_no: row.serial_no,
		batch_no: row.batch_no,
		voucher_type: frm.doc.doctype,
		company: frm.doc.company,
		allow_zero_valuation_rate: row.allow_zero_valuation_rate,
	};

	const rate = await frappe.xcall("erpnext.stock.utils.get_incoming_rate", {
		args: item_args,
	});

	row.rate = flt(rate) * flt(row.conversion_factor);
	return row;
}

async function usesInternalValuation(frm) {
	if (!(frm.doc.is_internal_customer || frm.doc.is_internal_supplier)) {
		return false;
	}

	try {
		const enabled = await frappe.db.get_single_value(
			"Accounts Settings",
			"fetch_valuation_rate_for_internal_transaction"
		);
		return cint(enabled) === 1;
	} catch (e) {
		return false;
	}
}

/**
 * Resolves a single row exactly like ERPNext's native item selection.
 *
 * @returns {Promise<{needs_batch_serial: boolean}>}
 */
export async function resolveItemNative(frm, row, selectedUom, selectedConversionFactor) {
	// Mirror `reset_item_details` from `process_item_selection`.
	RESET_FIELDS.forEach((fieldname) => {
		if (fieldname in row) row[fieldname] = null;
	});
	row.uom = selectedUom;
	row.conversion_factor = selectedConversionFactor;

	const ctx = buildItemDetailsCtx(frm.doc, row, selectedUom, selectedConversionFactor);

	await frm.call({
		method: "erpnext.stock.get_item_details.get_item_details",
		child: row,
		args: { doc: frm.doc, ctx },
	});

	const cscript = frm.cscript;
	const hasRateField = doctypeHasField(row.doctype, "rate");

	// get_item_details only returns price_list_rate; derive rate + discounts.
	// Stock Entry rows price through basic_rate/valuation_rate, so they are skipped.
	if (hasRateField) {
		applyItemRateAndDiscounts(frm, row);
	}

	if (cscript && typeof cscript.add_taxes_from_item_tax_template === "function") {
		cscript.add_taxes_from_item_tax_template(row.item_tax_rate);
	}

	if (
		row.free_item_data &&
		row.free_item_data.length &&
		cscript &&
		typeof cscript.apply_product_discount === "function"
	) {
		await cscript.apply_product_discount(row);
	}

	if (await usesInternalValuation(frm)) {
		await resolveIncomingRate(frm, row);
		applyConversionFactor(frm, row);
		return { needs_batch_serial: requiresBatchSerial(frm, row) };
	}

	if (hasRateField) {
		setRateBasedOnPriceList(frm, row);
	}

	if (
		cscript &&
		typeof cscript.remove_pricing_rule === "function" &&
		row.pricing_rules
	) {
		cscript.remove_pricing_rule(row);
	}

	applyConversionFactor(frm, row);

	return { needs_batch_serial: requiresBatchSerial(frm, row) };
}
