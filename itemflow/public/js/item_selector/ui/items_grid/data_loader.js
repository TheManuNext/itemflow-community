/**
 * Data loading for the items grid (groups, search and document edit mode).
 *
 * Faithful extraction of the loading methods; reads selector/dialog/state from
 * the grid facade and delegates rendering/helpers back to it.
 */
import { effectiveWarehouse } from "./domain.js";

export class ItemsGridDataLoader {
	constructor(grid) {
		this.grid = grid;
	}

	get selector() {
		return this.grid.selector;
	}

	get dialog() {
		return this.grid.dialog;
	}

	get state() {
		return this.grid.state;
	}

	_renderItems(...args) {
		return this.grid._renderItems(...args);
	}

	_showLoading(...args) {
		return this.grid._showLoading(...args);
	}

	_showError(...args) {
		return this.grid._showError(...args);
	}

	_fallbackUom() {
		return this.grid._fallbackUom();
	}

	_currentPageSlice() {
		return this.grid._currentPageSlice();
	}

	_getConversionFactor(item_code, uom) {
		return this.grid._getConversionFactor(item_code, uom);
	}

	async loadDocumentItems() {
		const container = this.dialog.dialog.$wrapper.find("#items-container");
		this._showLoading(container);

		const frm = this.selector.frm;
		const rawItems = frm.doc.items || [];

		// Deduplicate by item_code: sum qty, keep extra row names to remove them on save
		this.state.docRowsMap = {};
		rawItems.forEach((row) => {
			const code = row.item_code;
			if (!code) return;
			if (!this.state.docRowsMap[code]) {
				this.state.docRowsMap[code] = {
					first_row: row,
					extra_names: [],
					_merged_qty: row.qty || 0,
				};
			} else {
				this.state.docRowsMap[code].extra_names.push(row.name);
				this.state.docRowsMap[code]._merged_qty += row.qty || 0;
			}
		});

		// Build the display array (format compatible with _renderItems)
		this.state.docItemsAll = Object.values(this.state.docRowsMap).map((entry) => ({
			item_code: entry.first_row.item_code,
			item_name: entry.first_row.item_name,
			stock_uom: entry.first_row.stock_uom || this._fallbackUom(),
			uom: entry.first_row.uom || entry.first_row.stock_uom || this._fallbackUom(),
			conversion_factor: entry.first_row.conversion_factor || 1,
			image: null, // frm.doc.items does not store the image URL
			brand: null,
			...Object.fromEntries(
				this.selector.config.getColumnFields().map((field) => [
					field.fieldname,
					entry.first_row[field.fieldname] ?? "",
				])
			),
			_merged_qty: entry._merged_qty,
			discount_percentage: entry.first_row.discount_percentage || 0,
			discount_amount: entry.first_row.discount_amount || 0,
			price_list_rate: entry.first_row.price_list_rate || 0,
			amount: entry._merged_qty * (entry.first_row.rate || 0),
		}));

		// Document UOMs + stock in a single call (P1).
		const { stockMap: docStockMap } = await this._loadMetaForItems(this.state.docItemsAll);

		// Ensure each document line's UOM is available in the selector, even if it
		// is not in the Item's conversion table.
		this.state.docItemsAll.forEach((item) => {
			const info = this.state.uomsMap[item.item_code];
			if (!info || !item.uom) return;

			const hasLineUom = (info.uoms || []).some((u) => u.uom === item.uom);
			if (!hasLineUom) {
				info.uoms.push({
					uom: item.uom,
					conversion_factor: item.conversion_factor || 1,
				});
			}
		});

		// Pre-populate selected_items with the document's current quantities
		this.selector.selected_items = {};
		this.state.docItemsAll.forEach((item) => {
			const uomInfo = this.state.uomsMap[item.item_code] || {
				stock_uom: item.stock_uom,
				uoms: [{ uom: item.stock_uom, conversion_factor: 1 }],
			};
			const selectedUom = item.uom || item.stock_uom;
			const conversionFactor = this._getConversionFactor(item.item_code, selectedUom);

			this.selector.selected_items[item.item_code] = {
				qty: item._merged_qty,
				name: item.item_name,
				stock: 0,
				price: this.state.docRowsMap[item.item_code].first_row.rate || 0,
				uom: selectedUom,
				stock_uom: item.stock_uom,
				conversion_factor: conversionFactor,
				uoms: uomInfo.uoms || [],
			};
		});

		// Store original codes to detect items set to qty=0 when saving
		this.selector._edit_original_codes = new Set(this.state.docItemsAll.map((i) => i.item_code));

		// Snapshot of original quantities to detect real changes in the footer
		this.selector._edit_snapshot = {};
		this.state.docItemsAll.forEach((item) => {
			this.selector._edit_snapshot[item.item_code] = item._merged_qty;
		});

		// Stock already obtained together with the UOMs.
		const stockMap = docStockMap || {};
		Object.entries(stockMap).forEach(([code, qty]) => {
			if (this.selector.selected_items[code]) {
				this.selector.selected_items[code].stock = qty ?? 0;
			}
		});

		// Build rateMap from doc_rows_map (SO rate, without calling the price service)
		const rateMap = {};
		this.state.docItemsAll.forEach((item) => {
			rateMap[item.item_code] = this.state.docRowsMap[item.item_code].first_row.rate || 0;
		});

		this.state.mode = "doc";
		this.state.page = 1;
		this.state.docItemsFiltered = [...this.state.docItemsAll];
		this.state.totalItems = this.state.docItemsFiltered.length;

		await this._renderItems(container, this._currentPageSlice(), stockMap, rateMap);
		this.dialog.updateSelectedCount();
	}

