import { describe, expect, it } from "vitest";

import { ItemsGridState } from "../state.js";

describe("ItemsGridState", () => {
	it("has the expected defaults", () => {
		const state = new ItemsGridState();
		expect(state.page).toBe(1);
		expect(state.perPage).toBe(20);
		expect(state.totalItems).toBe(0);
		expect(state.mode).toBeNull();
		expect(state.groups).toBeNull();
		expect(state.search).toBeNull();
		expect(state.filters).toEqual({});
		expect(state.label).toBeNull();
		expect(state.inStockOnly).toBe(false);
		expect(state.restockOnly).toBe(false);
		expect(state.rendering).toBe(false);
		expect(state.docItemsAll).toEqual([]);
		expect(state.docItemsFiltered).toEqual([]);
		expect(state.docRowsMap).toEqual({});
		expect(state.uomsMap).toEqual({});
	});

	it("gives each instance independent state", () => {
		const a = new ItemsGridState();
		const b = new ItemsGridState();
		a.filters.brand = "TestBrand";
		expect(b.filters.brand).toBeUndefined();
	});
});
