import { LRUCache } from '../utils/lru_cache.js';

export class ItemSelectorPriceService {
    constructor(frm) {
        this.frm = frm;
        this.cache = new LRUCache(100); // Client-side cache limited to 100 entries
        this.cache_ttl = 600000; // 600 seconds / 10 min (prices change infrequently)
    }

    getPriceList() {
        return this.frm.doc.selling_price_list || this.frm.doc.buying_price_list || null;
    }

    isBuying() {
        return ['Purchase Order', 'Purchase Invoice', 'Purchase Receipt', 'Supplier Quotation'].includes(this.frm.doctype);
    }

    async getPrices(item_codes, price_list) {
        if (!item_codes || item_codes.length === 0 || !price_list) {
            return {};
        }

        // Check the client-side cache
        const now = Date.now();
        const cache_key = `${price_list}`;
        const cached_result = {};
        const missing_codes = [];

        item_codes.forEach(code => {
            const key = `${cache_key}:${code}`;
            const cached = this.cache.get(key);
            if (cached && (now - cached.timestamp) < this.cache_ttl) {
                cached_result[code] = cached.price;
            } else {
                missing_codes.push(code);
            }
        });

        // If everything is cached, return immediately
        if (missing_codes.length === 0) {
            return cached_result;
        }

        try {
            // frappe.xcall returns r.message directly (modern Frappe pattern)
            const priceMap = await frappe.xcall(
                'itemflow.api.get_item_prices',
                { item_codes: missing_codes, price_list: price_list, buying: this.isBuying() ? 1 : 0 }
            ) || {};

            // Update the client-side cache
            Object.entries(priceMap).forEach(([code, price]) => {
                const key = `${cache_key}:${code}`;
                this.cache.set(key, { price, timestamp: now });
                cached_result[code] = price;
            });

            return cached_result;
        } catch (e) {
            return cached_result;
        }
    }

    async getPriceForItem(item_code, price_list) {
        const prices = await this.getPrices([item_code], price_list);
        return prices[item_code] || 0;
    }

    async getPriceForUom(item_code, uom, price_list) {
        if (!item_code || !uom || !price_list) {
            return null;
        }

        const now = Date.now();
        const cache_key = `${price_list}:${item_code}:${uom}`;
        const cached = this.cache.get(cache_key);
        if (cached && (now - cached.timestamp) < this.cache_ttl) {
            return cached.price;
        }

        try {
            const result = await frappe.xcall(
                'itemflow.api.get_item_price',
                {
                    item_code: item_code,
                    price_list: price_list,
                    uom: uom,
                    buying: this.isBuying() ? 1 : 0
                }
            ) || { price: null };

            this.cache.set(cache_key, { price: result.price, timestamp: now });
            return result.price;
        } catch (e) {
            return null;
        }
    }

    // Clear the client-side cache
    clearCache() {
        this.cache.clear();
    }
}
