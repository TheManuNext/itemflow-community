"""Tests for the n-gram search index."""

import frappe
from frappe.tests.utils import FrappeTestCase

from itemflow.search_index import find_item_codes, ngrams, rebuild_index, tokenize


class TestSearchIndex(FrappeTestCase):
	"""Tokenization and index lifecycle (incremental, disabled, rename, rebuild)."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		if not frappe.db.exists("UOM", "Unit"):
			frappe.get_doc({"doctype": "UOM", "uom_name": "Unit"}).insert(ignore_permissions=True)
		if not frappe.db.exists("Item Group", "ItemFlow Index Tests"):
			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": "ItemFlow Index Tests",
					"is_group": 0,
				}
			).insert(ignore_permissions=True)

	@classmethod
	def _delete_item(cls, code):
		if frappe.db.exists("Item", code):
			try:
				frappe.delete_doc("Item", code, force=True, ignore_permissions=True)
			except Exception:
				frappe.db.rollback()

	def _make_item(self, code, name):
		self._delete_item(code)
		return frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": code,
				"item_name": name,
				"item_group": "ItemFlow Index Tests",
				"stock_uom": "Unit",
			}
		).insert(ignore_permissions=True)

	# --- tokenization ---

	def test_tokenize_bigrams(self):
		self.assertEqual(tokenize("hello"), {"he", "el", "ll", "lo"})

	def test_tokenize_empty(self):
		self.assertEqual(tokenize(""), set())

	def test_ngrams_short_word_returns_word(self):
		self.assertEqual(ngrams("a"), {"a"})

	def test_tokenize_thai_without_spaces(self):
		tokens = tokenize("บ็อก")
		self.assertTrue(tokens)
		self.assertIn("บ็", tokens)

	def test_tokenize_lowercases_and_collapses_spaces(self):
		self.assertEqual(tokenize("  Foo   Bar  "), tokenize("foo bar"))

	# --- index lifecycle ---

	def test_incremental_index_and_disabled_skip(self):
		code = "IDX-TEST-001"
		doc = self._make_item(code, "IDX Thai บ็อกทดสอบ")
		self.assertIn(code, find_item_codes("บ็อกทดสอบ"))

		doc.disabled = 1
		doc.save(ignore_permissions=True)
		self.assertNotIn(code, find_item_codes("บ็อกทดสอบ"))

		doc.disabled = 0
		doc.save(ignore_permissions=True)
		self.assertIn(code, find_item_codes("บ็อกทดสอบ"))

		self._delete_item(code)

	def test_rename_reindexes(self):
		old = "IDX-TEST-RENAME-A"
		new = "IDX-TEST-RENAME-B"
		self._delete_item(old)
		self._delete_item(new)
		self._make_item(old, "Renamed Item โคมไฟทดสอบ")
		frappe.rename_doc("Item", old, new, force=True)

		codes = find_item_codes("โคมไฟทดสอบ")
		self.assertIn(new, codes)
		self.assertNotIn(old, codes)
		self._delete_item(new)

	def test_rebuild_is_idempotent(self):
		code = "IDX-TEST-REBUILD"
		self._make_item(code, "Rebuild Idempotency ทดสอบ")
		rebuild_index()
		first = frappe.db.count("ItemFlow Search Token")
		rebuild_index()
		second = frappe.db.count("ItemFlow Search Token")
		self.assertGreater(first, 0)
		self.assertEqual(first, second)
		self._delete_item(code)

	def test_api_search_uses_index_for_thai(self):
		from itemflow.api import get_items_by_search

		code = "IDX-TEST-API"
		self._make_item(code, "IDX Thai บ็อกทดสอบ")
		result = get_items_by_search("บ็อกทดสอบ", page_length=100)
		codes = [item["item_code"] for item in result["items"]]
		self.assertIn(code, codes)
		self._delete_item(code)

	@classmethod
	def tearDownClass(cls):
		for code in (
			"IDX-TEST-001",
			"IDX-TEST-RENAME-A",
			"IDX-TEST-RENAME-B",
			"IDX-TEST-API",
			"IDX-TEST-REBUILD",
		):
			cls._delete_item(code)
		if frappe.db.exists("Item Group", "ItemFlow Index Tests"):
			try:
				frappe.delete_doc("Item Group", "ItemFlow Index Tests", force=True, ignore_permissions=True)
			except Exception:
				frappe.db.rollback()
		super().tearDownClass()
