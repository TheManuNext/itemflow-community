"""Migrate the button-style settings to Frappe v16's button vocabulary.

Before v2.8 the ``button_style`` / ``check_order_button_style`` selects stored
Bootstrap classes (``btn-primary``, ``btn-secondary``, ``btn-dark``,
``btn-warning``). Frappe v16 renders custom buttons through the Espresso
contract (``data-variant``), so the settings now store ``primary`` /
``secondary`` / ``danger`` / ``ghost``. This patch maps the legacy values once
so existing sites keep their configured look.
"""

import frappe

DOCTYPE = "Itemflow Settings"

MIGRATION = {
	"btn-primary": "primary",
	"btn-secondary": "secondary",
	"btn-dark": "primary",
	"btn-warning": "danger",
}

FIELDS = ("button_style", "check_order_button_style")


def execute():
	if not frappe.db.exists("DocType", DOCTYPE):
		return

	changed = False
	for field in FIELDS:
		value = frappe.db.get_single_value(DOCTYPE, field)
		new_value = MIGRATION.get(value)
		if new_value:
			frappe.db.set_single_value(DOCTYPE, field, new_value)
			changed = True

	if changed:
		frappe.db.commit()
		frappe.clear_cache()
