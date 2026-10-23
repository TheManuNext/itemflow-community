from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from itemflow import extensions
from itemflow.setup import seed_filter_fields


class TestExtensions(FrappeTestCase):
	def _settings(self):
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			frappe.get_doc({"doctype": "Itemflow Settings", "name": "Itemflow Settings"}).insert()
		return frappe.get_doc("Itemflow Settings", "Itemflow Settings")

	def test_native_filter_definitions(self):
		"""Native filters are always present and marked as native."""
		settings = self._settings()
		definitions = extensions.get_filter_definitions(settings)
		by_field = {definition["fieldname"]: definition for definition in definitions}
		self.assertIn("brand", by_field)
		self.assertIn("stock_uom", by_field)
		self.assertTrue(by_field["brand"]["native"])

	def test_hook_fields_are_validated(self):
		"""Only existing, safe, non-native Item fields are accepted."""
		hook = [
			{
				"fieldname": "item_name",
				"label": "Item Name",
				"order": 30,
				"visible": 1,
				"show_as_column": 1,
			},
			{"fieldname": "does_not_exist", "label": "Missing"},
			{"fieldname": "brand", "label": "Native"},
			{"fieldname": "bad-field-name", "label": "Bad"},
		]
		with patch("itemflow.extensions._get_hook_definitions", return_value=hook):
			definitions = extensions.get_extra_filter_fields()

		self.assertEqual([definition["fieldname"] for definition in definitions], ["item_name"])
		self.assertEqual(definitions[0]["label"], "Item Name")
		self.assertEqual(definitions[0]["show_as_column"], 1)
		self.assertFalse(definitions[0]["native"])

	def test_unregistered_filter_rows_are_rejected(self):
		"""Administrators cannot inject arbitrary Item columns as filters."""
		settings = self._settings()
		settings.append(
			"filters",
			{
				"fieldname": "brand",
				"label": "Brand",
				"visible": 0,
				"order": 999,
				"show_as_column": 0,
			},
		)
		with self.assertRaises(frappe.ValidationError):
			settings.save(ignore_permissions=True)

	def test_seed_filter_fields_preserves_user_choices(self):
		"""Seeding adds new rows without overwriting visibility choices."""
		settings = self._settings()
		for row in list(settings.get("filters") or []):
			if row.fieldname == "item_name":
				settings.remove(row)
		settings.save(ignore_permissions=True)

		hook = [
			{
				"fieldname": "item_name",
				"label": "Item Name",
				"order": 30,
				"visible": 0,
				"show_as_column": 0,
			}
		]
		with patch("itemflow.extensions._get_hook_definitions", return_value=hook):
			seed_filter_fields()

		settings.reload()
		row = next(row for row in settings.filters if row.fieldname == "item_name")
		self.assertFalse(row.visible)
		self.assertFalse(row.show_as_column)

		row.visible = 1
		row.show_as_column = 1
		with patch("itemflow.extensions._get_hook_definitions", return_value=hook):
			settings.save(ignore_permissions=True)

		with patch("itemflow.extensions._get_hook_definitions", return_value=hook):
			seed_filter_fields()

		settings.reload()
		row = next(row for row in settings.filters if row.fieldname == "item_name")
		self.assertTrue(row.visible)
		self.assertTrue(row.show_as_column)

		settings.remove(row)
		settings.save(ignore_permissions=True)
