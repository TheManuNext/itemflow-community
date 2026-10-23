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

	wrapper.itemflow_inventory = mount(page.main[0]);
};

frappe.pages["itemflow-inventory"].refresh = function (wrapper) {
	if (wrapper.itemflow_inventory) {
		wrapper.itemflow_inventory.refresh();
	}
};
