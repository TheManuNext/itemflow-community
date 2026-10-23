import { LRUCache } from '../utils/lru_cache.js';
import { effectiveWarehouse } from '../ui/items_grid/domain.js';

export class ItemSelectorStockService {
    constructor(frm) {
        this.frm = frm;
        this.cache = new LRUCache(100); // Client-side cache limited to 100 entries
        this.cache_ttl = 60000; // 60 seconds
    }

    // Build the cache key including warehouse and company to avoid stale data
    // when the user changes set_warehouse or the document company.
    _cacheKey(item_code) {
        const warehouse = this._effectiveWarehouse();
        return `${item_code}:${warehouse}:${this._company()}`;
    }

    _effectiveWarehouse() {
        return effectiveWarehouse(this.frm.doc, this.frm.doctype);
    }

    _company() {
        return (this.frm.doc && this.frm.doc.company) || "";
    }

    async getStockLevels(item_codes) {
        if (!item_codes || item_codes.length === 0) return {};

        // Check the client-side cache first
        const now = Date.now();
        const cached_result = {};
        const missing_codes = [];

        item_codes.forEach(code => {
            const key = this._cacheKey(code);
            const cached = this.cache.get(key);
            if (cached && (now - cached.timestamp) < this.cache_ttl) {
                cached_result[code] = cached.stock;
            } else {
                missing_codes.push(code);
            }
        });

        // If everything is cached, return immediately
        if (missing_codes.length === 0) {
            return cached_result;
        }

        const warehouse = this._effectiveWarehouse();

        try {
            // frappe.xcall returns r.message directly (modern Frappe pattern)
            const stock_map = await frappe.xcall(
                'itemflow.api.get_stock_levels',
                { item_codes: missing_codes, warehouse: warehouse, company: this._company() }
            ) || {};

            // Update the client-side cache
            Object.entries(stock_map).forEach(([code, qty]) => {
                const key = this._cacheKey(code);
                this.cache.set(key, { stock: qty, timestamp: now });
                cached_result[code] = qty;
            });

            return cached_result;
        } catch (e) {
            frappe.show_alert({
                message: __('Error loading stock levels'),
                indicator: 'red'
            }, 5);
            return cached_result;
        }
    }

    async getStockForItem(item_code, warehouse = null) {
        const warehouse_filter = warehouse || this._effectiveWarehouse();

        // Check the cache — the key includes the effective warehouse and company
        // to avoid returning stock from a different warehouse/company.
        const key = `${item_code}:${warehouse_filter || ''}:${this._company()}`;
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cache_ttl) {
            return cached.stock;
        }

        try {
            const stock_map = await frappe.xcall(
                'itemflow.api.get_stock_levels',
                { item_codes: [item_code], warehouse: warehouse_filter, company: this._company() }
            ) || {};

            const stock = stock_map[item_code] ?? 0;

            // Update the cache
            this.cache.set(key, { stock, timestamp: Date.now() });

            return stock;
        } catch (e) {
            return null;
        }
    }

    // Limpiar cache client-side
    clearCache() {
        this.cache.clear();
    }
}
