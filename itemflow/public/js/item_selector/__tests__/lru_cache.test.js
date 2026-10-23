import { describe, expect, it } from "vitest";

import { LRUCache } from "../utils/lru_cache.js";

describe("LRUCache", () => {
	it("stores and retrieves values", () => {
		const cache = new LRUCache(3);
		cache.set("a", 1);
		expect(cache.get("a")).toBe(1);
		expect(cache.size).toBe(1);
	});

	it("returns undefined for missing keys", () => {
		const cache = new LRUCache(3);
		expect(cache.get("missing")).toBeUndefined();
	});

	it("evicts the least recently used entry beyond maxSize", () => {
		const cache = new LRUCache(2);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toBe(2);
		expect(cache.get("c")).toBe(3);
		expect(cache.size).toBe(2);
	});

	it("refreshes recency on get", () => {
		const cache = new LRUCache(2);
		cache.set("a", 1);
		cache.set("b", 2);
		// 'a' becomes the most recent -> 'b' should be the evicted one
		expect(cache.get("a")).toBe(1);
		cache.set("c", 3);
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toBe(1);
		expect(cache.get("c")).toBe(3);
	});

	it("overwrites an existing key without growing", () => {
		const cache = new LRUCache(2);
		cache.set("a", 1);
		cache.set("a", 2);
		expect(cache.get("a")).toBe(2);
		expect(cache.size).toBe(1);
	});

	it("clear removes all entries", () => {
		const cache = new LRUCache(3);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.get("a")).toBeUndefined();
	});
});
