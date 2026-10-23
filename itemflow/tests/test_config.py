"""
Tests for Itemflow Settings configuration
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from itemflow.itemflow.doctype.itemflow_settings.itemflow_settings import (
	FILTER_FIELDS,
)


class TestItemflowSettings(FrappeTestCase):
	"""Test cases for Itemflow Settings DocType"""

	def test_settings_exists(self):
		"""Test that settings document can be created and accessed"""
		# Get or create settings
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			settings = frappe.get_doc(
				{
					"doctype": "Itemflow Settings",
					"name": "Itemflow Settings",
					"low_stock_threshold": 10,
					"default_qty": 1,
					"enable_debug_mode": 0,
				}
			).insert()
		else:
			settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")

		# Verify it exists and has correct type
		self.assertIsNotNone(settings)
		self.assertEqual(settings.doctype, "Itemflow Settings")

	def test_settings_default_values(self):
		"""Test that default values are set correctly"""
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			settings = frappe.get_doc(
				{
					"doctype": "Itemflow Settings",
					"name": "Itemflow Settings",
					"low_stock_threshold": 10,
					"default_qty": 1,
				}
			).insert()
		else:
			settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")

		# Check defaults are reasonable
		self.assertIsInstance(settings.low_stock_threshold, int)
		self.assertIsInstance(settings.default_qty, int)
		self.assertGreaterEqual(settings.low_stock_threshold, 0)
		self.assertGreaterEqual(settings.default_qty, 1)

	def test_settings_fields(self):
		"""Test that all expected fields exist"""
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			settings = frappe.get_doc({"doctype": "Itemflow Settings", "name": "Itemflow Settings"}).insert()
		else:
			settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")

		# Check required fields
		required_fields = [
			"low_stock_threshold",
			"default_qty",
			"max_items",
			"add_chunk_size",
			"enable_debug_mode",
			"button_style",
			"button_position",
			*FILTER_FIELDS,
		]

		for field in required_fields:
			self.assertTrue(hasattr(settings, field), f"Settings should have field: {field}")

	def test_button_style_uses_v16_vocabulary(self):
		"""Button styles use the v16 vocabulary, not Bootstrap classes."""
		meta = frappe.get_meta("Itemflow Settings")
		expected = {"primary", "secondary", "danger", "ghost"}
		for fieldname in ("button_style", "check_order_button_style"):
			field = next(df for df in meta.fields if df.fieldname == fieldname)
			options = set((field.options or "").splitlines())
			self.assertEqual(options, expected, f"{fieldname} should offer the v16 vocabulary")

	def test_settings_default_filters(self):
		"""Data-driven filters should be enabled by default"""
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			settings = frappe.get_doc({"doctype": "Itemflow Settings", "name": "Itemflow Settings"}).insert()
		else:
			settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")

		enabled_filters = [
			"show_filter_brand",
			"show_filter_stock_uom",
		]
		for field in enabled_filters:
			self.assertTrue(getattr(settings, field, 0), f"{field} should be enabled by default")

	def test_settings_max_items_default(self):
		"""The max_items field defaults to 15 (configurable at runtime)"""
		meta = frappe.get_meta("Itemflow Settings")
		field = next(df for df in meta.fields if df.fieldname == "max_items")
		self.assertEqual(field.default, "15")

	def test_settings_max_items_cannot_exceed_30(self):
		"""The maximum per operation cannot exceed 30"""
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			settings = frappe.get_doc({"doctype": "Itemflow Settings", "name": "Itemflow Settings"}).insert()
		else:
			settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")

		settings.max_items = 31
		with self.assertRaises(frappe.exceptions.ValidationError):
			settings.validate()

	def test_settings_add_chunk_size_default(self):
		"""The add_chunk_size field defaults to 10 (configurable at runtime)"""
		meta = frappe.get_meta("Itemflow Settings")
		field = next(df for df in meta.fields if df.fieldname == "add_chunk_size")
		self.assertEqual(field.default, "10")

	def test_settings_add_chunk_size_cannot_exceed_max_items(self):
		"""The batch size cannot exceed the maximum per operation"""
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			settings = frappe.get_doc({"doctype": "Itemflow Settings", "name": "Itemflow Settings"}).insert()
		else:
			settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")

		settings.max_items = 20
		settings.add_chunk_size = 21
		with self.assertRaises(frappe.exceptions.ValidationError):
			settings.validate()

	def test_settings_add_chunk_size_must_be_positive(self):
		"""The batch size must be at least 1"""
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			settings = frappe.get_doc({"doctype": "Itemflow Settings", "name": "Itemflow Settings"}).insert()
		else:
			settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")

		settings.add_chunk_size = 0
		with self.assertRaises(frappe.exceptions.ValidationError):
			settings.validate()

	def test_settings_enabled_doctypes_defaults(self):
		"""Enabled doctypes should be active by default"""
		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			settings = frappe.get_doc({"doctype": "Itemflow Settings", "name": "Itemflow Settings"}).insert()
		else:
			settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")

		enabled_fields = [
			"enable_sales_order",
			"enable_quotation",
			"enable_sales_invoice",
			"enable_purchase_order",
			"enable_material_request",
			"enable_supplier_quotation",
			"enable_purchase_invoice",
			"enable_purchase_receipt",
			"enable_stock_entry",
		]

		for field in enabled_fields:
			self.assertTrue(getattr(settings, field, 0), f"{field} should be enabled by default")

	def test_settings_is_not_shipped_as_fixture(self):
		"""Itemflow Settings must not be a fixture: it would overwrite the site config."""
		import os

		for fixture_name in ("item_selector_settings.json", "itemflow_settings.json"):
			fixture_file = frappe.get_app_path("itemflow", "fixtures", fixture_name)
			self.assertFalse(os.path.exists(fixture_file), f"The fixture {fixture_name} must not exist")

		doctypes = set()
		for fixture in frappe.get_hooks("fixtures", app_name="itemflow") or []:
			if isinstance(fixture, dict):
				doctypes.add(fixture.get("dt") or fixture.get("doctype"))
			else:
				doctypes.add(fixture)
		self.assertNotIn("Itemflow Settings", doctypes)

	def test_seed_missing_settings_fills_unset_and_preserves_values(self):
		"""seed_missing_settings fills missing fields and preserves admin values."""
		from itemflow import setup

		if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
			setup.create_default_settings()

		# Value chosen by the admin that must be preserved.
		settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")
		settings.max_items = 25
		settings.save(ignore_permissions=True)

		# Simulate a new field with no stored value (absent from tabSingles).
		frappe.db.sql(
			"DELETE FROM `tabSingles` WHERE doctype=%s AND field=%s",
			("Itemflow Settings", "low_stock_threshold"),
		)
		frappe.clear_cache()

		setup.seed_missing_settings()

		self.assertEqual(frappe.db.get_single_value("Itemflow Settings", "low_stock_threshold"), 10)
		self.assertEqual(frappe.db.get_single_value("Itemflow Settings", "max_items"), 25)
