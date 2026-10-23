import { describe, expect, it } from "vitest";

import { FILTER_FIELDS, ItemSelectorConfig } from "../config.js";

describe("ItemSelectorConfig", () => {
	it("exposes the native filterable fields", () => {
		expect(FILTER_FIELDS).toEqual(["brand", "stock_uom"]);
	});

	it("uses defaults when settings are not loaded", () => {
		const config = new ItemSelectorConfig();
		expect(config.isDoctypeEnabled("Sales Order")).toBe(true);
		expect(config.isDoctypeEnabled("Purchase Invoice")).toBe(false);
		expect(config.isDoctypeEnabled("Purchase Receipt")).toBe(false);
		expect(config.isDoctypeEnabled("Stock Entry")).toBe(true);
	});

	it("allows unknown doctypes by default", () => {
		const config = new ItemSelectorConfig();
		expect(config.isDoctypeEnabled("Some Custom Doctype")).toBe(true);
	});

	it("respects loaded settings", () => {
		const config = new ItemSelectorConfig();
		config.settings = { ...config.defaults, enable_purchase_invoice: 1 };
		expect(config.isDoctypeEnabled("Purchase Invoice")).toBe(true);
	});

	it("maps Stock Entry to its enable flag", () => {
		const config = new ItemSelectorConfig();
		config.settings = { ...config.defaults, enable_stock_entry: 0 };
		expect(config.isDoctypeEnabled("Stock Entry")).toBe(false);
	});

	it("maps filters through show_filter_ keys", () => {
		const config = new ItemSelectorConfig();
		config.settings = {
			...config.defaults,
			show_filter_brand: 1,
			show_filter_stock_uom: 0,
		};
		expect(config.isFilterEnabled("brand")).toBe(true);
		expect(config.isFilterEnabled("stock_uom")).toBe(false);
	});

	it("defaults allow_negative_stock to 0", () => {
		const config = new ItemSelectorConfig();
		expect(config.get("allow_negative_stock")).toBe(0);
	});

	it("enables the data-driven core filters by default", () => {
		const config = new ItemSelectorConfig();
		expect(config.isFilterEnabled("brand")).toBe(true);
		expect(config.isFilterEnabled("stock_uom")).toBe(true);
	});

	it("builds extra filter definitions from settings", () => {
		const config = new ItemSelectorConfig();
		config.settings = {
			...config.defaults,
			filters: [
				{
					fieldname: "custom_code",
					label: "Custom Code",
					order: 30,
					visible: 1,
					show_as_column: 1,
				},
			],
		};
		config.filterDefinitions = null;

		expect(config.getFilterDefinitions().map((d) => d.fieldname)).toContain(
			"custom_code"
		);
		expect(config.getColumnFields().map((d) => d.fieldname)).toEqual(["custom_code"]);
		expect(config.isFilterEnabled("custom_code")).toBe(true);
	});

	it("does not expose hidden or non-column extra fields", () => {
		const config = new ItemSelectorConfig();
		config.settings = {
			...config.defaults,
			filters: [
				{
					fieldname: "custom_code",
					label: "Custom Code",
					order: 30,
					visible: 0,
					show_as_column: 1,
				},
				{
					fieldname: "custom_size",
					label: "Size",
					order: 40,
					visible: 1,
					show_as_column: 0,
				},
			],
		};
		config.filterDefinitions = null;

		expect(config.getColumnFields()).toEqual([]);
		expect(config.isFilterEnabled("custom_code")).toBe(false);
		expect(config.isFilterEnabled("custom_size")).toBe(true);
	});
});
