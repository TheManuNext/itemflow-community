// ItemFlow — Item list integration.
//
// Adds an "ItemFlow Catalogue" action to the standard Item list. It opens the
// read-only catalogue in a modal so users can search by code/name/brand, filter
// by stock, company, brand or UOM, and open an item's form.
//
// This file is loaded through `doctype_list_js` and evaluated as plain JS, so
// it must not use ES module syntax. The modal lives in the global bundle
// (`window.ItemSelectorPlus`).

(function () {
	const settings = frappe.listview_settings["Item"];
	if (!settings || settings.__itemflow_catalogue) return;

	const original_onload = settings.onload;

	settings.onload = function (listview) {
		if (original_onload) original_onload.call(this, listview);

		// The list view can be re-initialised without a full page reload.
		if (listview.__itemflow_button_added) return;
		listview.__itemflow_button_added = true;

		listview.page.add_inner_button(__("ItemFlow Catalogue"), () => {
			if (!window.ItemSelectorPlus) {
				frappe.msgprint(__("ItemFlow is still loading. Please try again."));
				return;
			}
			new window.ItemSelectorPlus(null, { mode: "view", showPrices: false }).init();
		});
	};

	settings.__itemflow_catalogue = true;
})();
