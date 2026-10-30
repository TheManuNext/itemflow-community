import {
	currency,
	fallbackUom,
	getConversionFactor,
	getDefaultUom,
	getUomInfo,
	isNoPriceDoctype,
	isRestockDoctype,
	isStockItem,
} from "./items_grid/domain.js";
import { ItemsGridState } from "./items_grid/state.js";
import { ItemsGridRenderer } from "./items_grid/renderer.js";
import { ItemsGridEvents } from "./items_grid/events.js";
import { ItemsGridDataLoader } from "./items_grid/data_loader.js";
import { currentPageSlice } from "./items_grid/pagination.js";

export class ItemSelectorItemsGrid {
	constructor(dialog) {
		this.dialog = dialog;
		this.selector = dialog.selector;
		this.state = new ItemsGridState();
		this.renderer = new ItemsGridRenderer(this);
		this.events = new ItemsGridEvents(this);
		this.dataLoader = new ItemsGridDataLoader(this);
	}

	_isRestockDoctype() {
		return isRestockDoctype(this.selector.frm.doctype);
	}

	_isNoPriceDoctype() {
		return isNoPriceDoctype(this.selector.frm.doctype);
	}

	_isStockItem(item) {
		return isStockItem(item);
	}

	_getUomInfo(item_code) {
		return getUomInfo(this.state.uomsMap, item_code, this._fallbackUom());
	}

	_fallbackUom() {
		return fallbackUom(
			this.selector.settings,
			frappe.boot && frappe.boot.sysdefaults
		);
	}

	_currency() {
		return currency(
			this.selector.frm && this.selector.frm.doc,
			frappe.boot && frappe.boot.sysdefaults
		);
	}

	_getConversionFactor(item_code, uom) {
		return getConversionFactor(this.state.uomsMap, item_code, uom, this._fallbackUom());
	}

	_getDefaultUom(item) {
		return getDefaultUom(item, this._fallbackUom());
	}


	// 'doc' mode: loads and shows items already present in frm.doc.items
	_currentPageSlice() {
		return currentPageSlice(this.state.docItemsFiltered, this.state.page, this.state.perPage);
	}

	// Load items filtered by item groups (server-side pagination)
	async renderCurrentPage() {
		// Guard: if a render is already in flight (for example, a rapid pagination
		// or toggle click), queue a reload instead of dropping it. This matters
		// when the company changes while the grid is loading.
		if (this.state.rendering) {
			this.state.reloadRequested = true;
			return;
		}
		this.state.rendering = true;
		try {
			do {
				this.state.reloadRequested = false;
				await this._renderCurrentPageInner();
			} while (this.state.reloadRequested);
		} finally {
			this.state.rendering = false;
		}
	}

	async _renderCurrentPageInner() {
		if (this.state.mode === "doc") {
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
		} else if (this.state.mode === "group" && this.state.groups) {
			await this.loadItemsByGroups(
				this.state.groups,
				this.state.page,
				this.state.filters
			);
		} else {
			await this.searchItems(
				this.state.search || "",
				this.state.page,
				this.state.filters
			);
		}
	}







	_renderItems(container, items, preloadedStockMap = null, preloadedPriceMap = null) {
		return this.renderer._renderItems(container, items, preloadedStockMap, preloadedPriceMap);
	}

	_showLoading(container) {
		return this.renderer._showLoading(container);
	}

	_showError(container, e) {
		return this.renderer._showError(container, e);
	}

	showNoCompanyMessage() {
		const container = this.dialog.dialog.$wrapper.find("#items-container");
		return this.dataLoader._showNoCompany(container);
	}

	updateTotals() {
		return this.renderer.updateTotals();
	}

	_bindEvents(container, items, stockMap, priceMap, defaultQty) {
		return this.events._bindEvents(container, items, stockMap, priceMap, defaultQty);
	}

	async loadDocumentItems() {
		return this.dataLoader.loadDocumentItems();
	}

	async filterDocumentItems(term, filters = null) {
		return this.dataLoader.filterDocumentItems(term, filters);
	}

	async loadItemsByGroups(itemGroups, page = 1, filters = null) {
		return this.dataLoader.loadItemsByGroups(itemGroups, page, filters);
	}

	async searchItems(searchTerm, page = 1, filters = null) {
		return this.dataLoader.searchItems(searchTerm, page, filters);
	}
}
