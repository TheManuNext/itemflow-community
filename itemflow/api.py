import hashlib
import json

import frappe
from frappe import _
from frappe.utils import cint, flt
from frappe.utils.caching import redis_cache, request_cache

from itemflow import extensions
from itemflow.extensions import NATIVE_FILTER_FIELDS
from itemflow.search_index import NGRAM, rebuild_index, token_match_subquery

# Native Item fields that are filterable in the selector. Kept as a public
# constant for backwards compatibility; use get_filterable_fields() for the
# complete list including fields registered by derived apps.
FILTERABLE_FIELDS = NATIVE_FILTER_FIELDS

# Doctypes where only sellable / purchasable items should be offered.
SALES_DOCTYPES = ("Sales Order", "Quotation", "Sales Invoice")
PURCHASE_DOCTYPES = (
	"Purchase Order",
	"Material Request",
	"Supplier Quotation",
	"Purchase Invoice",
	"Purchase Receipt",
)

# Base Item fields for the SELECT
ITEM_FIELDS = (
	"name",
	"item_code",
	"item_name",
	"item_group",
	"stock_uom",
	"sales_uom",
	"purchase_uom",
	"brand",
	"image",
	"is_stock_item",
	"is_sales_item",
	"is_purchase_item",
)

# Fields searched by free text. They must match the ones indexed by the
# n-gram (search_index), so the substring check does not discard valid
# candidates or add matches the index cannot find.
SEARCH_FIELDS = ("item_code", "item_name", "brand")


def get_filterable_fields():
	"""Native filters plus fields registered by installed extensions."""
	extra = tuple(definition["fieldname"] for definition in extensions.get_extra_filter_fields())
	return (*NATIVE_FILTER_FIELDS, *extra)


def get_item_fields():
	"""Item columns selected by the API, including extension-defined filters."""
	extra = tuple(definition["fieldname"] for definition in extensions.get_extra_filter_fields())
	return (*ITEM_FIELDS, *extra)


# Minimum length to trigger a search: terms of one or two characters are noisy
# and cause a full scan, so they are ignored. The frontend does not send them
# either.
MIN_SEARCH_LENGTH = 3

# LIKE escape character: prevents % and _ typed by the user from acting as
# wildcards.
LIKE_ESCAPE_CHAR = "!"


def _like_escape(value):
	"""Escape LIKE wildcards (``!``, ``%`` and ``_``) so the input is treated literally."""
	if not value:
		return ""
	return (
		str(value)
		.replace(LIKE_ESCAPE_CHAR, LIKE_ESCAPE_CHAR * 2)
		.replace("%", f"{LIKE_ESCAPE_CHAR}%")
		.replace("_", f"{LIKE_ESCAPE_CHAR}_")
	)


def _item_type_where(doctype):
	"""SQL fragment (without parameters) to filter by item type for a doctype.

	Sales -> is_sales_item = 1; Purchase -> is_purchase_item = 1; others -> no filter.
	"""
	if not doctype:
		return ""
	if doctype in SALES_DOCTYPES:
		return " AND is_sales_item = 1"
	if doctype in PURCHASE_DOCTYPES:
		return " AND is_purchase_item = 1"
	return ""


def _normalize_filters(filters):
	"""Normalise filters from a JSON string or dict into a clean dict."""
	if not filters:
		return {}
	if isinstance(filters, str):
		try:
			filters = json.loads(filters)
		except ValueError, TypeError:
			return {}
	if not isinstance(filters, dict):
		return {}
	return filters


def _build_filters_where(filters):
	"""Build WHERE clauses and parameters from a filter dict.

	Only allowed fields are applied, and all use prefix LIKE.
	Returns (where_fragment, params_list).
	"""
	where = ""
	params = []
	if not filters:
		return where, params

	filterable = set(get_filterable_fields())
	for key, value in filters.items():
		if key not in filterable:
			continue
		value = (value or "").strip()
		if not value:
			continue
		# Length limit for safety
		if len(value) > 50:
			value = value[:50]
		where += f" AND `{key}` LIKE %s ESCAPE '{LIKE_ESCAPE_CHAR}'"
		params.append(f"{_like_escape(value)}%")

	return where, params


def _bounded_count(query, params, timeout_seconds=1):
	"""Bounded COUNT, using the same strategy as `frappe.desk.reportview.get_count`.

	On MariaDB the query execution time is limited; if it exceeds the timeout it
	returns ``None`` so the response is not blocked (the frontend shows an
	approximate total). Other engines run the normal count.
	"""
	if frappe.db.db_type == "mariadb":
		query = f"SET STATEMENT max_statement_time={timeout_seconds} FOR {query}"
	try:
		return frappe.db.sql(query, params)[0][0]
	except Exception as e:
		if frappe.db.is_statement_timeout(e):
			return None
		raise


@request_cache
def _get_company_warehouses(company):
	"""Warehouses belonging to a company (set of names), or None."""
	if not company:
		return None
	try:
		return set(frappe.get_all("Warehouse", filters={"company": company}, pluck="name"))
	except Exception:
		frappe.log_error(title="ItemFlow - _get_company_warehouses", message=frappe.get_traceback())
		return None


