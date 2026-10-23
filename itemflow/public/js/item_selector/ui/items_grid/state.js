/**
 * State for the items grid (catalogue / search / edit modes).
 *
 * Holds pagination, mode, filters, toggles and the edit-mode data. External
 * callers (dialog.js, tree.js, selector.js) access it as `grid.state.*`.
 */
export class ItemsGridState {
	constructor() {
		this.page = 1;
		this.perPage = 20;
		this.totalItems = 0;
		this.mode = null; // 'group' | 'search' | 'doc'
		this.groups = null;
		this.search = null;
		this.filters = {}; // active attribute filters
		this.label = null; // display name set by tree (category name or 'All Items')
		this.inStockOnly = false; // sales toggle: In Stock Only
		this.restockOnly = false; // purchase toggle: Needs Restock
		// Guard to avoid concurrent renders from rapid pagination or toggle clicks
		this.rendering = false;
		// 'doc' mode (edit mode)
		this.docItemsAll = []; // deduplicated list of frm.doc.items
		this.docItemsFiltered = []; // after the local search filter
		this.docRowsMap = {}; // item_code → { first_row, extra_names[], _merged_qty }
		this.uomsMap = {}; // item_code → { stock_uom, sales_uom, purchase_uom, uoms }
	}
}
