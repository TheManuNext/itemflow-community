"""
Tests for the ItemFlow API
"""

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase


class TestItemSelectorAPI(FrappeTestCase):
	"""Test cases for the ItemFlow API methods"""

	@classmethod
	def setUpClass(cls):
		"""Set up test data once for all tests"""
		super().setUpClass()

		# ERPNext does not ship UOMs as fixtures: they do not exist on a fresh site.
		# The tests need them in order to create Items.
		for uom in ("Unit", "Box"):
			if not frappe.db.exists("UOM", uom):
				frappe.get_doc({"doctype": "UOM", "uom_name": uom}).insert(ignore_permissions=True)

		# Create a test Item Group
		if not frappe.db.exists("Item Group", "Test Products"):
			cls.test_group = frappe.get_doc(
				{"doctype": "Item Group", "item_group_name": "Test Products", "is_group": 0}
			).insert()
		else:
			cls.test_group = frappe.get_doc("Item Group", "Test Products")

		# Create a test item
		if not frappe.db.exists("Item", "TEST-ITEM-001"):
			cls.test_item = frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": "TEST-ITEM-001",
					"item_name": "Test Item 001",
					"item_group": "Test Products",
					"stock_uom": "Unit",
					"is_stock_item": 1,
				}
			).insert()
		else:
			cls.test_item = frappe.get_doc("Item", "TEST-ITEM-001")

		# Auxiliary items to test item-type filtering (P1.1) and non-stock (P1.2)
		cls._extra_items = {
			"TEST-ITEM-SERVICE": {"is_stock_item": 0, "is_sales_item": 1, "is_purchase_item": 1},
			"TEST-SALES-OFF": {"is_stock_item": 1, "is_sales_item": 0, "is_purchase_item": 1},
			"TEST-PURCHASE-OFF": {"is_stock_item": 1, "is_sales_item": 1, "is_purchase_item": 0},
		}
		for item_code, flags in cls._extra_items.items():
			if not frappe.db.exists("Item", item_code):
				doc = {
					"doctype": "Item",
					"item_code": item_code,
					"item_name": item_code,
					"item_group": "Test Products",
					"stock_uom": "Unit",
					**flags,
				}
				frappe.get_doc(doc).insert()

		# Item with a brand, to test brand search
		if not frappe.db.exists("Brand", "TestBrand"):
			frappe.get_doc({"doctype": "Brand", "brand": "TestBrand"}).insert(ignore_permissions=True)
		if not frappe.db.exists("Item", "TEST-ITEM-BRAND"):
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": "TEST-ITEM-BRAND",
					"item_name": "Branded Widget",
					"item_group": "Test Products",
					"stock_uom": "Unit",
					"brand": "TestBrand",
				}
			).insert()

		# Items to test numeric routing and multi-word search (AND).
		# TESTNUM0805 does not contain "0801" in its code, but its name provides the
		# "01" bigram: the n-gram index would accept it, but numeric routing must
		# exclude it.
		cls._search_probe_items = {
			"TESTNUM0801": {"item_name": "Numeric Probe Real"},
			"TESTNUM0805": {"item_name": "Numeric Probe Row 01"},
			"TESTMULTIA": {"item_name": "Demo Downlight Widget"},
		}
		for item_code, extra in cls._search_probe_items.items():
			if not frappe.db.exists("Item", item_code):
				frappe.get_doc(
					{
						"doctype": "Item",
						"item_code": item_code,
						"item_group": "Test Products",
						"stock_uom": "Unit",
						**extra,
					}
				).insert()

	# --- Tests: get_items_by_group ---

	def test_get_items_by_group_single(self):
		"""Getting items by one group returns a paginated dict"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(["Test Products"])

		self.assertIsInstance(result, dict)
		self.assertIn("items", result)
		self.assertIn("total", result)
		self.assertIsInstance(result["items"], list)
		self.assertIsInstance(result["total"], int)
		self.assertTrue(
			any(item["item_code"] == "TEST-ITEM-001" for item in result["items"]),
			"The test item should appear in the results",
		)

	def test_get_items_by_group_multiple(self):
		"""Get items by multiple groups"""
		from itemflow.api import get_items_by_group

		# Create a second group and item
		if not frappe.db.exists("Item Group", "Test Raw Materials"):
			frappe.get_doc(
				{"doctype": "Item Group", "item_group_name": "Test Raw Materials", "is_group": 0}
			).insert()

		if not frappe.db.exists("Item", "TEST-ITEM-002"):
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": "TEST-ITEM-002",
					"item_name": "Test Item 002",
					"item_group": "Test Raw Materials",
					"stock_uom": "Unit",
				}
			).insert()

		result = get_items_by_group(["Test Products", "Test Raw Materials"])

		item_codes = [item["item_code"] for item in result["items"]]
		self.assertIn("TEST-ITEM-001", item_codes)
		self.assertIn("TEST-ITEM-002", item_codes)

	def test_get_items_by_group_empty(self):
		"""Empty groups return a dict with an empty list"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group([])
		self.assertIsInstance(result, dict)
		self.assertEqual(result.get("items", []), [])

	def test_get_items_by_group_nonexistent(self):
		"""A non-existent group returns empty items and total"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(["NonExistentGroup"])
		self.assertIsInstance(result, dict)
		self.assertEqual(result["items"], [])
		self.assertEqual(result["total"], 0)

	def test_get_items_by_group_pagination(self):
		"""Pagination parameters are respected"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(["Test Products"], page=1, page_length=1)
		self.assertIsInstance(result, dict)
		self.assertLessEqual(len(result["items"]), 1)
		self.assertGreaterEqual(result["total"], 0)

	def test_get_items_by_group_too_many_groups(self):
		"""More than 50 groups should raise a validation error"""
		from itemflow.api import get_items_by_group

		grupos_excesivos = [f"Grupo {i}" for i in range(51)]
		with self.assertRaises(frappe.exceptions.ValidationError):
			get_items_by_group(grupos_excesivos)

	def test_get_items_by_group_brand(self):
		"""Filter by brand prefix within a group"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(["Test Products"], filters={"brand": "TestBrand"})
		item_codes = [item["item_code"] for item in result["items"]]
		self.assertIn("TEST-ITEM-BRAND", item_codes)

		result_no_match = get_items_by_group(["Test Products"], filters={"brand": "NoSuchBrand"})
		self.assertEqual(result_no_match["items"], [])

	def test_get_items_by_group_multiple_filters(self):
		"""Filter by multiple native fields in combination"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(["Test Products"], filters={"brand": "TestBrand", "stock_uom": "Unit"})
		item_codes = [item["item_code"] for item in result["items"]]
		self.assertIn("TEST-ITEM-BRAND", item_codes)

		result_no_match = get_items_by_group(
			["Test Products"], filters={"brand": "TestBrand", "stock_uom": "Kilogram"}
		)
		self.assertEqual(result_no_match["items"], [])

	# --- Tests: item-type filtering (P1.1) and non-stock (P1.2) ---

	def test_item_fields_include_type_flags(self):
		"""ITEM_FIELDS exposes is_stock_item/is_sales_item/is_purchase_item"""
		from itemflow.api import ITEM_FIELDS

		for field in ("is_stock_item", "is_sales_item", "is_purchase_item"):
			self.assertIn(field, ITEM_FIELDS)

	def test_stock_entry_does_not_filter_by_item_type(self):
		"""Stock Entry does not filter by is_sales_item/is_purchase_item"""
		from itemflow.api import _item_type_where

		self.assertEqual(_item_type_where("Stock Entry"), "")

	def test_native_filter_fields_brand_and_stock_uom(self):
		"""brand and stock_uom are filterable and built as parameterised LIKE"""
		from itemflow.api import FILTERABLE_FIELDS, _build_filters_where

		self.assertIn("brand", FILTERABLE_FIELDS)
		self.assertIn("stock_uom", FILTERABLE_FIELDS)

		where, params = _build_filters_where({"brand": "3M", "stock_uom": "Pcs"})
		self.assertIn("`brand` LIKE %s", where)
		self.assertIn("`stock_uom` LIKE %s", where)
		self.assertEqual(params, ["3M%", "Pcs%"])

	def test_extension_filter_fields_are_included(self):
		"""Filter and SELECT fields registered by extensions are accepted."""
		from unittest.mock import patch

		from itemflow import api

		hook = [
			{
				"fieldname": "description",
				"label": "Description",
				"order": 30,
				"visible": 1,
				"show_as_column": 0,
			}
		]
		with patch("itemflow.extensions.get_extra_filter_fields", return_value=hook):
			self.assertIn("description", api.get_filterable_fields())
			self.assertIn("description", api.get_item_fields())
			where, params = api._build_filters_where({"description": "Widget"})

		self.assertIn("`description` LIKE %s", where)
		self.assertEqual(params, ["Widget%"])

	def test_unknown_filter_fields_are_ignored(self):
		"""Fields outside the whitelist are not turned into SQL"""
		from itemflow.api import _build_filters_where

		where, params = _build_filters_where({"item_name": "x", "1=1": "y"})
		self.assertEqual(where, "")
		self.assertEqual(params, [])

	def test_sales_doctype_filters_non_sales_items(self):
		"""Sales doctypes do not offer items with is_sales_item = 0"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(["Test Products"], doctype="Sales Order", page_length=100)
		codes = [i["item_code"] for i in result["items"]]
		self.assertIn("TEST-ITEM-001", codes)
		self.assertIn("TEST-ITEM-SERVICE", codes)
		self.assertNotIn("TEST-SALES-OFF", codes)

	def test_purchase_doctype_filters_non_purchase_items(self):
		"""Purchase doctypes do not offer items with is_purchase_item = 0"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(["Test Products"], doctype="Purchase Order", page_length=100)
		codes = [i["item_code"] for i in result["items"]]
		self.assertNotIn("TEST-PURCHASE-OFF", codes)

	def test_search_filters_by_doctype(self):
		"""get_items_by_search applies the item-type filter"""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("TEST-SALES-OFF", doctype="Sales Order", page_length=100)
		codes = [i["item_code"] for i in result["items"]]
		self.assertNotIn("TEST-SALES-OFF", codes)

	def test_stock_filter_excludes_non_stock_items(self):
		"""With an active stock filter, items with is_stock_item = 0 are excluded (P1.2)"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(
			["Test Products"], in_stock_only=1, doctype="Sales Order", page_length=100
		)
		codes = [i["item_code"] for i in result["items"]]
		self.assertNotIn("TEST-ITEM-SERVICE", codes)

	def test_restock_filter_excludes_non_stock_items(self):
		"""Needs Restock (NOT EXISTS) does not include services without a Bin (P1.2)"""
		from itemflow.api import get_items_by_group

		result = get_items_by_group(
			["Test Products"], restock_only=1, doctype="Purchase Order", page_length=100
		)
		codes = [i["item_code"] for i in result["items"]]
		self.assertNotIn("TEST-ITEM-SERVICE", codes)

	# --- Tests: allow_negative_stock (P1.3) ---

	def test_allow_negative_stock_returns_bool(self):
		"""The boot helper returns a boolean"""
		from itemflow.boot import _allow_negative_stock

		self.assertIsInstance(_allow_negative_stock(), bool)

	# --- Tests: get_items_by_search ---

	def test_get_items_by_search(self):
		"""Full-text search returns a paginated dict"""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("TEST-ITEM-001")

		self.assertIsInstance(result, dict)
		self.assertIn("items", result)
		self.assertIn("total", result)
		self.assertTrue(
			any(item["item_code"] == "TEST-ITEM-001" for item in result["items"]),
			"The search should find the test item by code",
		)

	def test_get_items_by_search_empty(self):
		"""Search with an empty term returns all items (paginated)"""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("")
		self.assertIsInstance(result, dict)
		self.assertIn("items", result)
		self.assertGreaterEqual(result["total"], 0)

	def test_get_items_by_search_term_too_long(self):
		"""Search terms longer than 100 characters are truncated without breaking the call"""
		from itemflow.api import get_items_by_search

		termino_largo = "A" * 200
		# It should not raise an exception -- the term is truncated internally
		result = get_items_by_search(termino_largo)
		self.assertIsInstance(result, dict)
		self.assertIn("items", result)

	def test_get_items_by_search_filter_brand(self):
		"""Filter by brand prefix in search"""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("", filters={"brand": "TestBrand"})
		item_codes = [item["item_code"] for item in result["items"]]
		self.assertIn("TEST-ITEM-BRAND", item_codes)

		result_no_match = get_items_by_search("", filters={"brand": "NoSuchBrand"})
		self.assertEqual(result_no_match["items"], [])

	def test_get_items_by_search_filters_as_json_string(self):
		"""Filters may arrive as a JSON string"""
		import json

		from itemflow.api import get_items_by_search

		result = get_items_by_search("", filters=json.dumps({"brand": "TestBrand"}))
		item_codes = [item["item_code"] for item in result["items"]]
		self.assertIn("TEST-ITEM-BRAND", item_codes)

	def test_get_items_by_search_by_brand(self):
		"""Search finds items by brand"""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("TestBrand", page_length=100)
		item_codes = [item["item_code"] for item in result["items"]]
		self.assertIn("TEST-ITEM-BRAND", item_codes)

	def test_get_items_by_search_normalizes_whitespace(self):
		"""The term is trimmed and internal spaces are collapsed"""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("  TEST-ITEM-001  ", page_length=100)
		item_codes = [item["item_code"] for item in result["items"]]
		self.assertIn("TEST-ITEM-001", item_codes)

	def test_search_numeric_matches_code_only(self):
		"""A numeric-only term searches the SKU code, without n-gram noise.

		TESTNUM0805 does not contain "0801" in its code, but its name provides the
		"01" bigram that the n-gram index would accept. Numeric routing must
		exclude it.
		"""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("0801", page_length=100)
		codes = [item["item_code"] for item in result["items"]]
		self.assertIn("TESTNUM0801", codes)
		self.assertNotIn("TESTNUM0805", codes)

	def test_search_code_first_ranking(self):
		"""The exact SKU appears first when searching by its code."""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("TESTNUM0801", page_length=100)
		self.assertTrue(result["items"])
		self.assertEqual(result["items"][0]["item_code"], "TESTNUM0801")

	def test_search_multi_word_requires_all_words(self):
		"""Multiple words are combined with AND: all must be present."""
		from itemflow.api import get_items_by_search

		present = get_items_by_search("demo downlight", page_length=100)
		self.assertIn("TESTMULTIA", [item["item_code"] for item in present["items"]])

		absent = get_items_by_search("demo downlight zzzz", page_length=100)
		self.assertNotIn("TESTMULTIA", [item["item_code"] for item in absent["items"]])

	def test_search_min_length_returns_empty(self):
		"""Terms shorter than MIN_SEARCH_LENGTH are not searched (avoids scan/noise)."""
		from itemflow.api import MIN_SEARCH_LENGTH, get_items_by_search

		for term in ("a", "ab"):
			self.assertLess(len(term), MIN_SEARCH_LENGTH)
			self.assertEqual(get_items_by_search(term, page_length=100), {"items": [], "total": 0})

	def test_like_escape_helper(self):
		"""_like_escape neutralises LIKE wildcards using '!'."""
		from itemflow.api import _like_escape

		self.assertEqual(_like_escape("a%b_c!d"), "a!%b!_c!!d")
		self.assertEqual(_like_escape(""), "")

	def test_word_substring_where_escapes_wildcards(self):
		"""The check escapes wildcards and uses ESCAPE '!'."""
		from itemflow.api import _word_substring_where

		where, params = _word_substring_where(["a%b"])
		self.assertIn("ESCAPE '!'", where)
		self.assertEqual(params, ["%a!%b%", "%a!%b%", "%a!%b%"])

	def test_build_filters_where_escapes_wildcards(self):
		"""Filters escape wildcards and use ESCAPE '!'."""
		from itemflow.api import _build_filters_where

		where, params = _build_filters_where({"brand": "%"})
		self.assertIn("ESCAPE '!'", where)
		self.assertEqual(params, ["!%%"])

	def test_search_filter_wildcard_is_literal(self):
		"""A '%' filter no longer shows the entire catalogue (wildcards are literal)."""
		from itemflow.api import get_items_by_search

		result = get_items_by_search("", filters={"brand": "%"})
		self.assertEqual(result["items"], [])

	def test_code_first_order_by_stable_tiebreaker(self):
		"""The ranking includes 'name ASC' for stable pagination."""
		from itemflow.api import _code_first_order_by

		order_by, params = _code_first_order_by("lamp")
		self.assertIn("name ASC", order_by)
		self.assertEqual(params, ["lamp", "lamp%", "%lamp%"])

	# --- Tests: parameter-order regression (search + stock + filters) ---

	def test_search_sql_param_order_with_stock_and_filters(self):
		"""Regression: parameters must follow the placeholder order in the WHERE
		clause when combining a stock filter and field filters."""
		from itemflow import api

		calls = []
		original = frappe.db.sql

		def fake_sql(query, params=None, as_dict=False, **kwargs):
			calls.append((query, params))
			if "COUNT(*)" in query:
				return [(0,)]
			return []

		frappe.db.sql = fake_sql
		try:
			# in_stock + warehouse + filter -> [code, name, brand, filter, warehouse]
			calls.clear()
			api._search_items_sql("fam", "in_stock", "Stores - Test", 10, 20, 0, {"brand": "TestBrand"})
			count_params = next(p for q, p in calls if "COUNT(*)" in q)
			self.assertEqual(count_params, ["%fam%", "%fam%", "%fam%", "TestBrand%", "Stores - Test"])

			# restock + warehouse + filter -> [code, name, brand, filter, warehouse, threshold]
			calls.clear()
			api._search_items_sql("fam", "restock", "Stores - Test", 10, 20, 0, {"brand": "TestBrand"})
			count_params = next(p for q, p in calls if "COUNT(*)" in q)
			self.assertEqual(count_params, ["%fam%", "%fam%", "%fam%", "TestBrand%", "Stores - Test", 10.0])

			# Invariant: #placeholders == #parameters in all queries
			for query, params in calls:
				self.assertEqual(
					query.count("%s"),
					len(params or []),
					msg="placeholder/param mismatch en consulta SQL",
				)
		finally:
			frappe.db.sql = original

	# --- Tests: warehouse permissions (User Permissions) ---

	def test_get_stock_levels_warehouse_user_permission(self):
		"""No stock is returned from warehouses outside User Permissions."""
		from itemflow import api

		original_permitted = api._get_permitted_warehouses
		original_filter = api._filter_item_codes_by_permission
		original_sql = frappe.db.sql
		api._get_permitted_warehouses = lambda: {"Stores - Test"}
		api._filter_item_codes_by_permission = lambda codes: list(codes)
		try:
			# Warehouse not permitted -> empty dict without querying
			self.assertEqual(api.get_stock_levels(["TEST-ITEM-001"], warehouse="Other - XX"), {})

			# No warehouse -> the query is restricted to permitted warehouses
			captured = {}

			def fake_sql(query, params=None, as_dict=False, **kwargs):
				captured["query"] = query
				captured["params"] = params
				return []

			frappe.db.sql = fake_sql
			api.get_stock_levels(["TEST-ITEM-001"])
			self.assertIn("warehouse IN", captured["query"])
			self.assertEqual(captured["params"]["warehouses"], ["Stores - Test"])
		finally:
			api._get_permitted_warehouses = original_permitted
			api._filter_item_codes_by_permission = original_filter
			frappe.db.sql = original_sql

	# --- Tests: stock scoping by company ---

	def test_resolve_stock_warehouses_precedence(self):
		"""Priority: explicit warehouse > company warehouses > User Permissions."""
		from itemflow import api

		orig_permitted = api._get_permitted_warehouses
		orig_company = api._get_company_warehouses
		try:
			api._get_permitted_warehouses = lambda: {"A - C1", "B - C1", "Z - C2"}
			api._get_company_warehouses = lambda company: {"A - C1", "B - C1"} if company == "C1" else None

			# The explicit warehouse takes precedence (even if it belongs to another company).
			self.assertEqual(api._resolve_stock_warehouses("Z - C2", "C1"), {"Z - C2"})
			# Warehouse not permitted -> empty set (0 results).
			self.assertEqual(api._resolve_stock_warehouses("Other", "C1"), set())
			# no warehouse -> company warehouses intersected with permitted ones.
			self.assertEqual(api._resolve_stock_warehouses(None, "C1"), {"A - C1", "B - C1"})
			# unknown company (None) -> falls back to permission-based behaviour.
			self.assertEqual(api._resolve_stock_warehouses(None, "C9"), {"A - C1", "B - C1", "Z - C2"})
		finally:
			api._get_permitted_warehouses = orig_permitted
			api._get_company_warehouses = orig_company

	def test_resolve_stock_warehouses_company_intersects_permitted(self):
		"""Company warehouses are intersected with User Permissions."""
		from itemflow import api

		orig_permitted = api._get_permitted_warehouses
		orig_company = api._get_company_warehouses
		try:
			api._get_permitted_warehouses = lambda: {"A - C1"}
			api._get_company_warehouses = lambda company: {"A - C1", "B - C1"}
			self.assertEqual(api._resolve_stock_warehouses(None, "C1"), {"A - C1"})
		finally:
			api._get_permitted_warehouses = orig_permitted
			api._get_company_warehouses = orig_company

	def test_build_stock_subquery_scopes_by_company(self):
		"""Without a warehouse, the stock subquery is limited to the company's warehouses."""
		from itemflow import api

		orig_permitted = api._get_permitted_warehouses
		orig_company = api._get_company_warehouses
		try:
			api._get_permitted_warehouses = lambda: None
			api._get_company_warehouses = lambda company: {"B - C1", "A - C1"}

			subquery, params = api._build_stock_subquery("in_stock", None, 10, "C1")
			self.assertIn("warehouse IN", subquery)
			self.assertEqual(params, ("A - C1", "B - C1"))

			# No accessible warehouses -> empty result (does not filter foreign stock).
			api._get_company_warehouses = lambda company: set()
			subquery, params = api._build_stock_subquery("in_stock", None, 10, "C1")
			self.assertEqual(subquery, "1=0")
			self.assertEqual(params, ())
		finally:
			api._get_permitted_warehouses = orig_permitted
			api._get_company_warehouses = orig_company

	def test_get_stock_levels_scopes_to_company(self):
		"""get_stock_levels without a warehouse limits stock to the company's warehouses."""
		from itemflow import api

		orig_permitted = api._get_permitted_warehouses
		orig_company = api._get_company_warehouses
		orig_filter = api._filter_item_codes_by_permission
		orig_sql = frappe.db.sql
		api._get_permitted_warehouses = lambda: None
		api._get_company_warehouses = lambda company: {"A - C1", "B - C1"}
		api._filter_item_codes_by_permission = lambda codes: list(codes)

		captured = {}

		def fake_sql(query, params=None, as_dict=False, **kwargs):
			captured["query"] = query
			captured["params"] = params
			return []

		frappe.db.sql = fake_sql
		try:
			api.get_stock_levels(["TEST-ITEM-001"], company="C1")
			self.assertIn("warehouse IN", captured["query"])
			self.assertEqual(captured["params"]["warehouses"], ["A - C1", "B - C1"])
		finally:
			api._get_permitted_warehouses = orig_permitted
			api._get_company_warehouses = orig_company
			api._filter_item_codes_by_permission = orig_filter
			frappe.db.sql = orig_sql

	def test_search_sql_param_order_with_company(self):
		"""Without a warehouse, stock-filtered search is scoped by company."""
		from itemflow import api

		orig_permitted = api._get_permitted_warehouses
		orig_company = api._get_company_warehouses
		original_sql = frappe.db.sql
		calls = []

		def fake_sql(query, params=None, as_dict=False, **kwargs):
			calls.append((query, params))
			if "COUNT(*)" in query:
				return [(0,)]
			return []

		frappe.db.sql = fake_sql
		api._get_permitted_warehouses = lambda: None
		api._get_company_warehouses = lambda company: {"Stores - C1"}
		try:
			api._search_items_sql("fam", "in_stock", None, 10, 20, 0, None, None, None, "C1")
			count_params = next(p for q, p in calls if "COUNT(*)" in q)
			self.assertEqual(count_params, ["%fam%", "%fam%", "%fam%", "Stores - C1"])
			self.assertTrue(any("warehouse IN" in q for q, _ in calls))
		finally:
			api._get_permitted_warehouses = orig_permitted
			api._get_company_warehouses = orig_company
			frappe.db.sql = original_sql

	# --- Tests: get_items_meta (P1) and _bounded_count (P3) ---

	def test_get_items_meta_combines_stock_price_uoms(self):
		"""get_items_meta returns stock, price and UOMs in a single call."""
		from itemflow import api

		result = api.get_items_meta(["TEST-ITEM-001"], price_list="Selling 2026")
		self.assertIn("TEST-ITEM-001", result)
		entry = result["TEST-ITEM-001"]
		self.assertIn("stock", entry)
		self.assertIn("price", entry)
		self.assertEqual(entry.get("stock_uom"), "Unit")
		self.assertTrue(entry.get("uoms"))

	def test_get_items_meta_empty(self):
		from itemflow import api

		self.assertEqual(api.get_items_meta([]), {})

	def test_get_items_meta_too_many(self):
		from itemflow import api

		with self.assertRaises(frappe.exceptions.ValidationError):
			api.get_items_meta([f"X-{i}" for i in range(201)])

	def test_bounded_count_uses_statement_timeout(self):
		"""_bounded_count applies max_statement_time on MariaDB (core pattern)."""
		from itemflow import api

		original = frappe.db.sql
		captured = {}

		def fake_sql(query, params=None, as_dict=False, **kwargs):
			captured["query"] = query
			return [(7,)]

		frappe.db.sql = fake_sql
		try:
			total = api._bounded_count("SELECT COUNT(*) FROM `tabItem`", ())
			self.assertEqual(total, 7)
			if frappe.db.db_type == "mariadb":
				self.assertIn("max_statement_time", captured["query"])
		finally:
			frappe.db.sql = original

	# --- Tests: n-gram subquery search (P5) and caches (P6) ---

	def test_token_match_subquery(self):
		"""N-gram search generates a subquery, not a literal IN."""
		from itemflow import search_index

		condition, params = search_index.token_match_subquery("lamp")
		self.assertIsNotNone(condition)
		self.assertIn("item_code IN (SELECT", condition)
		self.assertNotIn("item_code IN (%s", condition)
		self.assertNotIn("LIMIT", condition)  # MariaDB does not allow LIMIT in IN (subquery)
		# 3 bigrams + count
		self.assertEqual(len(params), 4)

		self.assertEqual(search_index.token_match_subquery("")[0], None)

	def test_search_items_sql_uses_token_condition(self):
		"""_search_items_sql uses the token condition as the WHERE base."""
		from itemflow import api, search_index

		condition, token_params = search_index.token_match_subquery("lamp")
		original = frappe.db.sql
		calls = []

		def fake_sql(query, params=None, as_dict=False, **kwargs):
			calls.append((query, params))
			return [(0,)] if "COUNT(*)" in query else []

		frappe.db.sql = fake_sql
		try:
			api._search_items_sql(
				"lamp",
				None,
				None,
				10,
				20,
				0,
				None,
				None,
				token_condition=condition,
				token_params=token_params,
			)
			count_params = next(p for q, p in calls if "COUNT(*)" in q)
			count_sql = next(q for q, p in calls if "COUNT(*)" in q)
			self.assertIn("IN (SELECT", count_sql)
			# N-gram prefilter + substring check (3 fields).
			self.assertEqual(list(count_params), [*token_params, "%lamp%", "%lamp%", "%lamp%"])
		finally:
			frappe.db.sql = original

	def test_cache_invalidation_bumps_versions(self):
		"""invalidate_* increments the cache version (O(1) invalidation)."""
		from itemflow import api

		p0 = api._cache_version("prices")
		u0 = api._cache_version("uoms")
		api.invalidate_item_price_cache()
		api.invalidate_item_uom_cache()
		self.assertEqual(api._cache_version("prices"), p0 + 1)
		self.assertEqual(api._cache_version("uoms"), u0 + 1)

	def test_cache_invalidation_hooks_registered(self):
		"""Item Price / Item doc_events invalidate the caches."""
		hooks = frappe.get_hooks("doc_events", app_name="itemflow")
		self.assertIn("Item Price", hooks)
		self.assertIn("itemflow.api.invalidate_item_price_cache", hooks["Item Price"]["on_update"])
		self.assertIn("itemflow.api.invalidate_item_uom_cache", hooks["Item"]["on_update"])

	# --- Tests: get_descendant_groups ---

	def test_get_descendant_groups(self):
		"""Getting descendant groups includes parent and child"""
		from itemflow.api import get_descendant_groups

		# Create a parent group and a child group
		if not frappe.db.exists("Item Group", "Test Parent"):
			frappe.get_doc(
				{"doctype": "Item Group", "item_group_name": "Test Parent", "is_group": 1}
			).insert()

			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": "Test Child",
					"parent_item_group": "Test Parent",
					"is_group": 0,
				}
			).insert()

		result = get_descendant_groups("Test Parent")

		self.assertIn("Test Parent", result)
		self.assertIn("Test Child", result)

	def test_get_descendant_groups_single(self):
		"""Getting descendants of a leaf group returns only that group"""
		from itemflow.api import get_descendant_groups

		result = get_descendant_groups("Test Products")
		self.assertEqual(result, ["Test Products"])

	# --- Tests: get_stock_levels ---

	def test_get_stock_levels_empty(self):
		"""An empty item_codes array returns an empty dict"""
		from itemflow.api import get_stock_levels

		result = get_stock_levels([])
		self.assertIsInstance(result, dict)
		self.assertEqual(result, {})

	def test_get_stock_levels_items(self):
		"""Stock returns a dict with item_codes as keys"""
		from itemflow.api import get_stock_levels

		result = get_stock_levels(["TEST-ITEM-001"])
		self.assertIsInstance(result, dict)
		# The item may have stock None (no Bin record) or a number
		self.assertIn("TEST-ITEM-001", result)

	def test_get_stock_levels_json_string(self):
		"""item_codes as a JSON string is parsed correctly"""
		import json

		from itemflow.api import get_stock_levels

		result = get_stock_levels(json.dumps(["TEST-ITEM-001"]))
		self.assertIsInstance(result, dict)
		self.assertIn("TEST-ITEM-001", result)

	# --- Tests: get_item_prices ---

	def test_get_item_prices_empty_codes(self):
		"""Without item_codes, returns an empty dict"""
		from itemflow.api import get_item_prices

		result = get_item_prices([], "Standard Selling")
		self.assertIsInstance(result, dict)
		self.assertEqual(result, {})

	def test_get_item_prices_no_price_list(self):
		"""Without price_list, returns an empty dict"""
		from itemflow.api import get_item_prices

		result = get_item_prices(["TEST-ITEM-001"], None)
		self.assertIsInstance(result, dict)
		self.assertEqual(result, {})

	def test_get_item_prices_returns_dict(self):
		"""With valid data, returns a dict (even if no prices are configured)"""
		from itemflow.api import get_item_prices

		result = get_item_prices(["TEST-ITEM-001"], "Standard Selling")
		self.assertIsInstance(result, dict)

	def test_get_stock_levels_too_many_codes(self):
		"""More than 200 item_codes should raise ValidationError"""
		from itemflow.api import get_stock_levels

		many_codes = [f"ITEM-{i}" for i in range(201)]
		with self.assertRaises(frappe.exceptions.ValidationError):
			get_stock_levels(many_codes)

	def test_get_item_prices_too_many_codes(self):
		"""More than 200 item_codes should raise ValidationError"""
		from itemflow.api import get_item_prices

		many_codes = [f"ITEM-{i}" for i in range(201)]
		with self.assertRaises(frappe.exceptions.ValidationError):
			get_item_prices(many_codes, "Standard Selling")

	# --- Tests: get_item_uoms ---

	def test_get_item_uoms_returns_stock_uom(self):
		"""get_item_uoms returns at least the stock_uom with factor 1"""
		from itemflow.api import get_item_uoms

		result = get_item_uoms(["TEST-ITEM-001"])
		self.assertIsInstance(result, dict)
		self.assertIn("TEST-ITEM-001", result)
		self.assertEqual(result["TEST-ITEM-001"]["stock_uom"], "Unit")
		uoms = result["TEST-ITEM-001"]["uoms"]
		self.assertTrue(any(u["uom"] == "Unit" and u["conversion_factor"] == 1 for u in uoms))

	def test_get_item_uoms_multiple_uoms(self):
		"""get_item_uoms returns all configured UOMs for the item"""
		from itemflow.api import get_item_uoms

		# Ensure the test item has at least two UOMs
		item = frappe.get_doc("Item", "TEST-ITEM-001")
		if not any(u.uom == "Box" for u in item.uoms):
			item.append("uoms", {"uom": "Box", "conversion_factor": 10})
			item.save()

		result = get_item_uoms(["TEST-ITEM-001"])
		uoms = result["TEST-ITEM-001"]["uoms"]
		self.assertTrue(any(u["uom"] == "Box" and u["conversion_factor"] == 10 for u in uoms))

	def test_get_item_uoms_empty(self):
		"""An empty item_codes array returns an empty dict"""
		from itemflow.api import get_item_uoms

		result = get_item_uoms([])
		self.assertIsInstance(result, dict)
		self.assertEqual(result, {})

	# --- Tests: get_item_price ---

	def test_get_item_price_no_specific_uom(self):
		"""Without a specific UOM, looks up a price without UOM and returns None if none exists"""
		from itemflow.api import get_item_price

		result = get_item_price("TEST-ITEM-001", "Standard Selling")
		self.assertIsInstance(result, dict)
		self.assertIn("price", result)

	def test_get_item_price_specific_uom(self):
		"""Look up a price for a specific UOM"""
		from itemflow.api import get_item_price

		result = get_item_price("TEST-ITEM-001", "Standard Selling", uom="Unit")
		self.assertIsInstance(result, dict)
		self.assertIn("price", result)

	def test_get_item_price_invalid_item(self):
		"""A non-existent item returns price None"""
		from itemflow.api import get_item_price

		result = get_item_price("NONEXISTENT-ITEM", "Standard Selling", uom="Unit")
		self.assertIsInstance(result, dict)
		self.assertIsNone(result["price"])

	def test_invalidate_cache_returns_success(self):
		"""invalidate_cache returns success status with Item permissions"""
		from itemflow.api import invalidate_cache

		result = invalidate_cache()
		self.assertIsInstance(result, dict)
		self.assertEqual(result.get("status"), "success")

	# --- Tests: get_inventory_context (Inventory page) ---

	def test_get_inventory_context_shape(self):
		"""The page context returns company/price_list/buying/warehouse."""
		from itemflow.api import get_inventory_context

		result = get_inventory_context()

		self.assertIsInstance(result, dict)
		for key in ("company", "price_list", "buying", "warehouse"):
			self.assertIn(key, result)
		self.assertIsInstance(result["buying"], bool)
		self.assertFalse(result["buying"])

	def test_get_inventory_context_uses_selling_settings_price_list(self):
		"""The price list follows the standard Selling Settings single."""
		from itemflow import api

		original = frappe.db.get_single_value
		seen = []

		def fake_get_single_value(doctype, field):
			seen.append((doctype, field))
			if (doctype, field) == ("Selling Settings", "selling_price_list"):
				return "Selling 2026"
			return None

		frappe.db.get_single_value = fake_get_single_value
		try:
			result = api.get_inventory_context()
			self.assertEqual(result["price_list"], "Selling 2026")
			self.assertIn(("Selling Settings", "selling_price_list"), seen)
		finally:
			frappe.db.get_single_value = original

	def test_get_inventory_context_resolves_default_company(self):
		"""Without an explicit company, the user default is used."""
		from itemflow import api

		with (
			patch.object(api, "_get_readable_companies", return_value=["A", "B"]),
			patch.object(frappe.defaults, "get_user_default", return_value="B"),
			patch.object(api, "_resolve_context_warehouse", return_value=None),
		):
			result = api.get_inventory_context()

		self.assertEqual(result["company"], "B")
		self.assertEqual(result["companies"], ["A", "B"])

	def test_get_inventory_context_falls_back_to_first_company(self):
		"""Without a valid default, the first readable company is used."""
		from itemflow import api

		with (
			patch.object(api, "_get_readable_companies", return_value=["A", "B"]),
			patch.object(frappe.defaults, "get_user_default", return_value=None),
			patch.object(frappe.db, "get_default", return_value=None),
			patch.object(api, "_resolve_context_warehouse", return_value=None),
		):
			result = api.get_inventory_context()

		self.assertEqual(result["company"], "A")

	def test_get_inventory_context_explicit_company(self):
		"""An explicit company is honoured when the user can read it."""
		from itemflow import api

		with (
			patch.object(api, "_get_readable_companies", return_value=["A", "B"]),
			patch.object(api, "_resolve_context_warehouse", return_value="W-B"),
		):
			result = api.get_inventory_context(company="B")

		self.assertEqual(result["company"], "B")
		self.assertEqual(result["warehouse"], "W-B")

	def test_get_inventory_context_rejects_foreign_company(self):
		"""A company outside User Permissions raises PermissionError."""
		from itemflow import api

		with patch.object(api, "_get_readable_companies", return_value=["A"]):
			with self.assertRaises(frappe.PermissionError):
				api.get_inventory_context(company="B")

	def test_get_inventory_context_without_companies(self):
		"""No readable company returns None and no warehouse."""
		from itemflow import api

		with (
			patch.object(api, "_get_readable_companies", return_value=[]),
			patch.object(frappe.defaults, "get_user_default", return_value=None),
			patch.object(frappe.db, "get_default", return_value=None),
		):
			result = api.get_inventory_context()

		self.assertIsNone(result["company"])
		self.assertEqual(result["companies"], [])
		self.assertIsNone(result["warehouse"])

	def test_resolve_context_warehouse_validates_company(self):
		"""The configured warehouse is only used for its own company."""
		from itemflow import api

		with (
			patch.object(
				frappe.db,
				"get_value",
				return_value={"company": "A", "is_group": 0, "disabled": 0},
			),
			patch.object(api, "_get_permitted_warehouses", return_value=None),
		):
			self.assertEqual(api._resolve_context_warehouse("W-A", "A"), "W-A")

		with patch.object(
			frappe.db,
			"get_value",
			return_value={"company": "B", "is_group": 0, "disabled": 0},
		):
			self.assertIsNone(api._resolve_context_warehouse("W-B", "A"))

		with patch.object(
			frappe.db,
			"get_value",
			return_value={"company": "A", "is_group": 1, "disabled": 0},
		):
			self.assertIsNone(api._resolve_context_warehouse("W-GROUP", "A"))

		with (
			patch.object(
				frappe.db,
				"get_value",
				return_value={"company": "A", "is_group": 0, "disabled": 0},
			),
			patch.object(api, "_get_permitted_warehouses", return_value={"OTHER"}),
		):
			self.assertIsNone(api._resolve_context_warehouse("W-A", "A"))

	@classmethod
	def tearDownClass(cls):
		"""Clean up test data"""
		for item_code in [
			"TEST-ITEM-001",
			"TEST-ITEM-002",
			"TEST-ITEM-SERVICE",
			"TEST-SALES-OFF",
			"TEST-PURCHASE-OFF",
			"TEST-ITEM-BRAND",
			"TESTNUM0801",
			"TESTNUM0805",
			"TESTMULTIA",
		]:
			if frappe.db.exists("Item", item_code):
				try:
					frappe.delete_doc("Item", item_code, force=True)
				except Exception:
					frappe.db.rollback()

		if frappe.db.exists("Brand", "TestBrand"):
			try:
				frappe.delete_doc("Brand", "TestBrand", force=True)
			except Exception:
				frappe.db.rollback()

		for group in ["Test Child", "Test Raw Materials", "Test Products", "Test Parent"]:
			if frappe.db.exists("Item Group", group):
				try:
					frappe.delete_doc("Item Group", group, force=True)
				except Exception:
					frappe.db.rollback()

		super().tearDownClass()
