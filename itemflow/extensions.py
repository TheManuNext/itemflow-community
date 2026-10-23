"""Extension points for ItemFlow filter fields.

Community ships two native filters (``brand`` and ``stock_uom``). Derived apps
can register additional filterable ``Item`` fields through the
``itemflow_filter_fields`` hook. The hook returns a list of dicts:

    [
        {
            "fieldname": "custom_code",
            "label": "Custom Code",
            "order": 40,
            "visible": 0,
            "show_as_column": 1,
        },
    ]

Only fields that exist on ``Item`` and use a safe field type are accepted.
"""

import re

import frappe
from frappe import _

NATIVE_FILTER_FIELDS = ("brand", "stock_uom")
NATIVE_FILTER_DEFINITIONS = (
	{"fieldname": "brand", "label": "Brand", "order": 10, "visible": 1, "show_as_column": 0},
	{"fieldname": "stock_uom", "label": "Stock UOM", "order": 20, "visible": 1, "show_as_column": 0},
)
ALLOWED_FIELDTYPES = {"Data", "Link", "Select", "Currency", "Int", "Float", "Check"}
FIELDNAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


def _row_value(row, key, default=None):
	if isinstance(row, dict):
		return row.get(key, default)
	return getattr(row, key, default)


def _flatten(items):
	for item in items or []:
		if isinstance(item, (list, tuple)):
			yield from _flatten(item)
		else:
			yield item


def _get_hook_definitions():
	"""Read the raw hook value (kept separate so tests do not patch Frappe)."""
	return frappe.get_hooks("itemflow_filter_fields") or []


def get_extra_filter_fields():
	"""Return validated filter definitions registered by derived apps.

	The hook may be a list of dicts or a dotted path to a callable returning a
	list. Invalid fieldnames, native fields and fields that do not exist on
	``Item`` are ignored, so installing or removing a derived app never breaks
	Community.
	"""
	raw = _get_hook_definitions()
	if isinstance(raw, (dict, str)):
		raw = [raw]

	entries = []
	for entry in _flatten(raw):
		if isinstance(entry, str):
			try:
				result = frappe.get_attr(entry)() or []
				if isinstance(result, dict):
					result = [result]
				entries.extend(_flatten(result))
			except Exception:
				frappe.log_error(
					title="ItemFlow - itemflow_filter_fields",
					message=frappe.get_traceback(),
				)
		elif isinstance(entry, dict):
			entries.append(entry)

	meta = frappe.get_meta("Item")
	seen = set()
	definitions = []
	for entry in entries:
		fieldname = str(entry.get("fieldname") or "").strip()
		if not fieldname or fieldname in NATIVE_FILTER_FIELDS or fieldname in seen:
			continue
		if not FIELDNAME_PATTERN.match(fieldname):
			continue
		df = meta.get_field(fieldname)
		if not df or df.fieldtype not in ALLOWED_FIELDTYPES:
			continue
		seen.add(fieldname)
		try:
			order = int(entry.get("order") or 100)
		except Exception:
			# A malformed order from a derived app must not break Community.
			order = 100
		definitions.append(
			{
				"fieldname": fieldname,
				"label": entry.get("label") or df.label or fieldname.replace("_", " ").title(),
				"order": order,
				"visible": 1 if entry.get("visible") else 0,
				"show_as_column": 1 if entry.get("show_as_column") else 0,
				"fieldtype": df.fieldtype,
				"native": False,
			}
		)

	return sorted(definitions, key=lambda definition: (definition["order"], definition["fieldname"]))


def get_filter_definitions(settings=None):
	"""Return the complete ordered list of filters for the frontend.

	Native filters take visibility from the two checkbox fields. Extra filters
	take visibility and column display from their ``Itemflow Filter`` rows,
	falling back to the hook defaults when a row has not been seeded yet.
	"""
	if settings is None:
		settings = frappe.get_cached_doc("Itemflow Settings", "Itemflow Settings")

	rows = {}
	for row in settings.get("filters") or []:
		fieldname = _row_value(row, "fieldname")
		if fieldname:
			rows[fieldname] = row

	definitions = []
	for definition in NATIVE_FILTER_DEFINITIONS:
		fieldname = definition["fieldname"]
		definitions.append(
			{
				**definition,
				"label": _(definition["label"]),
				"visible": 1 if settings.get(f"show_filter_{fieldname}") else 0,
				"native": True,
			}
		)

	for definition in get_extra_filter_fields():
		row = rows.get(definition["fieldname"])
		definitions.append(
			{
				**definition,
				"label": _(_row_value(row, "label", definition["label"]) or definition["label"]),
				"order": _row_value(row, "order", definition["order"]) or definition["order"],
				"visible": 1 if _row_value(row, "visible", definition["visible"]) else 0,
				"show_as_column": 1 if _row_value(row, "show_as_column", definition["show_as_column"]) else 0,
			}
		)

	return sorted(definitions, key=lambda definition: (definition["order"], definition["fieldname"]))
