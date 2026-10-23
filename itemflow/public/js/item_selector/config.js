export const FILTER_FIELDS = ["brand", "stock_uom"];

const translate = (text) => (typeof __ === "function" ? __(text) : text);

const NATIVE_FILTER_DEFINITIONS = [
	{
		fieldname: "brand",
		label: translate("Brand"),
		order: 10,
		visible: 1,
		show_as_column: 0,
		native: true,
	},
	{
		fieldname: "stock_uom",
		label: translate("Stock UOM"),
		order: 20,
		visible: 1,
		show_as_column: 0,
		native: true,
	},
];

const FILTER_DEFAULTS = Object.fromEntries(
	FILTER_FIELDS.map((f) => [`show_filter_${f}`, 1])
);

export class ItemSelectorConfig {
	constructor() {
		this.settings = null;
		this.filterDefinitions = null;
		this.defaults = {
			low_stock_threshold: 10,
			default_qty: 1,
			max_items: 15,
			add_chunk_size: 10,
			enable_debug_mode: 0,
			default_warehouse: null,
			show_item_images: 1,
			show_brand: 1,
			button_style: "primary",
			check_order_button_style: "secondary",
			button_position: "top",
			allow_negative_stock: 0,
			enable_sales_order: 1,
			enable_quotation: 1,
			enable_sales_invoice: 1,
			enable_purchase_order: 1,
			enable_material_request: 1,
			enable_supplier_quotation: 0,
			enable_purchase_invoice: 0,
			enable_purchase_receipt: 0,
			enable_stock_entry: 1,
			...FILTER_DEFAULTS,
		};
	}

	async load(force = false) {
		// Try to read from the frappe.boot cache first (unless a reload is forced)
		const cached = force ? null : frappe.boot?.item_selector_settings;
		if (cached) {
			this.settings = { ...this.defaults, ...cached };
			this.filterDefinitions =
				cached.filter_definitions || this._definitionsFromSettings(this.settings);
			this.debug("Settings loaded from boot cache:", this.settings);
			return this.settings;
		}

		// Load from the document
		try {
			const doc = await frappe.db.get_doc(
				"Itemflow Settings",
				"Itemflow Settings"
			);
			if (doc) {
				this.settings = {
					low_stock_threshold:
						doc.low_stock_threshold ?? this.defaults.low_stock_threshold,
					default_qty: doc.default_qty ?? this.defaults.default_qty,
					max_items: doc.max_items ?? this.defaults.max_items,
					add_chunk_size: doc.add_chunk_size ?? this.defaults.add_chunk_size,
					enable_debug_mode: doc.enable_debug_mode ?? this.defaults.enable_debug_mode,
					default_warehouse: doc.default_warehouse || this.defaults.default_warehouse,
					show_item_images: doc.show_item_images ?? this.defaults.show_item_images,
					show_brand: doc.show_brand ?? this.defaults.show_brand,
					button_style: doc.button_style || this.defaults.button_style,
					check_order_button_style:
						doc.check_order_button_style || this.defaults.check_order_button_style,
					button_position: doc.button_position || this.defaults.button_position,
					allow_negative_stock:
						doc.allow_negative_stock ?? this.defaults.allow_negative_stock,
					enable_sales_order: doc.enable_sales_order ?? this.defaults.enable_sales_order,
					enable_quotation: doc.enable_quotation ?? this.defaults.enable_quotation,
					enable_sales_invoice:
						doc.enable_sales_invoice ?? this.defaults.enable_sales_invoice,
					enable_purchase_order:
						doc.enable_purchase_order ?? this.defaults.enable_purchase_order,
					enable_material_request:
						doc.enable_material_request ?? this.defaults.enable_material_request,
					enable_supplier_quotation:
						doc.enable_supplier_quotation ??
						this.defaults.enable_supplier_quotation,
					enable_purchase_invoice:
						doc.enable_purchase_invoice ?? this.defaults.enable_purchase_invoice,
					enable_purchase_receipt:
						doc.enable_purchase_receipt ?? this.defaults.enable_purchase_receipt,
					enable_stock_entry:
						doc.enable_stock_entry ?? this.defaults.enable_stock_entry,
					filters: doc.filters || [],
				};

				// Cargar flags individuales de filtros nativos
				FILTER_FIELDS.forEach((field) => {
					const key = `show_filter_${field}`;
					this.settings[key] = doc[key] ?? this.defaults[key];
				});

				this.filterDefinitions = this._definitionsFromSettings(this.settings);
				this.debug("Settings loaded from database:", this.settings);
			} else {
				this.settings = { ...this.defaults };
				this.filterDefinitions = this._definitionsFromSettings(this.settings);
				this.debug("Using default settings (no config found)");
			}
		} catch (e) {
			console.warn("[ItemSelectorPlus] Error loading settings, using defaults:", e);
			this.settings = { ...this.defaults };
			this.filterDefinitions = this._definitionsFromSettings(this.settings);
		}

		return this.settings;
	}

	get(key) {
		if (!this.settings) return this.defaults[key];
		return this.settings[key] !== undefined ? this.settings[key] : this.defaults[key];
	}

	isDoctypeEnabled(doctype) {
		const keyMap = {
			"Sales Order": "enable_sales_order",
			Quotation: "enable_quotation",
			"Sales Invoice": "enable_sales_invoice",
			"Purchase Order": "enable_purchase_order",
			"Material Request": "enable_material_request",
			"Supplier Quotation": "enable_supplier_quotation",
			"Purchase Invoice": "enable_purchase_invoice",
			"Purchase Receipt": "enable_purchase_receipt",
			"Stock Entry": "enable_stock_entry",
		};
		const key = keyMap[doctype];
		if (!key) return true; // doctypes no configurados se permiten por defecto
		return !!this.get(key);
	}

	_definitionsFromSettings(settings) {
		const native = NATIVE_FILTER_DEFINITIONS.map((definition) => ({
			...definition,
			visible:
				settings?.[`show_filter_${definition.fieldname}`] ?? definition.visible,
		}));
		const extra = (settings?.filters || [])
			.map((row) => ({
				fieldname: row.fieldname,
				label: row.label || row.fieldname,
				order: row.order ?? 100,
				visible: !!row.visible,
				show_as_column: !!row.show_as_column,
				native: false,
			}))
			.filter((definition) => definition.fieldname);
		return this._mergeDefinitions(native, extra);
	}

	_mergeDefinitions(...groups) {
		const byField = new Map();
		for (const group of groups) {
			for (const definition of group) {
				if (definition?.fieldname) {
					byField.set(definition.fieldname, definition);
				}
			}
		}
		return [...byField.values()].sort(
			(a, b) =>
				(a.order ?? 100) - (b.order ?? 100) ||
				a.fieldname.localeCompare(b.fieldname)
		);
	}

	getFilterDefinitions() {
		if (this.filterDefinitions?.length) return this.filterDefinitions;
		return this._definitionsFromSettings(this.settings || this.defaults);
	}

	getColumnFields() {
		return this.getFilterDefinitions().filter(
			(definition) => definition.show_as_column && definition.visible
		);
	}

	isFilterEnabled(field) {
		const definition = this.getFilterDefinitions().find(
			(candidate) => candidate.fieldname === field
		);
		if (definition) return !!definition.visible;
		return !!this.get(`show_filter_${field}`);
	}

	debug(...args) {
		if (this.get("enable_debug_mode")) {
			console.log("[ItemSelectorPlus]", ...args);
		}
	}

	// Method to force a configuration reload (ignores the boot cache)
	async reload(force = true) {
		this.settings = null;
		this.filterDefinitions = null;
		return await this.load(force);
	}
}
