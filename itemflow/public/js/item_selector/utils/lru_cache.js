/**
 * LRU cache with a size limit.
 * Uses the native Map to keep access order (ES6+).
 */
export class LRUCache {
	constructor(maxSize = 100) {
		this.maxSize = maxSize;
		this.cache = new Map();
	}

	get(key) {
		if (!this.cache.has(key)) {
			return undefined;
		}
		const value = this.cache.get(key);
		// Move to the end (most recent)
		this.cache.delete(key);
		this.cache.set(key, value);
		return value;
	}

	set(key, value) {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.maxSize) {
			// Remove the first entry (oldest)
			const firstKey = this.cache.keys().next().value;
			this.cache.delete(firstKey);
		}
		this.cache.set(key, value);
	}

	clear() {
		this.cache.clear();
	}

	get size() {
		return this.cache.size;
	}
}
