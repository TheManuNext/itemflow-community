import frappe

from itemflow.extensions import get_extra_filter_fields

# Field types with no value of their own that should not be seeded.
SKIP_FIELDTYPES = ("Section Break", "Column Break", "Table", "HTML", "Button")


def after_install():
	"""Create default global settings and build the search index on install."""
	create_default_settings()
	seed_filter_fields()
	build_search_index()


def after_migrate():
	"""Seed defaults for settings fields that are unset.

	`Itemflow Settings` is intentionally **not** a fixture, so `bench
	migrate` never overwrites the per-site/per-company configuration. This hook
	fills only the fields added in newer versions that a site has not set yet.
	"""
	seed_missing_settings()
	seed_filter_fields()


def build_search_index():
	"""Build the n-gram search index for items that already exist."""
	try:
		from itemflow.search_index import rebuild_index

		result = rebuild_index()
		print(f"✓ ItemFlow: Search index -> {result}")
	except Exception:
		frappe.log_error(title="ItemFlow - after_install search index", message=frappe.get_traceback())


def _meta_defaults():
	"""Defaults declared on the DocType (single source of truth)."""
	defaults = {}
	for df in frappe.get_meta("Itemflow Settings").fields:
		if not df.fieldname or df.fieldtype in SKIP_FIELDTYPES:
			continue
		if df.default in (None, ""):
			continue
		defaults[df.fieldname] = df.default
	return defaults


def create_default_settings():
	"""Create the settings document on install, from the DocType defaults."""
	if frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
		print("✓ ItemFlow: Settings already exist")
		return

	doc = frappe.new_doc("Itemflow Settings")
	for field, value in _meta_defaults().items():
		doc.set(field, value)
	doc.insert(ignore_permissions=True)
	if not frappe.flags.in_test:
		frappe.db.commit()
	print("✓ ItemFlow: Default settings created")


def seed_missing_settings():
	"""Fill only unset settings fields from the DocType defaults.

	Never overwrites values chosen by an administrator (including `0`/`False`):
	only fields with no stored value (absent/NULL) are seeded.
	"""
	if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
		create_default_settings()
		return

	defaults = _meta_defaults()
	current = frappe.db.get_singles_dict("Itemflow Settings") or {}
	missing = {field: value for field, value in defaults.items() if current.get(field) in (None, "")}
	if not missing:
		return

	for field, value in missing.items():
		frappe.db.set_single_value("Itemflow Settings", field, value)
	frappe.clear_cache()
	if not frappe.flags.in_test:
		frappe.db.commit()
	print(f"✓ ItemFlow: Seeded {len(missing)} missing settings field(s)")


def seed_filter_fields():
	"""Sync extension filter rows without overwriting user choices.

	New hook fields are appended with their defaults. Existing rows keep
	``visible`` and ``show_as_column`` from the administrator; labels and order
	follow the hook. Rows for fields no longer registered are removed.
	"""
	if not frappe.db.exists("Itemflow Settings", "Itemflow Settings"):
		create_default_settings()

	settings = frappe.get_doc("Itemflow Settings", "Itemflow Settings")
	definitions = get_extra_filter_fields()
	existing = {row.fieldname: row for row in (settings.get("filters") or [])}
	valid = set()
	changed = False

	for definition in definitions:
		fieldname = definition["fieldname"]
		valid.add(fieldname)
		row = existing.get(fieldname)
		if row:
			if row.label != definition["label"]:
				row.label = definition["label"]
				changed = True
			if row.order != definition["order"]:
				row.order = definition["order"]
				changed = True
		else:
			settings.append(
				"filters",
				{
					"fieldname": fieldname,
					"label": definition["label"],
					"visible": definition["visible"],
					"order": definition["order"],
					"show_as_column": definition["show_as_column"],
				},
			)
			changed = True

	for row in list(settings.get("filters") or []):
		if row.fieldname not in valid:
			settings.remove(row)
			changed = True

	if changed:
		settings.save(ignore_permissions=True)
		print(f"✓ ItemFlow: Synced {len(definitions)} extended filter field(s)")
