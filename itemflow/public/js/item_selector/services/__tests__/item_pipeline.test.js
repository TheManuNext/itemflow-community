import { beforeEach, describe, expect, it } from "vitest";

import {
	applyConversionFactor,
	applyItemRateAndDiscounts,
	requiresBatchSerial,
	setRateBasedOnPriceList,
} from "../item_pipeline.js";

globalThis.flt = (value, decimals) => {
	if (value == null || value === "") return 0;
	const num = typeof value === "number" ? value : parseFloat(value);
	const safe = isNaN(num) ? 0 : num;
	if (decimals == null) return safe;
	const multiplier = Math.pow(10, decimals);
	return Math.round(safe * multiplier) / multiplier;
};
globalThis.precision = () => 2;
globalThis.cint = (value) => parseInt(value, 10) || 0;
globalThis.frappe = { meta: { get_docfield: () => ({}) } };

function makeFrm(overrides = {}) {
	return {
		doctype: "Sales Order",
		doc: {
			doctype: "Sales Order",
			conversion_rate: 1,
			...overrides,
		},
	};
}

describe("applyItemRateAndDiscounts", () => {
	it("does not produce NaN when no pricing rule set a margin", () => {
		const frm = makeFrm();
		const row = { doctype: "Sales Order Item", price_list_rate: 0 };

		applyItemRateAndDiscounts(frm, row);

		expect(row.rate).toBe(0);
		expect(Number.isNaN(row.rate)).toBe(false);
		expect(row.rate_with_margin).toBe(0);
	});

	it("uses the price list rate when there is no margin", () => {
		const frm = makeFrm();
		const row = { doctype: "Sales Order Item", price_list_rate: 100 };

		applyItemRateAndDiscounts(frm, row);

		expect(row.rate).toBe(100);
	});

	it("adds a percentage margin", () => {
		const frm = makeFrm();
		const row = {
			doctype: "Sales Order Item",
			price_list_rate: 100,
			margin_type: "Percentage",
			margin_rate_or_amount: 10,
		};

		applyItemRateAndDiscounts(frm, row);

		expect(row.rate_with_margin).toBe(110);
		expect(row.rate).toBe(110);
	});

	it("subtracts a discount percentage", () => {
		const frm = makeFrm();
		const row = {
			doctype: "Sales Order Item",
			price_list_rate: 100,
			discount_percentage: 10,
		};

		applyItemRateAndDiscounts(frm, row);

		expect(row.discount_amount).toBe(10);
		expect(row.rate).toBe(90);
	});

	it("honours the blanket order rate for Sales Order rows", () => {
		const frm = makeFrm();
		const row = {
			doctype: "Sales Order Item",
			parenttype: "Sales Order",
			price_list_rate: 100,
			blanket_order_rate: 80,
		};

		applyItemRateAndDiscounts(frm, row);

		expect(row.rate).toBe(80);
	});

	it("computes base_rate_with_margin using the document conversion rate", () => {
		const frm = makeFrm({ conversion_rate: 2 });
		const row = { doctype: "Sales Order Item", price_list_rate: 100 };

		applyItemRateAndDiscounts(frm, row);

		expect(row.base_rate_with_margin).toBe(200);
	});
});

describe("setRateBasedOnPriceList", () => {
	it("recomputes the rate when a discount percentage is present", () => {
		const frm = makeFrm();
		const row = { doctype: "Sales Order Item", price_list_rate: 100, discount_percentage: 25, rate: 100 };

		setRateBasedOnPriceList(frm, row);

		expect(row.rate).toBe(75);
	});

	it("leaves the rate untouched without a discount", () => {
		const frm = makeFrm();
		const row = { doctype: "Sales Order Item", price_list_rate: 100, rate: 42 };

		setRateBasedOnPriceList(frm, row);

		expect(row.rate).toBe(42);
	});
});

describe("applyConversionFactor", () => {
	let frm;

	beforeEach(() => {
		frm = makeFrm();
	});

	it("sets stock qty, total weight and stock-UOM rate", () => {
		const row = {
			doctype: "Sales Order Item",
			qty: 2,
			conversion_factor: 12,
			weight_per_unit: 0.5,
			rate: 120,
		};

		applyConversionFactor(frm, row);

		expect(row.stock_qty).toBe(24);
		expect(row.total_weight).toBe(12);
		expect(row.stock_uom_rate).toBe(10);
	});

	it("skips total weight for Material Request", () => {
		frm = makeFrm({ doctype: "Material Request" });
		const row = { doctype: "Material Request Item", qty: 2, conversion_factor: 1, weight_per_unit: 0.5, rate: 10 };

		applyConversionFactor(frm, row);

		expect(row.stock_qty).toBe(2);
		expect(row.total_weight).toBeUndefined();
	});
});

describe("requiresBatchSerial", () => {
	it("requires the selector for stock-updating invoices with batch/serial items", () => {
		const frm = makeFrm({ doctype: "Sales Invoice", update_stock: 1 });
		expect(requiresBatchSerial(frm, { item_code: "X", has_batch_no: 1 })).toBe(true);
	});

	it("does not require it for non-stock-updating sales orders", () => {
		const frm = makeFrm({ doctype: "Sales Order" });
		expect(requiresBatchSerial(frm, { item_code: "X", has_batch_no: 1 })).toBe(false);
	});

	it("skips when the user chose inline serial/batch fields", () => {
		const frm = makeFrm({ doctype: "Purchase Receipt" });
		expect(
			requiresBatchSerial(frm, {
				item_code: "X",
				has_serial_no: 1,
				use_serial_batch_fields: 1,
			})
		).toBe(false);
	});
});
