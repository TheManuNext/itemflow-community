import { describe, expect, it } from "vitest";

import { makeViewContext } from "../view_context.js";

describe("makeViewContext", () => {
	it("produces a read-only frm-compatible context", () => {
		const ctx = makeViewContext({
			company: "Acme",
			priceList: "Selling 2026",
			warehouse: "Stores - A",
		});

		expect(ctx.doctype).toBeNull();
		expect(ctx.doc.company).toBe("Acme");
		expect(ctx.doc.selling_price_list).toBe("Selling 2026");
		expect(ctx.doc.buying_price_list).toBeNull();
		expect(ctx.doc.set_warehouse).toBe("Stores - A");
		// The renderer does (doc.items || []); it should be an empty list.
		expect(ctx.doc.items).toEqual([]);
	});

	it("routes the price list to buying_price_list when buying", () => {
		const ctx = makeViewContext({ priceList: "Buying 2026", buying: true });
		expect(ctx.doc.buying_price_list).toBe("Buying 2026");
		expect(ctx.doc.selling_price_list).toBeNull();
	});

	it("defaults to empty values without arguments", () => {
		const ctx = makeViewContext();
		expect(ctx.doc.company).toBe("");
		expect(ctx.doc.selling_price_list).toBeNull();
		expect(ctx.doc.buying_price_list).toBeNull();
		expect(ctx.doc.set_warehouse).toBe("");
	});
});