	// Local filter for 'doc' mode (no server call)
	async filterDocumentItems(term, filters = null) {
		this.state.search = term || "";
		if (filters !== null) {
			this.state.filters = filters;
		}

		const lowerTerm = (term || "").toLowerCase();
		const filterEntries = Object.entries(this.state.filters).filter(
			([, value]) => (value || "").trim() !== ""
		);

		this.state.docItemsFiltered = this.state.docItemsAll.filter((item) => {
			const matchesTerm =
				!lowerTerm ||
				item.item_code.toLowerCase().includes(lowerTerm) ||
				item.item_name.toLowerCase().includes(lowerTerm);
			const matchesFilters = filterEntries.every(([field, value]) => {
				const lowerValue = (value || "").toLowerCase();
				return (item[field] || "").toLowerCase().startsWith(lowerValue);
			});
			return matchesTerm && matchesFilters;
		});
		this.state.page = 1;
		this.state.totalItems = this.state.docItemsFiltered.length;

		// Rebuild maps from selected_items (no server call)
		const cachedStockMap = {};
		const cachedRateMap = {};
		this.state.docItemsFiltered.forEach((item) => {
			const sel = this.selector.selected_items[item.item_code];
			if (sel) {
				cachedStockMap[item.item_code] = sel.stock || 0;
				cachedRateMap[item.item_code] = sel.price || 0;
			}
		});

		const container = this.dialog.dialog.$wrapper.find("#items-container");
		await this._renderItems(
			container,
			this._currentPageSlice(),
			cachedStockMap,
			cachedRateMap
		);
	}

	// Return the doc_items_filtered slice for the current page

