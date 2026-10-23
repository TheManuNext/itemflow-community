import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../item_pipeline.js", () => ({
	resolveItemNative: vi.fn(async (frm, row, uom, conversionFactor) => {
		row.uom = uom;
		row.conversion_factor = conversionFactor;
		row.rate = row.price_list_rate || 10;
		return { needs_batch_serial: false };
	}),
}));

import { resolveItemNative } from "../item_pipeline.js";
import { ItemSelectorBulkAdder } from "../bulk_adder.js";

globalThis.frappe = {
	boot: { sysdefaults: { stock_uom: "Nos" } },
	user_defaults: {},
	meta: { get_docfield: () => null },
};
globalThis.flt = (value) => parseFloat(value) || 0;
globalThis.cint = (value) => parseInt(value, 10) || 0;

function makeFrm(docOverrides = {}) {
	const frm = {
		doctype: "Sales Order",
		doc: {
			doctype: "Sales Order",
			name: "SO-0001",
			selling_price_list: "Selling 2026",
			items: [],
			...docOverrides,
		},
		add_child(fieldname) {
			const row = {
				doctype: "Sales Order Item",
				parentfield: fieldname,
				name: `row-${this.doc.items.length + 1}`,
			};
			this.doc.items.push(row);
			return row;
		},
		refresh_field() {},
	};
	return frm;
}

function makeSelector(frm, selectedItems) {
	return {
		frm,
		selected_items: selectedItems,
		config: { debug() {} },
	};
}

describe("ItemSelectorBulkAdder", () => {
	let frm;

	beforeEach(() => {
		frm = makeFrm();
		resolveItemNative.mockClear();
	});

	it("resolves every added row through the native item pipeline", async () => {
		const selector = makeSelector(frm, {
			"ITEM-001": { qty: 2, uom: "Box", conversion_factor: 12 },
		});

		const result = await new ItemSelectorBulkAdder(selector).execute(["ITEM-001"]);

		expect(result.added).toBe(1);
		expect(result.failed).toBe(0);
		expect(resolveItemNative).toHaveBeenCalledTimes(1);

		const [calledFrm, row, uom, conversionFactor] = resolveItemNative.mock.calls[0];
		expect(calledFrm).toBe(frm);
		expect(row.item_code).toBe("ITEM-001");
		expect(uom).toBe("Box");
		expect(conversionFactor).toBe(12);
		expect(row.qty).toBe(2);
	});

	it("collects rows that need the serial/batch selector", async () => {
		resolveItemNative.mockImplementationOnce(async (frm, row) => {
			return { needs_batch_serial: true };
		});
		const selector = makeSelector(frm, {
			"ITEM-001": { qty: 2, uom: "Nos", conversion_factor: 1 },
		});

		const result = await new ItemSelectorBulkAdder(selector).execute(["ITEM-001"]);

		expect(result.batch_serial_rows).toHaveLength(1);
		expect(result.batch_serial_rows[0].item_code).toBe("ITEM-001");
	});

	it("merges into an existing line with the same item_code and UOM", async () => {
		frm = makeFrm({
			items: [
				{
					doctype: "Sales Order Item",
					parentfield: "items",
					name: "row-existing",
					item_code: "ITEM-001",
					uom: "Nos",
					qty: 3,
				},
			],
		});
		const selector = makeSelector(frm, {
			"ITEM-001": { qty: 2, uom: "Nos", conversion_factor: 1, _action: "merge" },
		});

		const result = await new ItemSelectorBulkAdder(selector).execute(["ITEM-001"]);

		expect(result.added).toBe(1);
		expect(frm.doc.items).toHaveLength(1);
		expect(frm.doc.items[0].qty).toBe(5);
		expect(resolveItemNative).toHaveBeenCalledTimes(1);
	});

	it("adds a new line when merging with a different UOM", async () => {
		frm = makeFrm({
			items: [
				{
					doctype: "Sales Order Item",
					parentfield: "items",
					name: "row-existing",
					item_code: "ITEM-001",
					uom: "Nos",
					qty: 3,
				},
			],
		});
		const selector = makeSelector(frm, {
			"ITEM-001": { qty: 2, uom: "Box", conversion_factor: 12, _action: "merge" },
		});

		const result = await new ItemSelectorBulkAdder(selector).execute(["ITEM-001"]);

		expect(result.added).toBe(1);
		expect(frm.doc.items).toHaveLength(2);
		expect(frm.doc.items[1].uom).toBe("Box");
	});

	it("inherits the Sales Order delivery date onto new rows", async () => {
		frm = makeFrm({ delivery_date: "2026-11-15" });
		const selector = makeSelector(frm, {
			"ITEM-001": { qty: 2, uom: "Nos", conversion_factor: 1 },
		});

		await new ItemSelectorBulkAdder(selector).execute(["ITEM-001"]);

		expect(frm.doc.items[0].delivery_date).toBe("2026-11-15");
	});

	it("falls back to the first row's delivery date when the header has none", async () => {
		frm = makeFrm({
			items: [
				{
					doctype: "Sales Order Item",
					parentfield: "items",
					name: "row-existing",
					item_code: "ITEM-000",
					uom: "Nos",
					qty: 1,
					delivery_date: "2026-12-01",
				},
			],
		});
		const selector = makeSelector(frm, {
			"ITEM-001": { qty: 2, uom: "Nos", conversion_factor: 1 },
		});

		await new ItemSelectorBulkAdder(selector).execute(["ITEM-001"]);

		expect(frm.doc.items[1].delivery_date).toBe("2026-12-01");
	});

	it("records an error for invalid quantities without aborting the batch", async () => {
		const selector = makeSelector(frm, {
			"ITEM-001": { qty: 1, uom: "Nos", conversion_factor: 1 },
			"ITEM-002": { qty: 0, uom: "Nos", conversion_factor: 1 },
		});

		const result = await new ItemSelectorBulkAdder(selector).execute(["ITEM-001", "ITEM-002"]);

		expect(result.added).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.failed_items[0].code).toBe("ITEM-002");
	});
});
