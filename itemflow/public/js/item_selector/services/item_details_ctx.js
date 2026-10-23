// Copyright (c) 2025-2026 TheManuNext
// Portions Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// Licensed under the GNU General Public License v3. See LICENSE

/**
 * Pure builder for the `ctx` argument of ERPNext's
 * `erpnext.stock.get_item_details.get_item_details`.
 *
 * Mirrors the context ERPNext builds in its own `item_code` handler
 * (`erpnext/public/js/controllers/transaction.js`) but keeps the UOM and
 * conversion factor chosen by the user, instead of resetting them to the
 * item defaults.
 *
 * No DOM / `frappe` access so the builder stays unit-testable (vitest).
 */

function toInt(value) {
	return parseInt(value, 10) || 0;
}

export function buildItemDetailsCtx(doc, row, selectedUom, selectedConversionFactor) {
	const updateStock = ["Sales Invoice", "Purchase Invoice"].includes(doc.doctype)
		? doc.update_stock
		: 0;

	return {
		item_code: row.item_code,
		barcode: row.barcode,
		serial_no: row.serial_no,
		batch_no: row.batch_no,
		set_warehouse: doc.set_warehouse,
		warehouse: row.warehouse || row.t_warehouse,
		customer: doc.customer || doc.party_name,
		quotation_to: doc.quotation_to,
		supplier: doc.supplier,
		currency: doc.currency,
		is_internal_supplier: doc.is_internal_supplier,
		is_internal_customer: doc.is_internal_customer,
		update_stock: updateStock,
		conversion_rate: doc.conversion_rate,
		price_list: doc.selling_price_list || doc.buying_price_list,
		price_list_currency: doc.price_list_currency,
		plc_conversion_rate: doc.plc_conversion_rate,
		company: doc.company,
		order_type: doc.order_type,
		is_pos: toInt(doc.is_pos),
		is_return: toInt(doc.is_return),
		is_subcontracted: doc.is_subcontracted,
		ignore_pricing_rule: doc.ignore_pricing_rule,
		doctype: doc.doctype,
		name: doc.name,
		project: row.project || doc.project,
		qty: row.qty || 1,
		net_rate: row.rate,
		base_net_rate: row.base_net_rate,
		stock_qty: row.stock_qty,
		conversion_factor: selectedConversionFactor,
		weight_per_unit: row.weight_per_unit,
		uom: selectedUom,
		weight_uom: row.weight_uom,
		manufacturer: row.manufacturer,
		stock_uom: row.stock_uom,
		pos_profile: toInt(doc.is_pos) ? doc.pos_profile : "",
		cost_center: row.cost_center,
		tax_category: doc.tax_category,
		item_tax_template: row.item_tax_template,
		child_doctype: row.doctype,
		child_docname: row.name,
		is_old_subcontracting_flow: doc.is_old_subcontracting_flow,
		use_serial_batch_fields: row.use_serial_batch_fields,
		serial_and_batch_bundle: row.serial_and_batch_bundle,
	};
}