	async loadItemsByGroups(itemGroups, page = 1, filters = null) {
		this.state.mode = "group";
		this.state.groups = itemGroups;
		this.state.page = page;
		if (filters !== null) {
			this.state.filters = filters;
		}

		const container = this.dialog.dialog.$wrapper.find("#items-container");
		this._showLoading(container);

		try {
			// frappe.xcall returns r.message directly (modern Frappe pattern)
			const data = (await frappe.xcall("itemflow.api.get_items_by_group", {
				item_groups: itemGroups,
				page: page,
				page_length: this.state.perPage,
				in_stock_only: this.state.inStockOnly ? 1 : 0,
				restock_only: this.state.restockOnly ? 1 : 0,
				low_stock_threshold: this.selector.settings?.low_stock_threshold || 10,
				warehouse:
					effectiveWarehouse(
						this.selector.frm.doc,
						this.selector.frm.doctype
					) || null,
				company: this.selector.frm.doc.company || null,
				filters: this.state.filters,
				doctype: this.selector.frm.doctype,
			})) || { items: [], total: 0 };
			// `total` may be null if COUNT exceeded the timeout (P3): in that
			// case we use a lower bound that still allows pagination.
			this.state.totalItems =
				data.total != null
					? data.total
					: (page - 1) * this.state.perPage +
					  data.items.length +
					  (data.items.length === this.state.perPage ? 1 : 0);
			const { stockMap, priceMap } = await this._loadMetaForItems(data.items);
			await this._renderItems(container, data.items, stockMap, priceMap);
		} catch (e) {
			this._showError(container, e);
		}
	}

	// A single call brings UOMs + stock + price for the page (P1). Besides
	// filling `state.uomsMap`, it returns the stock/price maps so they can be
	// passed to the renderer and avoid querying the server again.
	async _loadMetaForItems(items) {
		const codes = (items || []).map((i) => i.item_code).filter(Boolean);
		const stockMap = {};
		const priceMap = {};
		if (codes.length === 0) return { stockMap, priceMap };

		try {
			const meta = await this.selector.metaService.getItemsMeta(codes);
			codes.forEach((code) => {
				const entry = meta[code] || {};
				if (entry.uoms || entry.stock_uom) {
					this.state.uomsMap[code] = {
						stock_uom: entry.stock_uom,
						sales_uom: entry.sales_uom,
						purchase_uom: entry.purchase_uom,
						uoms: entry.uoms || [],
					};
				}
				stockMap[code] = entry.stock ?? 0;
				priceMap[code] = entry.price ?? 0;
			});
		} catch (_e) {
			// non-fatal: each item will use stock_uom by default and stock/price 0
		}

		return { stockMap, priceMap };
	}

	// Search items by text (server-side pagination)
	async searchItems(searchTerm, page = 1, filters = null) {
		this.state.mode = "search";
		this.state.search = searchTerm;
		if (filters !== null) {
			this.state.filters = filters;
		}
		this.state.page = page;

		const container = this.dialog.dialog.$wrapper.find("#items-container");
		this._showLoading(container);

		try {
			// frappe.xcall returns r.message directly (modern Frappe pattern)
			const data = (await frappe.xcall("itemflow.api.get_items_by_search", {
				search_term: searchTerm || "",
				page: page,
				page_length: this.state.perPage,
				in_stock_only: this.state.inStockOnly ? 1 : 0,
				restock_only: this.state.restockOnly ? 1 : 0,
				low_stock_threshold: this.selector.settings?.low_stock_threshold || 10,
				warehouse:
					effectiveWarehouse(
						this.selector.frm.doc,
						this.selector.frm.doctype
					) || null,
				company: this.selector.frm.doc.company || null,
				filters: this.state.filters,
				doctype: this.selector.frm.doctype,
			})) || { items: [], total: 0 };
			// `total` may be null if COUNT exceeded the timeout (P3): in that
			// case we use a lower bound that still allows pagination.
			this.state.totalItems =
				data.total != null
					? data.total
					: (page - 1) * this.state.perPage +
					  data.items.length +
					  (data.items.length === this.state.perPage ? 1 : 0);
			const { stockMap, priceMap } = await this._loadMetaForItems(data.items);
			await this._renderItems(container, data.items, stockMap, priceMap);
		} catch (e) {
			this._showError(container, e);
		}
	}

	// Re-render the current page (used after selection changes)
}