def _resolve_stock_warehouses(warehouse=None, company=None):
	"""Target warehouses for the stock filter.

	Priority: explicit warehouse > company warehouses > User Permissions.
	Returns a set (possibly empty) or None when there is no restriction.
	An empty set means "no accessible warehouses" => 0 results.

	When an explicit warehouse is provided it takes precedence, and it is not
	validated against the document company.
	"""
	permitted = _get_permitted_warehouses()

	if warehouse:
		if permitted is not None and warehouse not in permitted:
			return set()
		return {warehouse}

	if company:
		company_warehouses = _get_company_warehouses(company)
		if company_warehouses is None:
			# Invalid company or error: fall back to permission-based behaviour.
			return permitted
		if permitted is not None:
			return company_warehouses & permitted
		return company_warehouses

	return permitted


def _build_stock_subquery(stock_filter, warehouse=None, threshold=None, company=None):
	"""Build an SQL subquery to filter items by stock using EXISTS.

	Args:
	    stock_filter: 'in_stock' (actual_qty > 0) or 'restock' (exclude well-stocked items)
	    warehouse: Optional warehouse filter
	    threshold: Threshold for 'restock' (default 10)
	    company: Document company; without a warehouse, restricts to its warehouses

	Returns:
	    Tuple (subquery_sql, params_tuple)
	"""
	params = []
	warehouses = _resolve_stock_warehouses(warehouse, company)

	if warehouses is not None:
		if not warehouses:
			# No accessible warehouses: force an empty result.
			return "1=0", ()
		placeholders = ", ".join(["%s"] * len(warehouses))
		wh_clause = f"AND warehouse IN ({placeholders})"
		params.extend(sorted(warehouses))
	else:
		wh_clause = ""

	if stock_filter == "in_stock":
		subquery = f"""
			EXISTS (
				SELECT 1 FROM `tabBin`
				WHERE `tabBin`.item_code = `tabItem`.item_code
				{wh_clause}
				AND actual_qty > 0
			)
		"""
	elif stock_filter == "restock":
		threshold = float(threshold or 10)
		params.append(threshold)
		subquery = f"""
			NOT EXISTS (
				SELECT 1 FROM `tabBin`
				WHERE `tabBin`.item_code = `tabItem`.item_code
				{wh_clause}
				AND actual_qty > %s
			)
		"""
	else:
		return "", ()

	return subquery, tuple(params)


@frappe.whitelist(methods=["POST"])
def get_items_by_group(
	item_groups=None,
	page=1,
	page_length=20,
	in_stock_only=False,
	restock_only=False,
	low_stock_threshold=10,
	warehouse=None,
	filters=None,
	doctype=None,
	company=None,
):
	"""
	Get items by group(s) with server-side pagination.

	Args:
	    item_groups: Group name or list of names (JSON string or list)
	    page: Page number (1-based)
	    page_length: Items per page
	    in_stock_only: If True, only return items with stock > 0
	    warehouse: Warehouse used to filter stock (optional)
	    filters: Dict of prefix filters on Item fields (optional)
	    company: Document company; without a warehouse, restricts stock to its warehouses

	Returns:
	    Dict with an 'items' list and a 'total' count
	"""
	frappe.has_permission("Item", ptype="read", throw=True)

	filters = _normalize_filters(filters)

	if not item_groups:
		return {"items": [], "total": 0}

	if isinstance(item_groups, str):
		try:
			item_groups = json.loads(item_groups)
		except ValueError, TypeError:
			item_groups = [item_groups]

	if not isinstance(item_groups, list):
		item_groups = [item_groups]

	item_groups = [g for g in item_groups if g]

	if not item_groups:
		return {"items": [], "total": 0}

	if len(item_groups) > 50:
		frappe.throw(_("A maximum of 50 groups is allowed per query"))

	page = max(1, cint(page))
	page_length = max(1, min(cint(page_length), 100))
	offset = (page - 1) * page_length

	# Determine whether direct SQL (stock filters) or parameterised SQL is needed
	has_stock_filter = cint(in_stock_only) or cint(restock_only)
	fields_str = ", ".join(get_item_fields())

	try:
		filters_where, filters_params = _build_filters_where(filters)

		if has_stock_filter:
			# Use direct SQL with an EXISTS subquery to avoid a large IN clause
			return _get_items_by_group_sql(
				item_groups,
				page,
				page_length,
				offset,
				in_stock_only,
				restock_only,
				low_stock_threshold,
				warehouse,
				fields_str,
				filters_where,
				filters_params,
				doctype,
				company,
			)

		# No stock filters: use parameterised SQL
		group_placeholders = ",".join(["%s"] * len(item_groups))
		where = (
			f"disabled = 0 AND item_group IN ({group_placeholders}){_item_type_where(doctype)}{filters_where}"
		)
		base_params = list(item_groups) + filters_params

		total = _bounded_count(f"SELECT COUNT(*) FROM `tabItem` WHERE {where}", base_params)

		items = frappe.db.sql(
			f"""SELECT {fields_str}
			FROM `tabItem`
			WHERE {where}
			ORDER BY item_name ASC, name ASC
			LIMIT %s OFFSET %s""",
			[*base_params, page_length, offset],
			as_dict=True,
		)
		return {"items": items, "total": total}
	except Exception:
		frappe.log_error(title="ItemFlow - get_items_by_group", message=frappe.get_traceback())
		frappe.throw(_("Error loading items. Please try again."))


