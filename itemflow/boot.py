import frappe

from itemflow.extensions import get_filter_definitions


def _allow_negative_stock():
	"""True if Stock Settings allows negative stock (warnings must not block)."""
	try:
		return bool(frappe.db.get_single_value("Stock Settings", "allow_negative_stock"))
	except Exception:
		return False


def extend_bootinfo(bootinfo):
	"""Exposes Itemflow Settings in frappe.boot.

	Avoids a database round trip on every form refresh: the frontend
	(config.js) reads `frappe.boot.item_selector_settings` when present and
	only falls back to `frappe.db.get_doc` otherwise.
	"""
	if not frappe.has_permission("Item", ptype="read"):
		return

	try:
		settings = frappe.get_cached_doc("Itemflow Settings", "Itemflow Settings")
		data = settings.as_dict()
		data["allow_negative_stock"] = _allow_negative_stock()
		data["filter_definitions"] = get_filter_definitions(settings)
		bootinfo.item_selector_settings = data
	except Exception:
		frappe.log_error(title="ItemFlow - extend_bootinfo", message=frappe.get_traceback())
