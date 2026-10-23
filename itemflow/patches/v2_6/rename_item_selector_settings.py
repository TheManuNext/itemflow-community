"""One-time migration: rename the settings DocType.

``Item Selector Settings`` -> ``Itemflow Settings``.

The new DocType is created by model sync during the same `bench migrate`; this
patch copies the existing Single's values into it and then removes the old
DocType. It is idempotent: it does nothing when the old DocType is absent.
"""

import frappe

OLD = "Item Selector Settings"
NEW = "Itemflow Settings"


def execute():
	if not frappe.db.exists("DocType", OLD):
		return

	# The new DocType should already exist (created by model sync). Fallback for
	# the rare case where it has not been synced yet.
	if not frappe.db.exists("DocType", NEW):
		frappe.reload_doc("itemflow", "doctype", "itemflow_settings")

	# Copy only actual DocType fields: `get_singles_dict` also returns document
	# metadata (name, creation, owner, ...). Copying `name` would leave the new
	# Single named after the old DocType and break its form.
	valid_fields = {df.fieldname for df in frappe.get_meta(NEW).fields}
	old_single = frappe.db.get_singles_dict(OLD) or {}
	for field, value in old_single.items():
		if field in valid_fields:
			frappe.db.set_single_value(NEW, field, value)

	# A healthy Single stores its own name as a Singles row.
	frappe.db.set_single_value(NEW, "name", NEW)
	frappe.db.commit()

	# Remove the old DocType (and its table/Singles rows).
	frappe.delete_doc("DocType", OLD, force=True, ignore_permissions=True)
	frappe.db.commit()
	frappe.clear_cache()
