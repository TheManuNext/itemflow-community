import { describe, expect, it } from "vitest";

import {
	chunk,
	currency,
	effectiveWarehouse,
	fallbackUom,
	getConversionFactor,
	getDefaultUom,
	getUomInfo,
	isNoPriceDoctype,
	isRestockDoctype,
	isStockItem,
} from "../domain.js";

describe("domain helpers", () => {
	it("detects restock doctypes", () => {
		expect(isRestockDoctype("Purchase Order")).toBe(true);
		expect(isRestockDoctype("Material Request")).toBe(true);
		expect(isRestockDoctype("Sales Order")).toBe(false);
		expect(isRestockDoctype(undefined)).toBe(false);
	});

	it("detects no-price doctypes", () => {
		expect(isNoPriceDoctype("Material Request")).toBe(true);
		expect(isNoPriceDoctype("Stock Entry")).toBe(true);
		expect(isNoPriceDoctype("Sales Order")).toBe(false);
	});

	it("resolves the effective warehouse per doctype", () => {
		expect(effectiveWarehouse({ to_warehouse: "Stores" }, "Stock Entry")).toBe("Stores");
		expect(
			effectiveWarehouse({ to_warehouse: "", from_warehouse: "Source" }, "Stock Entry")
		).toBe("Source");
		expect(effectiveWarehouse({ set_warehouse: "Stores" }, "Purchase Order")).toBe("Stores");
		expect(effectiveWarehouse(null, "Sales Order")).toBe("");
	});

	it("detects non-stock items", () => {
		expect(isStockItem({ is_stock_item: 1 })).toBe(true);
		expect(isStockItem({})).toBe(true);
		expect(isStockItem({ is_stock_item: 0 })).toBe(false);
		expect(isStockItem({ is_stock_item: false })).toBe(false);
	});

	it("resolves the fallback UOM", () => {
		expect(fallbackUom({ default_uom: "Box" }, { stock_uom: "Nos" })).toBe("Box");
		expect(fallbackUom({}, { stock_uom: "Nos" })).toBe("Nos");
		expect(fallbackUom(null, null)).toBe("Unit");
	});

	it("resolves the currency", () => {
		expect(currency({ currency: "USD" }, { currency: "EUR" })).toBe("USD");
		expect(currency({ company_currency: "THB" }, { currency: "EUR" })).toBe("THB");
		expect(currency(null, { currency: "EUR" })).toBe("EUR");
		expect(currency(null, null)).toBeUndefined();
	});

	it("returns UOM info or a default", () => {
		const map = { A: { stock_uom: "Box", uoms: [{ uom: "Box", conversion_factor: 10 }] } };
		expect(getUomInfo(map, "A", "Unit")).toBe(map.A);
		expect(getUomInfo(map, "B", "Unit")).toEqual({
			stock_uom: "Unit",
			uoms: [{ uom: "Unit", conversion_factor: 1 }],
		});
	});

	it("resolves conversion factors", () => {
		const map = { A: { uoms: [{ uom: "Box", conversion_factor: 10 }] } };
		expect(getConversionFactor(map, "A", "Box", "Unit")).toBe(10);
		expect(getConversionFactor(map, "A", "Unknown", "Unit")).toBe(1);
	});

	it("resolves the default UOM", () => {
		expect(getDefaultUom({ uom: "Box", stock_uom: "Unit" }, "Unit")).toBe("Box");
		expect(getDefaultUom({ stock_uom: "Unit" }, "Unit")).toBe("Unit");
		expect(getDefaultUom({}, "Nos")).toBe("Nos");
	});

	describe("chunk", () => {
		it("splits a list into consecutive chunks", () => {
			expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		});

		it("returns a single chunk when the list is smaller than the size", () => {
			expect(chunk([1, 2], 15)).toEqual([[1, 2]]);
		});

		it("returns an empty list for an empty input", () => {
			expect(chunk([], 15)).toEqual([]);
		});

		it("clamps invalid sizes to at least 1", () => {
			expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
			expect(chunk([1, 2, 3], undefined)).toEqual([[1], [2], [3]]);
			expect(chunk([1, 2, 3], NaN)).toEqual([[1], [2], [3]]);
		});
	});
});
