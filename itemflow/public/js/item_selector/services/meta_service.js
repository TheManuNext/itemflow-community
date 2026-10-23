import { LRUCache } from "../utils/lru_cache.js";
import { effectiveWarehouse } from "../ui/items_grid/domain.js";

/**
 * Stock + price + UOMs for a page of items in a single server call
 * (`itemflow.api.get_items_meta`). Replaces the separate calls the catalogue
 * made per page (stock, prices and UOMs), avoiding the backend repeating the
 * permission filter and the Item query.
 *
 * Keeps a client cache per item+context (warehouse/company/price list) to avoid
 * re-querying on re-render.
 */
export class ItemSelectorMetaService {
	constructor(frm) {
		this.frm = frm;
		this.cache = new LRUCache(200);
		this.cache_ttl = 60000; // 60 seconds
	}

	_company() {
		return (this.frm.doc && this.frm.doc.company) || "";
	}

	_warehouse() {
		return effectiveWarehouse(this.frm.doc, this.frm.doctype);
	}

	_priceList() {
		return this.frm.doc.selling_price_list || this.frm.doc.buying_price_list || null;
	}

	_isBuying() {
		return [
			"Purchase Order",
			"Purchase Invoice",
			"Purchase Receipt",
			"Supplier Quotation",
		].includes(this.frm.doctype);
	}

	_contextKey() {
		return `${this._warehouse()}:${this._company()}:${this._priceList()}:${
			this._isBuying() ? 1 : 0
		}`;
	}

	async getItemsMeta(item_codes) {
		if (!item_codes || item_codes.length === 0) return {};

		const now = Date.now();
		const context = this._contextKey();
		const result = {};
		const missing = [];

		item_codes.forEach((code) => {
			const cached = this.cache.get(`${context}:${code}`);
			if (cached && now - cached.timestamp < this.cache_ttl) {
				result[code] = cached.meta;
			} else {
				missing.push(code);
			}
		});

		if (missing.length === 0) {
			return result;
		}

		try {
			const meta =
				(await frappe.xcall("itemflow.api.get_items_meta", {
					item_codes: missing,
					price_list: this._priceList(),
					buying: this._isBuying() ? 1 : 0,
					warehouse: this._warehouse(),
					company: this._company(),
				})) || {};

			missing.forEach((code) => {
				const entry = meta[code] || {};
				this.cache.set(`${context}:${code}`, { meta: entry, timestamp: now });
				result[code] = entry;
			});
		} catch (e) {
			missing.forEach((code) => {
				if (!(code in result)) result[code] = {};
			});
		}

		return result;
	}

	clearCache() {
		this.cache.clear();
	}
}