def _get_items_by_group_sql(
	item_groups,
	page,
	page_length,
	offset,
	in_stock_only,
	restock_only,
	low_stock_threshold,
	warehouse,
	fields_str,
	filters_where,
	filters_params,
	doctype=None,
	company=None,
):
	"""Direct SQL version with an EXISTS subquery for stock filters."""
	group_placeholders = ",".join(["%s"] * len(item_groups))
	params = list(item_groups)

	stock_filter = None
	if cint(in_stock_only):
		stock_filter = "in_stock"
	elif cint(restock_only):
		stock_filter = "restock"

	stock_subquery, stock_params = _build_stock_subquery(
		stock_filter, warehouse, low_stock_threshold, company
	)
	params.extend(stock_params)
	params.extend(filters_params)

	where = f"disabled = 0 AND item_group IN ({group_placeholders})"
	where += _item_type_where(doctype)
	if stock_subquery:
		# Non-stock items do not manage inventory: they are excluded from stock filters.
		where += f" AND is_stock_item = 1 AND {stock_subquery}"
	where += filters_where

	items = frappe.db.sql(
		f"""SELECT {fields_str} FROM `tabItem`
		WHERE {where}
		ORDER BY item_name ASC, name ASC
		LIMIT %s OFFSET %s""",
		[*params, page_length, offset],
		as_dict=True,
	)

	total = _bounded_count(f"SELECT COUNT(*) FROM `tabItem` WHERE {where}", params)

	return {"items": items, "total": total}


def _is_numeric_search(term):
	"""True when the search term consists only of digits.

	Staff often identify an item by the numeric part of the SKU, skipping the
	leading letters. With the n-gram index those digit bigrams are very common
	(``08``, ``01``, ``80``...) and return unrelated items, so numeric terms are
	resolved against the code instead.
	"""
	return bool(term) and term.isdigit()


def _word_substring_where(words, fields=SEARCH_FIELDS):
	"""Return ``(sql, params)`` with a word-level AND.

	Each word must appear as a substring in at least one of ``fields``. This is
	the check that turns the n-gram prefilter (which only guarantees that the
	bigrams exist, in any order and across fields) into a real substring match.
	Every term that is actually contained satisfies this condition.
	"""
	sql = ""
	params = []
	for word in words:
		clauses = " OR ".join(f"`{field}` LIKE %s ESCAPE '{LIKE_ESCAPE_CHAR}'" for field in fields)
		sql += f" AND ({clauses})"
		params.extend([f"%{_like_escape(word)}%"] * len(fields))
	return sql, params


def _code_first_order_by(term, numeric=False):
	"""``(order_by, params)`` that puts code/SKU matches first.

	In numeric searches the numeric part is a suffix of the code, so "ends with"
	is prioritised over "starts with". This way an exact or prefix SKU appears at
	the top instead of being buried under alphabetically earlier names.
	"""
	escaped = _like_escape(term)
	if numeric:
		order_by = (
			"CASE WHEN `item_code` = %s THEN 0 "
			f"WHEN `item_code` LIKE %s ESCAPE '{LIKE_ESCAPE_CHAR}' THEN 1 "
			f"WHEN `item_code` LIKE %s ESCAPE '{LIKE_ESCAPE_CHAR}' THEN 2 "
			"ELSE 3 END, item_name ASC, name ASC"
		)
		params = [term, f"%{escaped}", f"{escaped}%"]
	else:
		order_by = (
			"CASE WHEN `item_code` = %s THEN 0 "
			f"WHEN `item_code` LIKE %s ESCAPE '{LIKE_ESCAPE_CHAR}' THEN 1 "
			f"WHEN `item_code` LIKE %s ESCAPE '{LIKE_ESCAPE_CHAR}' THEN 2 "
			"ELSE 3 END, item_name ASC, name ASC"
		)
		params = [term, f"{escaped}%", f"%{escaped}%"]
	return order_by, params


