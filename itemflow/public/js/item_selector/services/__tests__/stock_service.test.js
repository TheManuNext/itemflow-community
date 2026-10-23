import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ItemSelectorStockService } from "../stock_service.js";

describe("ItemSelectorStockService - company wiring", () => {
	let calls;

	beforeEach(() => {
		calls = [];
		globalThis.frappe = {
			xcall: vi.fn(async (method, args) => {
				calls.push({ method, args });
				return {};
			}),
			show_alert: vi.fn(),
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

	it("sends company and warehouse to get_stock_levels", async () => {
		const frm = makeFrm({ company: "Company A", set_warehouse: "Stores - A" });
		const service = new ItemSelectorStockService(frm);

		await service.getStockLevels(["ITEM-1"]);

		const call = calls.find((c) => c.method === "itemflow.api.get_stock_levels");
		expect(call).toBeTruthy();
		expect(call.args).toEqual({
			item_codes: ["ITEM-1"],
			warehouse: "Stores - A",
			company: "Company A",
		});
	});

	it("sends company in getStockForItem", async () => {
		const frm = makeFrm({ company: "Company B" });
		const service = new ItemSelectorStockService(frm);

		await service.getStockForItem("ITEM-2");

		const call = calls.find((c) => c.method === "itemflow.api.get_stock_levels");
		expect(call).toBeTruthy();
		expect(call.args.company).toBe("Company B");
	});

	it("usa claves de cache distintas por compania", () => {
		const a = new ItemSelectorStockService(makeFrm({ company: "Company A" }));
		const b = new ItemSelectorStockService(makeFrm({ company: "Company B" }));

		expect(a._cacheKey("ITEM-1")).not.toBe(b._cacheKey("ITEM-1"));
	});
});
