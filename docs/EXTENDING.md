# Extending ItemFlow filters

Community ships two native filters: `brand` and `stock_uom`. A derived app can
register additional filterable `Item` fields, and optionally show them as grid
columns, without modifying Community.

---

## Hook

Register a list of field definitions in the derived app's `hooks.py`:

```python
itemflow_filter_fields = "acme_itemflow.filters.get_filter_fields"
```

The hook may also be a literal list, but a dotted path to a callable is easier
to keep dynamic.

```python
# acme_itemflow/filters.py
def get_filter_fields():
	return [
		{
			"fieldname": "custom_code",
			"label": "Custom Code",
			"order": 40,
			"visible": 0,
			"show_as_column": 1,
		},
		{
			"fieldname": "custom_size",
			"label": "Size",
			"order": 50,
			"visible": 1,
			"show_as_column": 0,
		},
	]
```

| Key | Required | Meaning |
|---|---|---|
| `fieldname` | Yes | Field on `Item`. Must already exist when the hook runs. |
| `label` | No | Filter label and column header. Falls back to the field label. |
| `order` | No | Position in the filter list. Defaults to `100`. |
| `visible` | No | Default visibility for the filter. `0` by default. |
| `show_as_column` | No | Show the value as an extra grid column. `0` by default. |

Only fields that exist on `Item` and use `Data`, `Link`, `Select`, `Currency`,
`Int`, `Float` or `Check` are accepted. Invalid or native fields are ignored.

---

## Settings

On `bench migrate`, Community synchronises the hook definitions with the
`Itemflow Filter` child table inside **Itemflow Settings**:

- New fields are appended with their hook defaults.
- Existing rows keep the administrator's `visible` and `show_as_column` values.
- Labels and order follow the hook.
- Rows for fields no longer registered are removed.

The maximum of 10 active filters includes native filters and visible extension
filters.

---

## Creating the fields

The derived app owns the custom fields. Ship them as fixtures, for example:

```python
# acme_itemflow/hooks.py
fixtures = [
	{
		"dt": "Custom Field",
		"filters": [["dt", "=", "Item"], ["fieldname", "like", "custom_%"]],
	},
]
```

Fixtures are synced before `after_migrate`, so the fields exist by the time
Community validates the hook definitions.

---

## UI behaviour

- Visible filters appear in the **Filters** panel.
- Fields with `show_as_column = 1` and `visible = 1` appear as extra columns in
  the item grid.
- Filter values are sent to the backend as prefix filters, the same way native
  `brand` and `stock_uom` filters work.
- Community never imports the derived app. If the derived app is removed, its
  fields and settings rows are ignored or removed safely.

---

## Deploying a derived app

The derived app must declare ItemFlow as a required app:

```python
# acme_itemflow/hooks.py
required_apps = ["itemflow"]
```

Install ItemFlow before the derived app. For a reproducible production build,
keep both in the bench app manifest:

```json
[
	{
		"url": "https://github.com/frappe/erpnext.git",
		"branch": "version-16"
	},
	{
		"url": "https://github.com/TheManuNext/itemflow-community.git",
		"branch": "v2.8.1"
	},
	{
		"url": "https://github.com/your-org/acme-itemflow.git",
		"branch": "v1.0.0"
	}
]
```

- Pin release tags or commits rather than a moving branch.
- Private derived apps need a read-only deploy key or a build secret. Never put
  a token in the manifest or in the image.
- Keep the same order in the site's `installed_apps` list:

```json
"installed_apps": ["frappe", "erpnext", "itemflow", "acme_itemflow"]
```

For a new site:

```bash
bench new-site your-site --install-app itemflow
bench --site your-site install-app acme_itemflow
bench --site your-site migrate
bench build
bench restart
```

`bench` also keeps a `sites/apps.json` registry with repo resolution metadata.
It is not the authoritative list of apps installed on a site; the site's
`installed_apps` configuration and the installed-applications table are. Do not
edit `sites/apps.json` by hand during a deployment.

Derived apps own their fixtures and must create their custom fields before
`bench migrate` runs Community's filter seeding.