def _search_items_sql(
	search_term,
	stock_filter=None,
	warehouse=None,
	threshold=None,
	page_length=20,
	offset=0,
	filters=None,
	doctype=None,
	token_condition=None,
	company=None,
	token_params=(),
	numeric=None,
):
	"""
	Run a search with an optional stock subquery.

	Uses EXISTS/NOT EXISTS instead of a large IN clause for scalability.
	All values are parameterised — no SQL injection risk.

	Args:
	    search_term: Normalised search term (without wildcards)
	    stock_filter: 'in_stock', 'restock', or None
	    warehouse: Optional warehouse
	    threshold: Threshold for restock
	    page_length: Result limit
	    offset: Pagination offset
	    filters: Dict of prefix filters on Item fields (optional)
	    doctype: Transaction doctype (filters by is_sales_item/is_purchase_item)
	    token_condition: Optional SQL fragment ``item_code IN (subquery)`` (n-gram
	        search). When provided, it is used as a prefilter and the substring
	        check confirms the match; `token_params` provides its parameters.
	    numeric: Forces the routing (True = code only, False = text). ``None``
	        infers it from `search_term`.

	Returns:
	    Tuple (total: int, items: list[dict])
	"""
	fields_str = ", ".join(get_item_fields())

	filters_where, filters_params = _build_filters_where(filters)
	stock_subquery, stock_params = _build_stock_subquery(stock_filter, warehouse, threshold, company)

	if numeric is None:
		numeric = _is_numeric_search(search_term)

	if numeric:
		# Numeric term only: match the SKU code only. The n-gram index is noisy
		# with digits, so it is not used. item_code is the SKU (always populated)
		# and its index makes the LIKE cheap.
		base_where = f"disabled = 0 AND `item_code` LIKE %s ESCAPE '{LIKE_ESCAPE_CHAR}'"
		base_params = [f"%{_like_escape(search_term)}%"]
	elif search_term:
		if token_condition:
			# N-gram prefilter: candidates resolved by a database subquery.
			base_where = f"disabled = 0 AND {token_condition}"
			base_params = list(token_params)
		else:
			base_where = "disabled = 0"
			base_params = []
		# Substring check: every word must be literally present.
		verify_where, verify_params = _word_substring_where(search_term.split())
		base_where += verify_where
		base_params.extend(verify_params)
	else:
		base_where = "disabled = 0"
		base_params = []

	if search_term:
		order_by, order_params = _code_first_order_by(search_term, numeric=numeric)
	else:
		order_by, order_params = "item_name ASC", []

	# The parameter order must match the placeholder order in the query:
	# base -> field filters -> stock -> order -> LIMIT/OFFSET.
	where = base_where + _item_type_where(doctype) + filters_where
	params = [*base_params, *filters_params]
	if stock_subquery:
		# Non-stock items do not manage inventory: they are excluded from stock filters.
		where += f" AND is_stock_item = 1 AND {stock_subquery}"
		params.extend(stock_params)

	total = _bounded_count(f"SELECT COUNT(*) FROM `tabItem` WHERE {where}", params)

	items = frappe.db.sql(
		f"""SELECT {fields_str} FROM `tabItem`
		    WHERE {where}
		    ORDER BY {order_by}
		    LIMIT %s OFFSET %s""",
		[*params, *order_params, page_length, offset],
		as_dict=True,
	)

	return total, items


@frappe.whitelist(methods=["POST"])
def get_items_by_search(
	search_term=None,
	page=1,
	page_length=20,
	in_stock_only=False,
	restock_only=False,
	low_stock_threshold=10,
	warehouse=None,
	filters=None,
	doctype=None,
	company=None,
):
	"""
	Search items by name or code with server-side pagination.

	Args:
	    search_term: Text to search in item_code or item_name
	    page: Page number (1-based)
	    page_length: Items per page
	    in_stock_only: If True, only return items with stock > 0
	    warehouse: Warehouse used to filter stock (optional)
	    filters: Dict of prefix filters on Item fields (optional)
	    company: Document company; without a warehouse, restricts stock to its warehouses

	Returns:
	    Dict with an 'items' list and a 'total' count
	"""
	frappe.has_permission("Item", ptype="read", throw=True)

	filters = _normalize_filters(filters)

	# Normalise the term: trim and collapse internal spaces.
	search_term = " ".join((search_term or "").split())
	if len(search_term) > 100:
		search_term = search_term[:100]

	# Very short terms are noisy and cause a full scan, so they are not searched.
	# An empty term (or filters only) still lists the catalogue.
	if 0 < len(search_term) < MIN_SEARCH_LENGTH:
		return {"items": [], "total": 0}

	page = max(1, cint(page))
	page_length = max(1, min(cint(page_length), 100))
	offset = (page - 1) * page_length

	stock_filter = None
	if cint(in_stock_only):
		stock_filter = "in_stock"
	elif cint(restock_only):
		stock_filter = "restock"

	try:
		fields_str = ", ".join(get_item_fields())

		numeric = _is_numeric_search(search_term)

		def _run(use_numeric):
			# Candidates via the n-gram index (text searches only; numeric terms
			# go straight to the code). If the term is short or has no tokens,
			# token_match_subquery returns (None, ()) and LIKE is used.
			token_condition, token_params = None, ()
			if len(search_term) >= NGRAM and not use_numeric:
				token_condition, token_params = token_match_subquery(search_term)
			return _search_items_sql(
				search_term,
				stock_filter,
				warehouse,
				low_stock_threshold,
				page_length,
				offset,
				filters,
				doctype,
				token_condition=token_condition,
				company=company,
				token_params=token_params,
				numeric=use_numeric,
			)

		if search_term or stock_filter or filters or doctype:
			# Direct SQL: search (code or tokens), stock, field filters, item type
			total, items = _run(numeric)
			# Fallback: a numeric term with no code matches may refer to a value
			# in the name or brand (for example, a wattage).
			if numeric and total == 0:
				total, items = _run(False)
		else:
			# No search or stock filter: full paginated list
			total = _bounded_count("SELECT COUNT(*) FROM `tabItem` WHERE disabled = 0", ())
			items = frappe.db.sql(
				f"""SELECT {fields_str}
				FROM `tabItem`
				WHERE disabled = 0
				ORDER BY item_name ASC, name ASC
				LIMIT %s OFFSET %s""",
				(page_length, offset),
				as_dict=True,
			)
		return {"items": items, "total": total}
	except Exception:
		frappe.log_error(title="ItemFlow - get_items_by_search", message=frappe.get_traceback())
		frappe.throw(_("Error loading items. Please try again."))


