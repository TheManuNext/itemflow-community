/**
 * Read-only context for `view` mode (Inventory page).
 *
 * The selector services (`stock_service`, `price_service`, `meta_service`) and
 * the grid (`data_loader`, `renderer`) only read a few fields from `frm`:
 * `doc.company`, the document price lists, `doc.set_warehouse`, `doctype` and
 * `doc.items`. On the page there is no form, so this minimal adapter emulates
 * that surface without changing the services.
 */

export function makeViewContext({
	company = "",
	priceList = null,
	buying = false,
	warehouse = "",
} = {}) {
	return {
		doctype: null,
		doc: {
			company,
			selling_price_list: buying ? null : priceList,
			buying_price_list: buying ? priceList : null,
			set_warehouse: warehouse || "",
			// `renderer` does (doc.items || []); with [] there are no "In doc" badges.
			items: [],
		},
	};
}
