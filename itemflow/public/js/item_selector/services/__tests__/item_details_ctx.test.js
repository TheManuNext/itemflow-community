import { describe, expect, it } from "vitest";

import { buildItemDetailsCtx } from "../item_details_ctx.js";

function doc(overrides = {}) {
	return { doctype: "Sales Order", name: "SO-0001", ...overrides };
}

function row(overrides = {}) {
	return {
		doctype: "Sales Order Item",
		name: "row-1",
		parentfield: "items",
		item_code: "ITEM-001",
		qty: 3,
		...overrides,
	};
}

describe("buildItemDetailsCtx", () => {
	it("passes the user-selected UOM and conversion factor through", () => {
		const ctx = buildItemDetailsCtx(doc(), row(), "Box", 12);
		expect(ctx.uom).toBe("Box");
		expect(ctx.conversion_factor).toBe(12);
		expect(ctx.qty).toBe(3);
	});

	it("uses the selling price list for sales documents", () => {
		const ctx = buildItemDetailsCtx(
			doc({ doctype: "Sales Order", selling_price_list: "Selling 2026" }),
			row(),
			"Nos",
			1
		);
		expect(ctx.price_list).toBe("Selling 2026");
		expect(ctx.customer).toBeUndefined();
	});

	it("uses the buying price list and supplier for purchase documents", () => {
		const ctx = buildItemDetailsCtx(
			doc({
				doctype: "Purchase Order",
				buying_price_list: "Buying 2026",
				supplier: "ACME",
			}),
			row(),
			"Nos",
			1
		);
		expect(ctx.price_list).toBe("Buying 2026");
		expect(ctx.supplier).toBe("ACME");
	});

	it("maps the Stock Entry target warehouse from the row", () => {
		const ctx = buildItemDetailsCtx(
			doc({ doctype: "Stock Entry", to_warehouse: "Stores - STD" }),
			row({ doctype: "Stock Entry Detail", t_warehouse: "Stores - STD" }),
			"Nos",
			1
		);
		expect(ctx.warehouse).toBe("Stores - STD");
		expect(ctx.doctype).toBe("Stock Entry");
	});

	it("falls back to the party_name for quotations", () => {
		const ctx = buildItemDetailsCtx(
			doc({ doctype: "Quotation", party_name: "Lead Co" }),
			row(),
			"Nos",
			1
		);
		expect(ctx.customer).toBe("Lead Co");
	});

	it("normalises boolean-ish pos/return fields", () => {
		const ctx = buildItemDetailsCtx(doc({ is_pos: "1", is_return: 0 }), row(), "Nos", 1);
		expect(ctx.is_pos).toBe(1);
		expect(ctx.is_return).toBe(0);
	});
});