@frappe.whitelist(methods=["POST"])
def get_item_groups_hierarchy():
	"""
	Get all Item Groups in hierarchical order.
	Cached for five minutes because groups rarely change.

	The permission check is performed here (outside the cache) so it is not
	skipped on cache hits — @redis_cache returns the stored value before the
	function body runs, which would bypass has_permission().

	Returns:
	    List of Item Groups with parent information
	"""
	frappe.has_permission("Item", ptype="read", throw=True)
	return _cached_item_groups_hierarchy()


@redis_cache(ttl=300)
def _cached_item_groups_hierarchy():
	try:
		return frappe.get_all(
			"Item Group",
			fields=["name", "parent_item_group", "is_group", "lft", "rgt"],
			order_by="lft asc",
			limit=0,
		)
	except Exception:
		frappe.log_error(title="ItemFlow - get_item_groups_hierarchy", message=frappe.get_traceback())
		return []


@frappe.whitelist(methods=["POST"])
def get_descendant_groups(group_name):
	"""
	Get all descendant groups of a given group, including the group itself.
	Uses the Nested Set model (lft, rgt) for efficiency.
	Cached for five minutes — the same policy as get_item_groups_hierarchy.

	The permission check is performed here (outside the cache) for the same
	reason as in get_item_groups_hierarchy: to avoid a bypass on cache hits.

	Args:
	    group_name: Parent group name

	Returns:
	    List of group names
	"""
	frappe.has_permission("Item", ptype="read", throw=True)
	return _cached_descendant_groups(group_name)


@redis_cache(ttl=300)
def _cached_descendant_groups(group_name):
	if not group_name or group_name == "All Item Groups":
		return []

	try:
		parent = frappe.db.get_value("Item Group", group_name, ["lft", "rgt"], as_dict=True)

		if not parent:
			return [group_name]

		descendants = frappe.get_all(
			"Item Group",
			filters={"lft": [">=", parent.lft], "rgt": ["<=", parent.rgt]},
			fields=["name"],
			order_by="lft asc",
		)

		return [d.name for d in descendants]
	except Exception:
		frappe.log_error(title="ItemFlow - get_descendant_groups", message=frappe.get_traceback())
		return [group_name]


def _get_stock_levels_for_items(item_codes, warehouse=None, company=None):
	"""Stock (SUM of Bin) per item, with the warehouse scope already resolved.

	Does not apply permissions: the caller has already filtered the item_codes.
	"""
	if not item_codes:
		return {}

	warehouses = _resolve_stock_warehouses(warehouse, company)

	if warehouses is not None:
		if not warehouses:
			return {}
		warehouse_filter = "AND warehouse IN %(warehouses)s"
		query_params = {"item_codes": item_codes, "warehouses": sorted(warehouses)}
	else:
		warehouse_filter = ""
		query_params = {"item_codes": item_codes}

	# GROUP BY in SQL avoids fetching N rows into Python only to aggregate them
	bins = frappe.db.sql(
		f"""SELECT item_code, SUM(actual_qty) AS actual_qty
		   FROM `tabBin`
		   WHERE item_code IN %(item_codes)s {warehouse_filter}
		   GROUP BY item_code""",
		query_params,
		as_dict=True,
	)

	stock_map = {b.item_code: b.actual_qty for b in bins}

	# Items without a Bin record return None (no known stock)
	for code in item_codes:
		if code not in stock_map:
			stock_map[code] = None

	return stock_map


@frappe.whitelist(methods=["POST"])
def get_stock_levels(item_codes, warehouse=None, company=None):
	"""
	Get stock levels for the given items.

	Args:
	    item_codes: List of item codes (JSON string or list)
	    warehouse: Optional warehouse filter
	    company: Document company; without a warehouse, restricts stock to its warehouses

	Returns:
	    Dict with item_code as key and actual_qty as value (None if there is no Bin record)
	"""
	frappe.has_permission("Item", ptype="read", throw=True)

	if not item_codes:
		return {}

	if isinstance(item_codes, str):
		try:
			item_codes = json.loads(item_codes)
		except ValueError, TypeError:
			item_codes = [item_codes]

	if not item_codes:
		return {}

	if len(item_codes) > 200:
		frappe.throw(_("A maximum of 200 item codes is allowed per query"))

	# Filter by user permissions before querying stock
	item_codes = _filter_item_codes_by_permission(item_codes)
	if not item_codes:
		return {}

	try:
		return _get_stock_levels_for_items(item_codes, warehouse, company)
	except Exception:
		frappe.log_error(title="ItemFlow - get_stock_levels", message=frappe.get_traceback())
		return {}


CACHE_VERSION_PREFIX = "itemflow:cachever:"
PRICE_CACHE_PREFIX = "itemflow:item_prices:"
UOM_CACHE_PREFIX = "itemflow:item_uoms:"
PRICE_CACHE_TTL = 300
UOM_CACHE_TTL = 900


def _cache_version(scope):
	"""Current version of a cache scope (incremented to invalidate it)."""
	return cint(frappe.cache().get_value(f"{CACHE_VERSION_PREFIX}{scope}")) or 0


