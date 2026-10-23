app_name = "itemflow"
app_title = "ItemFlow"
app_publisher = "Manuel Romero"
app_description = "File-explorer-style item catalogue for ERPNext — an additional way to browse by category, search by name, code or brand, view stock and prices, and add items in bulk to sales, purchase and stock documents"
app_email = "251260536+TheManuNext@users.noreply.github.com"
app_license = "gpl-3.0"

required_apps = ["erpnext"]

# ES6 Bundle - Frappe v16 / Bootstrap 4.6.2
app_include_js = "itemflow.bundle.js"
app_include_css = "itemflow.bundle.css"

# Apps screen entry (v16.50 module-first navigation). Without this hook the app
# is not listed on the Apps screen (`on_apps_screen` is False in `frappe.boot`).
# `route` is intentionally omitted so the landing falls through to the app's
# first rail entry (the ItemFlow module sidebar).
add_to_apps_screen = [
	{
		"name": "itemflow",
		"title": "ItemFlow",
		"has_permission": "itemflow.api.check_app_permission",
		"sequence_id": 50,
	}
]

# Doctype specific JS
doctype_js = {
	"Sales Order": "public/js/integrations/sales_order.js",
	"Quotation": "public/js/integrations/quotation.js",
	"Sales Invoice": "public/js/integrations/sales_invoice.js",
	"Purchase Order": "public/js/integrations/purchase_order.js",
	"Material Request": "public/js/integrations/material_request.js",
	"Supplier Quotation": "public/js/integrations/supplier_quotation.js",
	"Purchase Invoice": "public/js/integrations/purchase_invoice.js",
	"Purchase Receipt": "public/js/integrations/purchase_receipt.js",
	"Stock Entry": "public/js/integrations/stock_entry.js",
}

# Itemflow Settings is not a fixture: it is created/seeded on install and
# migrate, so per-site/company configuration is not overwritten on every
# `bench migrate`.

# Keep the n-gram search index and the price/UOM caches in sync with changes.
doc_events = {
	"Item": {
		"after_insert": "itemflow.search_index.index_item",
		"on_update": [
			"itemflow.search_index.index_item",
			"itemflow.api.invalidate_item_uom_cache",
		],
		"on_trash": [
			"itemflow.search_index.remove_item",
			"itemflow.api.invalidate_item_uom_cache",
		],
		"after_rename": "itemflow.search_index.rename_item",
	},
	"Item Price": {
		"after_insert": "itemflow.api.invalidate_item_price_cache",
		"on_update": "itemflow.api.invalidate_item_price_cache",
		"on_trash": "itemflow.api.invalidate_item_price_cache",
	},
}

extend_bootinfo = ["itemflow.boot.extend_bootinfo"]

after_install = "itemflow.setup.after_install"
after_migrate = ["itemflow.setup.after_migrate"]
