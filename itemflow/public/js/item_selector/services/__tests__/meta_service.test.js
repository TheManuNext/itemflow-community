import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ItemSelectorMetaService } from "../meta_service.js";

describe("ItemSelectorMetaService", () => {
	let calls;

	beforeEach(() => {
		calls = [];
		globalThis.frappe = {
			xcall: vi.fn(async (method, args) => {
				calls.push({ method, args });
				return { "ITEM-1": { stock: 3, price: 7, stock_uom: "Unit" } };
			}),
		};
	});

	afterEach(() => {
		delete globalThis.frappe;
	});

	function makeFrm(docOverrides = {}) {
		return {
			doctype: "Sales Order",
			doc: { doctype: "Sales Order", ...docOverrides },
		};
	}

	it("sends the context (company, warehouse, price_list) to get_items_meta", async () => {
		const frm = makeFrm({
			company: "Company A",
			set_warehouse: "Stores - A",
			selling_price_list: "Selling 2026",
		});
		const service = new ItemSelectorMetaService(frm);

		const meta = await service.getItemsMeta(["ITEM-1"]);

		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("itemflow.api.get_items_meta");
		expect(calls[0].args).toEqual({
			item_codes: ["ITEM-1"],
			price_list: "Selling 2026",
			buying: 0,
			warehouse: "Stores - A",
			company: "Company A",
		});
		expect(meta["ITEM-1"].stock).toBe(3);
	});

	it("uses buying (buying=1) on purchase documents", async () => {
		const frm = {
			doctype: "Purchase Order",
			doc: { doctype: "Purchase Order", company: "Company A", buying_price_list: "Buying 2026" },
		};
		const service = new ItemSelectorMetaService(frm);

		await service.getItemsMeta(["ITEM-1"]);

		expect(calls[0].args.buying).toBe(1);
		expect(calls[0].args.price_list).toBe("Buying 2026");
	});

	it("reuses the client cache on repeated calls", async () => {
		const service = new ItemSelectorMetaService(makeFrm({ company: "Company A" }));

		await service.getItemsMeta(["ITEM-1"]);
		await service.getItemsMeta(["ITEM-1"]);

		expect(calls).toHaveLength(1);
	});
});