def _bump_cache_version(scope):
	"""Invalidate a scope without deleting keys (O(1)); old keys expire by TTL."""
	frappe.cache().set_value(f"{CACHE_VERSION_PREFIX}{scope}", _cache_version(scope) + 1)


def _item_set_digest(item_codes):
	return hashlib.sha1(",".join(sorted(item_codes)).encode()).hexdigest()


def invalidate_item_price_cache(doc=None, method=None):
	"""doc_events hook: changes to `Item Price` invalidate the price cache."""
	try:
		_bump_cache_version("prices")
	except Exception:
		frappe.log_error(title="ItemFlow - invalidate_item_price_cache", message=frappe.get_traceback())


def invalidate_item_uom_cache(doc=None, method=None):
	"""doc_events hook: changes to `Item` invalidate the UOM cache."""
	try:
		_bump_cache_version("uoms")
	except Exception:
		frappe.log_error(title="ItemFlow - invalidate_item_uom_cache", message=frappe.get_traceback())


def _get_prices_for_items(item_codes, price_list, buying=False):
	"""Price per item (preferring the stock_uom price).

	Does not apply permissions: the caller has already filtered the item_codes.
	Cached by item set + context; invalidated by `invalidate_item_price_cache`.
	"""
	if not item_codes or not price_list:
		return {}

	use_cache = not frappe.flags.in_test
	if use_cache:
		cache_key = (
			f"{PRICE_CACHE_PREFIX}{_cache_version('prices')}:{price_list}"
			f":{1 if cint(buying) else 0}:{_item_set_digest(item_codes)}"
		)
		cached = frappe.cache().get_value(cache_key)
		if cached is not None:
			return cached

	price_type_filter = {"buying": 1} if cint(buying) else {"selling": 1}

	# Get each item's stock_uom so base-UOM prices are preferred
	item_stock_uoms = {
		item.item_code: item.stock_uom
		for item in frappe.get_all(
			"Item", filters={"item_code": ["in", item_codes]}, fields=["item_code", "stock_uom"]
		)
	}

	prices = frappe.get_all(
		"Item Price",
		filters={"item_code": ["in", item_codes], "price_list": price_list, **price_type_filter},
		fields=["item_code", "price_list_rate", "uom"],
		order_by="modified desc",
	)

	# Group prices by item and UOM
	prices_by_item = {}
	for price in prices:
		prices_by_item.setdefault(price.item_code, []).append(price)

	price_map = {}
	for item_code in item_codes:
		stock_uom = item_stock_uoms.get(item_code)
		item_prices = prices_by_item.get(item_code, [])
		if not item_prices:
			continue

		# Prefer the price whose UOM matches stock_uom
		stock_uom_price = next((p for p in item_prices if p.uom == stock_uom), None)
		if stock_uom_price:
			price_map[item_code] = stock_uom_price.price_list_rate
		else:
			# Fallback: use the most recent price (first item by modified desc)
			price_map[item_code] = item_prices[0].price_list_rate

	if use_cache:
		frappe.cache().set_value(cache_key, price_map, expires_in_sec=PRICE_CACHE_TTL)

	return price_map


@frappe.whitelist(methods=["POST"])
def get_item_prices(item_codes, price_list, buying=False):
	"""
	Get item prices from a price list.

	Args:
	    item_codes: List of item codes (JSON string or list)
	    price_list: Price list name
	    buying: If True, use buying prices (buying=1); otherwise selling prices (selling=1)

	Returns:
	    Dict with item_code as key and price_list_rate as value
	"""
	frappe.has_permission("Item", ptype="read", throw=True)

	if not item_codes or not price_list:
		return {}

	if isinstance(item_codes, str):
		try:
			item_codes = json.loads(item_codes)
		except ValueError, TypeError:
			item_codes = [item_codes]

	if not item_codes:
		return {}

	if len(item_codes) > 200:
		frappe.throw(_("A maximum of 200 item codes is allowed per query"))

	# Filter by user permissions before querying prices
	item_codes = _filter_item_codes_by_permission(item_codes)
	if not item_codes:
		return {}

	try:
		return _get_prices_for_items(item_codes, price_list, buying)
	except Exception:
		frappe.log_error(title="ItemFlow - get_item_prices", message=frappe.get_traceback())
		return {}


def _filter_item_codes_by_permission(item_codes):
	"""Filter item_codes by user permissions using get_list (applies User Permissions)."""
	if not item_codes:
		return []
	allowed = frappe.get_list(
		"Item",
		filters={"item_code": ["in", item_codes]},
		fields=["item_code"],
		limit=0,
		ignore_permissions=False,
	)
	return [d.item_code for d in allowed]


@request_cache
def _get_permitted_warehouses():
	"""Warehouses permitted by User Permissions for the current user.

	Returns a set of permitted warehouses, or None when the user has no
	Warehouse User Permissions (no restriction: no filtering).
	"""
	try:
		user_permissions = frappe.defaults.get_user_permissions()
		if "Warehouse" not in user_permissions:
			return None

		allowed = {p["doc"] for p in user_permissions.get("Warehouse", []) if p.get("doc")}
		return allowed or None
	except Exception:
		frappe.log_error(title="ItemFlow - _get_permitted_warehouses", message=frappe.get_traceback())
		return None


