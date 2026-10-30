frappe.pages["itemflow-inventory"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Inventory"),
		single_column: true,
	});

	const mount = window.ItemFlowInventory && window.ItemFlowInventory.mount;
	if (typeof mount !== "function") {
		page.main.html(`
			<div class="text-muted p-4">
				${__("ItemFlow assets are not loaded. Run `bench build --app itemflow` and reload.")}
			</div>
		`);
		return;
	}

	// The catalogue replaces the contents of its container (`$root.html` in
	// `_createInline`). Mount it in a child so future page-level content is not
	// wiped when the catalogue finishes initialising.
	const container = $('<div class="itemflow-inventory-container"></div>').appendTo(page.main);
	wrapper.itemflow_inventory = mount(container[0]);
};

frappe.pages["itemflow-inventory"].refresh = function (wrapper) {
	const inventory = wrapper.itemflow_inventory;
	if (!inventory) return;
	return inventory.ready.then(() => inventory.refresh());
};
