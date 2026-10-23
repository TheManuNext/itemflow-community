/**
 * Pure helpers for the items grid.
 *
 * These functions carry no state and do not touch the DOM or `frappe`, which
 * makes them unit-testable (vitest). The grid facade delegates to them.
 */

const RESTOCK_DOCTYPES = [
	"Purchase Order",
	"Material Request",
	"Supplier Quotation",
	"Purchase Invoice",
	"Purchase Receipt",
];

export function isRestockDoctype(doctype) {
	return RESTOCK_DOCTYPES.includes(doctype);
}

export function isNoPriceDoctype(doctype) {
	return doctype === "Material Request" || doctype === "Stock Entry";
}

// Effective document warehouse: Stock Entry uses to_warehouse (incoming)
// instead of set_warehouse, which only exists on sales/purchase doctypes.
export function effectiveWarehouse(doc, doctype) {
	if (!doc) return "";
	if (doctype === "Stock Entry") {
		return doc.to_warehouse || doc.from_warehouse || "";
	}
	return doc.set_warehouse || "";
}

// is_stock_item = 0 => non-stock/service item (no Bin, no stock logic).
export function isStockItem(item) {
	return !(item && (item.is_stock_item === 0 || item.is_stock_item === false));
}

export function fallbackUom(settings, sysdefaults) {
	return (
		(settings && settings.default_uom) ||
		(sysdefaults && sysdefaults.stock_uom) ||
		"Unit"
	);
}

export function currency(doc, sysdefaults) {
	return (
		(doc && (doc.currency || doc.company_currency)) ||
		(sysdefaults && sysdefaults.currency) ||
		undefined
	);
}

export function getUomInfo(uomsMap, item_code, fbUom) {
	return (
		(uomsMap && uomsMap[item_code]) || {
			stock_uom: fbUom,
			uoms: [{ uom: fbUom, conversion_factor: 1 }],
		}
	);
}

export function getConversionFactor(uomsMap, item_code, uom, fbUom) {
	const info = getUomInfo(uomsMap, item_code, fbUom);
	const found = (info.uoms || []).find((u) => u.uom === uom);
	return found ? found.conversion_factor : 1;
}

export function getDefaultUom(item, fbUom) {
	return item.uom || item.stock_uom || fbUom;
}

// Splits a list into consecutive chunks of at most `size` elements.
export function chunk(list, size) {
	const chunkSize = Math.max(1, parseInt(size, 10) || 1);
	const chunks = [];
	for (let i = 0; i < list.length; i += chunkSize) {
		chunks.push(list.slice(i, i + chunkSize));
	}
	return chunks;
}