def _get_uoms_for_items(item_codes):
	"""Get the conversion UOMs for the given items.

	Args:
	    item_codes: List of item codes

	Returns:
	    Dict with item_code as key and a dict with stock_uom, sales_uom, purchase_uom and uoms
	"""
	if not item_codes:
		return {}

	use_cache = not frappe.flags.in_test
	if use_cache:
		cache_key = f"{UOM_CACHE_PREFIX}{_cache_version('uoms')}:{_item_set_digest(item_codes)}"
		cached = frappe.cache().get_value(cache_key)
		if cached is not None:
			return cached

	items = frappe.get_all(
		"Item",
		filters={"item_code": ["in", item_codes], "disabled": 0},
		fields=["item_code", "stock_uom", "sales_uom", "purchase_uom"],
	)

	uoms = frappe.db.sql(
		"""SELECT parent as item_code, uom, conversion_factor
		   FROM `tabUOM Conversion Detail`
		   WHERE parenttype = 'Item' AND parentfield = 'uoms'
		   AND parent IN %(item_codes)s
		   ORDER BY idx ASC""",
		{"item_codes": item_codes},
		as_dict=True,
	)

	uoms_by_item = {}
	for u in uoms:
		uoms_by_item.setdefault(u.item_code, []).append(
			{
				"uom": u.uom,
				"conversion_factor": flt(u.conversion_factor),
			}
		)

	result = {}
	for item in items:
		code = item.item_code
		item_uoms = uoms_by_item.get(code, [])

		# Ensure stock_uom is always present with factor 1
		if not any(u["uom"] == item.stock_uom for u in item_uoms):
			item_uoms.insert(0, {"uom": item.stock_uom, "conversion_factor": 1.0})

		result[code] = {
			"stock_uom": item.stock_uom,
			"sales_uom": item.sales_uom,
			"purchase_uom": item.purchase_uom,
			"uoms": item_uoms,
		}

	if use_cache:
		frappe.cache().set_value(cache_key, result, expires_in_sec=UOM_CACHE_TTL)

	return result


@frappe.whitelist(methods=["POST"])
def get_item_uoms(item_codes):
	"""
	Get the available UOMs for the given items.

	Args:
	    item_codes: List of item codes (JSON string or list)

	Returns:
	    Dict with item_code as key and its UOMs and conversions
	"""
	frappe.has_permission("Item", ptype="read", throw=True)

	if not item_codes:
		return {}

	if isinstance(item_codes, str):
		try:
			item_codes = json.loads(item_codes)
		except ValueError, TypeError:
			item_codes = [item_codes]

	if not item_codes:
		return {}

	if len(item_codes) > 200:
		frappe.throw(_("A maximum of 200 item codes is allowed per query"))

	item_codes = _filter_item_codes_by_permission(item_codes)
	if not item_codes:
		return {}

	try:
		return _get_uoms_for_items(item_codes)
	except Exception:
		frappe.log_error(title="ItemFlow - get_item_uoms", message=frappe.get_traceback())
		return {}


@frappe.whitelist(methods=["POST"])
def get_items_meta(item_codes, price_list=None, buying=False, warehouse=None, company=None):
	"""Stock + price + UOMs for a page of items in a single call.

	Replaces the separate calls to `get_stock_levels`, `get_item_prices` and
	`get_item_uoms` that the catalogue made per page. Permission filtering is
	applied once, and the warehouse/company scope is reused.

	Returns:
	    Dict item_code -> {"stock", "price", "stock_uom", "sales_uom",
	    "purchase_uom", "uoms"}
	"""
	frappe.has_permission("Item", ptype="read", throw=True)

	if not item_codes:
		return {}

	if isinstance(item_codes, str):
		try:
			item_codes = json.loads(item_codes)
		except ValueError, TypeError:
			item_codes = [item_codes]

	if not item_codes:
		return {}

	if len(item_codes) > 200:
		frappe.throw(_("A maximum of 200 item codes is allowed per query"))

	# Permissions (User Permissions) applied once for all three blocks.
	item_codes = _filter_item_codes_by_permission(item_codes)
	if not item_codes:
		return {}

	try:
		uoms = _get_uoms_for_items(item_codes)
		prices = _get_prices_for_items(item_codes, price_list, buying) if price_list else {}
		stocks = _get_stock_levels_for_items(item_codes, warehouse, company)

		result = {}
		for code in item_codes:
			entry = dict(uoms.get(code) or {})
			entry["price"] = prices.get(code)
			entry["stock"] = stocks.get(code)
			result[code] = entry
		return result
	except Exception:
		frappe.log_error(title="ItemFlow - get_items_meta", message=frappe.get_traceback())
		return {}


