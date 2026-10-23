import { describe, expect, it } from "vitest";

import { currentPageSlice, totalPages } from "../pagination.js";

describe("pagination helpers", () => {
	it("computes total pages", () => {
		expect(totalPages(0, 20)).toBe(0);
		expect(totalPages(20, 20)).toBe(1);
		expect(totalPages(21, 20)).toBe(2);
		expect(totalPages(100, 20)).toBe(5);
	});

	it("returns 0 for invalid page size", () => {
		expect(totalPages(50, 0)).toBe(0);
		expect(totalPages(50, -1)).toBe(0);
	});

	it("slices the current page", () => {
		const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		expect(currentPageSlice(items, 1, 3)).toEqual([0, 1, 2]);
		expect(currentPageSlice(items, 2, 3)).toEqual([3, 4, 5]);
		expect(currentPageSlice(items, 4, 3)).toEqual([9]);
	});

	it("handles empty input and missing page", () => {
		expect(currentPageSlice(null, 1, 20)).toEqual([]);
		expect(currentPageSlice([1, 2, 3], undefined, 2)).toEqual([1, 2]);
	});
});
