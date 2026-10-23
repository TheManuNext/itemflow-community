"""One-time repair for the ``Itemflow Settings`` Single.

The v2.7.0 rename patch copied the old Single's document metadata into the new
DocType, leaving its ``name`` as "Item Selector Settings". A Single's name must
equal its DocType, otherwise the desk form renders "not found". This patch
restores the correct name and backfills the metadata that was copied as null.
"""

import frappe
from frappe.utils import now

NEW = "Itemflow Settings"


def execute():
	if not frappe.db.exists("DocType", NEW):
		return

	current = frappe.db.get_singles_dict(NEW) or {}

	if current.get("name") != NEW:
		frappe.db.set_single_value(NEW, "name", NEW)

	for field in ("owner", "modified_by"):
		if not current.get(field):
			frappe.db.set_single_value(NEW, field, "Administrator")

	timestamp = now()
	for field in ("creation", "modified"):
		if not current.get(field):
			frappe.db.set_single_value(NEW, field, timestamp)

	frappe.db.commit()
	frappe.clear_cache()