@frappe.whitelist(methods=["POST"])
def get_item_price(item_code, price_list, uom=None, buying=False):
	"""
	Get an item price for a specific price list and UOM.

	If there is no price for the given UOM, returns None so the caller can
	apply a fallback (base price * conversion_factor).

	Args:
	    item_code: Item code
	    price_list: Price list name
	    uom: UOM to look up (optional)
	    buying: If True, use buying prices; otherwise selling prices

	Returns:
	    Dict with price, or None if no price is found
	"""
	frappe.has_permission("Item", ptype="read", throw=True)

	if not item_code or not price_list:
		return {"price": None}

	price_type_filter = {"buying": 1} if cint(buying) else {"selling": 1}

	filters = {
		"item_code": item_code,
		"price_list": price_list,
		**price_type_filter,
	}
	if uom:
		filters["uom"] = uom

	try:
		prices = frappe.get_all(
			"Item Price",
			filters=filters,
			fields=["price_list_rate"],
			order_by="modified desc",
			limit=1,
		)

		if prices:
			return {"price": flt(prices[0].price_list_rate)}

		return {"price": None}
	except Exception:
		frappe.log_error(title="ItemFlow - get_item_price", message=frappe.get_traceback())
		return {"price": None}


def _clear_selector_caches():
	"""Clear the selector's server-side caches (Item Groups)."""
	try:
		frappe.cache().delete_keys("itemflow.api._cached_descendant_groups")
		frappe.cache().delete_keys("itemflow.api._cached_item_groups_hierarchy")
	except Exception:
		frappe.log_error(title="ItemFlow - clear_selector_caches", message=frappe.get_traceback())
		frappe.throw(_("Error clearing the cache"))


@frappe.whitelist(methods=["POST"])
def invalidate_cache():
	"""Invalidate the selector caches.

	Available to any user with Item read permission. It only clears ItemFlow's
	own caches (the group hierarchy), so it is safe to expose to the selector's
	Refresh button.
	"""
	frappe.has_permission("Item", ptype="read", throw=True)
	_clear_selector_caches()
	return {"status": "success", "message": "Cache invalidated"}


@frappe.whitelist(methods=["POST"])
def rebuild_search_index():
	"""Rebuild the n-gram search index. System Manager only.

	Runs inline for small catalogues, otherwise queues a long background job.
	Returns ``{"queued": bool, "total": int}``.
	"""
	frappe.only_for("System Manager")
	result = rebuild_index()
	return {"status": "success", **result}


@frappe.whitelist(methods=["POST"])
def get_inventory_context(company=None):
	"""Read-only context for the Inventory page (standalone catalogue).

	The Inventory page always works with **one** company so stock is never
	aggregated across companies. The company is resolved in this order:

	1. the explicit ``company`` argument (validated against User Permissions);
	2. the user/global default company;
	3. the first company the user can read.

	The selling price list follows ERPNext's standard behaviour
	(``Selling Settings.selling_price_list``); ItemFlow does not add its own
	configuration here.

	Args:
	    company: Optional Company name selected by the user.

	Returns:
	    Dict with ``company``, ``companies``, ``price_list``, ``buying`` and
	    ``warehouse``. ``company`` is ``None`` only when the user cannot read any
	    company; the page then shows an empty state without querying stock.
	"""
	frappe.has_permission("Item", ptype="read", throw=True)

	companies = _get_readable_companies()
	requested = (company or "").strip() or None
	default_company = frappe.defaults.get_user_default("Company") or frappe.db.get_default("company") or None
	selected = _resolve_context_company(requested, default_company, companies)

	buying = False
	if buying:
		price_list = frappe.db.get_single_value("Buying Settings", "buying_price_list") or None
	else:
		price_list = frappe.db.get_single_value("Selling Settings", "selling_price_list") or None

	# Reuse the existing default_warehouse in Itemflow Settings (optional), but
	# only when it belongs to the selected company. Otherwise it is ignored and
	# the stock query uses the selected company's warehouses.
	configured_warehouse = frappe.db.get_single_value("Itemflow Settings", "default_warehouse") or None
	warehouse = _resolve_context_warehouse(configured_warehouse, selected)

	return {
		"company": selected,
		"companies": companies,
		"price_list": price_list,
		"buying": buying,
		"warehouse": warehouse,
	}


def _get_readable_companies():
	"""Non-group companies the current user can read, sorted by name."""
	names = []
	for row in frappe.get_all(
		"Company",
		filters={"is_group": 0},
		fields=["name"],
		order_by="name asc",
		limit=0,
	):
		if frappe.has_permission("Company", ptype="read", doc=row.name):
			names.append(row.name)
	return names


def _resolve_context_company(requested, default_company, companies):
	"""Pick exactly one company for the Inventory context."""
	if requested:
		if requested not in companies:
			frappe.throw(
				_("You do not have permission for Company {0}").format(requested),
				frappe.PermissionError,
			)
		return requested

	if default_company and default_company in companies:
		return default_company

	return companies[0] if companies else None


def _resolve_context_warehouse(warehouse, company):
	"""Return the configured warehouse only if it is valid for ``company``."""
	if not warehouse or not company:
		return None

	row = frappe.db.get_value(
		"Warehouse",
		warehouse,
		["company", "is_group", "disabled"],
		as_dict=True,
	)
	if not row or row.get("company") != company or row.get("is_group") or row.get("disabled"):
		return None

	permitted = _get_permitted_warehouses()
	if permitted is not None and warehouse not in permitted:
		return None

	return warehouse


def check_app_permission():
	"""`add_to_apps_screen.has_permission` hook.

	ItemFlow is item-centric, so a user only sees it on the Apps screen when
	they can read Item. Administrator bypasses the check as usual.
	"""
	return bool(frappe.has_permission("Item", ptype="read"))
