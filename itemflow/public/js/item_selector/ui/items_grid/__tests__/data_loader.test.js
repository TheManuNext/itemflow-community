import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ItemsGridDataLoader } from "../data_loader.js";

describe("ItemsGridDataLoader - company wiring", () => {
	let calls;
	let renderCalls;
	let metaMock;

	beforeEach(() => {
		calls = [];
		renderCalls = [];
		metaMock = {
			getItemsMeta: vi.fn(async () => ({
				"ITEM-1": {
					stock: 5,
					price: 9,
					stock_uom: "Unit",
					uoms: [{ uom: "Unit", conversion_factor: 1 }],
				},
			})),
		};
		globalThis.frappe = {
			xcall: vi.fn(async (method, args) => {
				calls.push({ method, args });
				if (
					method === "itemflow.api.get_items_by_search" ||
					method === "itemflow.api.get_items_by_group"
				) {
					return { items: [{ item_code: "ITEM-1", item_name: "Item 1" }], total: 1 };
				}
				return {};
			}),
		};
	});

	afterEach(() => {
		delete globalThis.frappe;
	});

	function makeLoader() {
		const state = {
			mode: "",
			groups: [],
			page: 1,
			search: "",
			filters: {},
			perPage: 20,
			inStockOnly: false,
			restockOnly: false,
			uomsMap: {},
			totalItems: 0,
		};
		const selector = {
			frm: {
				doctype: "Sales Order",
				doc: {
					doctype: "Sales Order",
					company: "Company A",
					set_warehouse: "Stores - A",
				},
			},
			settings: { low_stock_threshold: 10 },
			metaService: metaMock,
		};
		const container = {};
		const dialog = { dialog: { $wrapper: { find: () => container } } };
		const grid = {
			selector,
			dialog,
			state,
			_showLoading() {},
			_renderItems(...args) {
				renderCalls.push(args);
			},
			_showError() {},
			_currentPageSlice() {
				return [];
			},
			_fallbackUom() {
				return "Unit";
			},
			_getConversionFactor() {
				return 1;
			},
		};
		return new ItemsGridDataLoader(grid);
	}

	it("searchItems sends company to get_items_by_search", async () => {
		const loader = makeLoader();

		await loader.searchItems("lamp", 1);

		const call = calls.find((c) => c.method === "itemflow.api.get_items_by_search");
		expect(call).toBeTruthy();
		expect(call.args.company).toBe("Company A");
		expect(call.args.warehouse).toBe("Stores - A");
	});

	it("loadItemsByGroups sends company to get_items_by_group", async () => {
		const loader = makeLoader();

		await loader.loadItemsByGroups(["Products"], 1);

		const call = calls.find((c) => c.method === "itemflow.api.get_items_by_group");
		expect(call).toBeTruthy();
		expect(call.args.company).toBe("Company A");
	});

	it("loads UOMs + stock + price in a single call and passes them to the renderer", async () => {
		const loader = makeLoader();

		await loader.searchItems("lamp", 1);

		// A single enrichment call (not three separate endpoints).
		expect(metaMock.getItemsMeta).toHaveBeenCalledTimes(1);
		expect(metaMock.getItemsMeta).toHaveBeenCalledWith(["ITEM-1"]);

		// The renderer receives the pre-loaded maps.
		const lastRender = renderCalls[renderCalls.length - 1];
		expect(lastRender[2]).toEqual({ "ITEM-1": 5 });
		expect(lastRender[3]).toEqual({ "ITEM-1": 9 });
		expect(loader.state.uomsMap["ITEM-1"].stock_uom).toBe("Unit");
	});
});
