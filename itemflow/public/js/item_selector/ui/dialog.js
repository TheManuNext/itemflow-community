/**
 * ItemFlow — catalogue host.
 *
 * Renders the same template (search bar, filters, category tree, items grid) in
 * one of two hosts:
 *   - Modal    -> `frappe.ui.Dialog` (modes "add" / "edit").
 *   - Inline   -> mounted inside a container provided by the Inventory Desk Page
 *                 (mode "view"), reusing the same markup and events.
 *
 * `create()` picks the host (modal unless `selector.container` is set);
 * `_createInline()` stubs the modal API so tree.js/renderer.js keep working
 * unchanged. The read-only gating (no Qty column, no selection footer) lives in
 * renderer.js / events.js keyed off `selector.mode === "view"`.
 */
import { ItemSelectorTree } from "./tree.js";
import { ItemSelectorItemsGrid } from "./items_grid.js";
import { icon } from "./icons.js";

export class ItemSelectorDialog {
	constructor(selector) {
		this.selector = selector;
		// Tree only in 'add' mode — not needed in 'edit' mode
		if (selector.mode !== "edit") {
			this.tree = new ItemSelectorTree(this);
		}
		this.itemsGrid = new ItemSelectorItemsGrid(this);
	}

	get enabledFilters() {
		return this.selector.config
			.getFilterDefinitions()
			.filter((definition) => definition.visible)
			.map((definition) => ({
				field: definition.fieldname,
				label: definition.label,
			}));
	}

	// Create the frappe.ui.Dialog and prepare the UI without showing it yet.
	// Call it before loading data (tree, etc.) so the DOM exists.
	create() {
		// Page mode (read-only): the catalogue is mounted inline in the container
		// provided by the page, reusing the same template/tree/grid.
		if (this.selector.container) {
			this._createInline();
			return;
		}

		const isEdit = this.selector.mode === "edit";

		this.dialog = new frappe.ui.Dialog({
			title: isEdit ? __("Document Items") : __("Item Catalogue"),
			size: "extra-large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "interface_area",
					options: this.getTemplate(),
				},
			],
			primary_action_label: isEdit ? __("Save Changes") : __("Add Selected Items"),
			primary_action: () => {
				// Mark the close as intentional so no confirmation is requested
				this._intentional_close = true;
				return isEdit
					? this.selector.executeUpdate()
					: this.selector.executeAddition();
			},
		});

		this.dialog.$wrapper.addClass("item-selector-modal");
		this.addToolbarActions();
		this.addClearButton();
		this.bindEvents();

		// Re-render when connectivity changes: external images are only shown
		// with an internet connection (see items_grid.js).
		$(window).on("online.itemflow offline.itemflow", () => {
			if (this.itemsGrid) this.itemsGrid.renderCurrentPage();
		});

		// Enter shortcut: confirms the selection from the search input or a qty input.
		// It only activates when items are selected, to avoid accidental triggers.
		this.dialog.$wrapper.on("keydown.item-selector", (e) => {
			if (e.key !== "Enter") return;
			const $target = $(e.target);
			if (!$target.is("#item-search-input") && !$target.is(".qty-input")) return;
			const count = Object.keys(this.selector.selected_items).length;
			if (count > 0) {
				e.preventDefault();
				isEdit ? this.selector.executeUpdate() : this.selector.executeAddition();
			}
		});

		// On close: if there is a selection and the close was not intentional
		// (ESC/backdrop/X), ask for confirmation so the selection is not lost.
		// Do not call destroy() here: the bulk adder may still be processing in
		// the background, and destroy() would clear selected_items, causing
		// pending batches to fail.
		this.dialog.$wrapper.on("hidden.bs.modal", () => {
			const selectionCount = Object.keys(this.selector.selected_items).length;
			if (!isEdit && !this._intentional_close && selectionCount > 0) {
				this._confirmDiscardSelection(selectionCount, isEdit);
				return;
			}
			this._cleanupListeners(isEdit);
		});
	}

	// Mount the catalogue inline (Inventory page) instead of a modal.
	// The host mimics the surface used by the rest of the code (`dialog.$wrapper`
	// + stubs). `$wrapper` points to the page root, which contains the
	// `.item-selector-container`, so descendant lookups in
	// tree.js/renderer.js/dialog.js continue to work unchanged.
	_createInline() {
		const $root = $(this.selector.container).addClass("itemflow-inventory-page");
		$root.html(this.getTemplate());

		this.dialog = {
			$wrapper: $root,
			show() {},
			hide() {},
			set_primary_action() {},
			enable_primary_action() {},
			disable_primary_action() {},
			get_field() {
				return null;
			},
		};

		this.addToolbarActions();
		this.bindEvents();

		// Re-render when connectivity changes (external images). off() first:
		// the page may be remounted without destroying the previous listener.
		$(window)
			.off("online.itemflow offline.itemflow")
			.on("online.itemflow offline.itemflow", () => {
				if (this.itemsGrid) this.itemsGrid.renderCurrentPage();
			});
	}

	_confirmDiscardSelection(selectionCount, isEdit) {
		let handled = false;
		const d = new frappe.ui.Dialog({
			title: __("Discard selection?"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "msg",
					options: `<p>${__(
						"You have {0} item(s) selected but not added yet.",
						[selectionCount]
					)}</p>`,
				},
			],
			primary_action_label: __("Discard & Close"),
			primary_action: () => {
				handled = true;
				d.hide();
				this._intentional_close = true;
				this.selector.selected_items = {};
				this._cleanupListeners(isEdit);
			},
			secondary_action_label: __("Keep editing"),
			secondary_action: () => {
				handled = true;
				d.hide();
				this.dialog.show();
			},
		});
		// ESC/backdrop on the warning is equivalent to "Keep editing" (do not discard by accident)
		d.$wrapper.on("hidden.bs.modal", () => {
			if (!handled) {
				this.dialog.show();
			}
		});
		d.show();
	}

	_cleanupListeners(isEdit) {
		const $w = this.dialog.$wrapper;
		$w.find("#item-search-input").off();
		$w.find("#clear-search-btn").off();
		$w.find(".filter-input").off();
		$w.find(".filter-clear-btn").off();
		$w.find(".advanced-toggle-btn").off();
		$w.find("#advanced-filters-collapse").off("show.bs.collapse hide.bs.collapse");
		$w.find(".clear-selection-btn").off();
		if (!isEdit) {
			$w.find(".refresh-btn").off();
			$w.find(".material-request-btn").off();
			$w.find("#if-company-select").off();
			$w.find(".tree-toggle-btn").off();
			$w.find(".tree-restore-btn").off();
			$w.find(".if-tree-open-btn").off();
			$w.find(".if-tree-overlay").off();
			$w.off("click", ".group-link");
		}
		$w.find("#in-stock-toggle").off();
		$w.find("#restock-toggle").off();
		$w.off("keydown.item-selector");
		$(window).off("online.itemflow offline.itemflow");
		// Restore focus to the element that opened the modal (accessibility).
		try {
			this._last_focused?.focus?.();
		} catch (_e) {
			// the element may have disappeared; ignore
		}
		this._last_focused = null;
	}

	// Make the dialog visible (call after the tree has loaded)
	show() {
		// Remember the focused element so it can be restored on close (accessibility).
		this._last_focused = document.activeElement;
		this.dialog.show();
		// Focus the search input when Bootstrap finishes its opening animation.
		// .one() is used to avoid accumulating handlers across successive openings.
		this.dialog.$wrapper.one("shown.bs.modal", () => {
			this.dialog.$wrapper.find("#item-search-input").focus();
		});
	}

	// Catalogue utility actions (add mode only), in the top toolbar.
	addToolbarActions() {
		if (this.selector.mode === "edit") return;

		const $actions = this.dialog.$wrapper.find("#catalog-toolbar-actions");
		if (!$actions.length) return;

		if (this.selector.mode === "view") {
			this.addCompanyFilter($actions);
		}

		// The Material Request button does not apply to read-only mode (Inventory page).
		if (this.selector.mode !== "view") {
			const $materialRequestBtn = $(`
            <button class="btn btn-sm btn-secondary material-request-btn" type="button">
                ${icon("file-text", "sm")} ${__("Material Request")}
            </button>
        `);
			$actions.append($materialRequestBtn);
			$materialRequestBtn.on("click", () => {
				frappe.new_doc("Material Request");
			});
		}

		const isView = this.selector.mode === "view";
		const $refreshBtn = $(`
            <button class="btn btn-sm btn-secondary refresh-btn${
				isView ? " if-refresh-icon" : ""
			}" type="button" title="${__("Refresh")}" aria-label="${__("Refresh")}">
                ${icon("refresh-cw", "sm")}${isView ? "" : ` ${__("Refresh")}`}
            </button>
        `);
		$actions.append($refreshBtn);
		$refreshBtn.on("click", () => this.refreshAll());
	}

	// Read-only Inventory page: company selector in the catalogue toolbar.
	// The option list comes from the backend, already filtered by permissions.
	addCompanyFilter($actions) {
		const companies = this.selector.getCompanies();
		if (!companies.length) return;

		const $group = $('<div class="if-company-filter"></div>');
		const $label = $(
			`<label class="if-company-filter-label" for="if-company-select">${__(
				"Select Company"
			)}</label>`
		);
		const $control = $('<div class="if-company-control"></div>').appendTo($group);

		const control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Select",
				fieldname: "company",
				options: companies,
			},
			parent: $control[0],
			only_input: true,
		});

		control.refresh();
		control.$input.attr("id", "if-company-select");
		control.set_value(this.selector.getCompany());

		control.df.change = async () => {
			const company = control.get_value() || "";
			if (company === this.selector.getCompany()) return;

			try {
				const context = await this.selector.setCompany(company);
				if (!context) return;

				const resolved = context.company || "";
				if (resolved && resolved !== company) {
					control.set_value(resolved);
				}
			} catch (e) {
				frappe.msgprint({
					title: __("Company"),
					message: __("You do not have permission for this company."),
					indicator: "red",
				});
				control.set_value(this.selector.getCompany() || "");
			}
		};

		$group.prepend($label);
		$actions.append($group);
	}

	addClearButton() {
		const isEdit = this.selector.mode === "edit";
		const $footer = this.dialog.$wrapper.find(".modal-footer");

		// Footer: summary on the left, actions (Clear/Reset + primary) on the right.
		$footer.css({ display: "flex", "align-items": "center", width: "100%" });

		const $summaryDiv = $(
			'<div id="items-summary" style="padding: 4px 14px; font-size: 0.875rem; white-space: nowrap; background: var(--bg-light-gray); border-radius: 6px; margin-right: auto;"></div>'
		);
		$footer.prepend($summaryDiv);

		// Secondary button next to the primary button
		const $primaryBtn = $footer.find(".btn-modal-primary");

		if (isEdit) {
			// "Reset Quantities" button — restores the document's original quantities
			const $resetBtn = $(`
                <button class="btn btn-sm btn-secondary clear-selection-btn" style="margin-right:8px;">
                    ${icon("undo-2", "sm")} ${__("Reset Quantities")}
                </button>
            `);
			$resetBtn.insertBefore($primaryBtn);
			$resetBtn.on("click", () => {
				frappe.confirm(
					__("Reset all quantities to their current document values?"),
					async () => {
						await this.itemsGrid.loadDocumentItems();
						frappe.show_alert(
							{ message: __("Quantities reset"), indicator: "blue" },
							3
						);
					}
				);
			});
		} else {
			// "Clear Selection" button — next to the primary "Add Selected Items" button
			const $clearBtn = $(`
                <button class="btn btn-sm btn-secondary clear-selection-btn" style="margin-right:8px;">
                    ${icon("trash-2", "sm")} ${__("Clear Selection")}
                </button>
            `);
			$clearBtn.insertBefore($primaryBtn);
			$clearBtn.on("click", () => this.clearSelection());
		}
	}

	async refreshAll() {
		const $btn = this.dialog.$wrapper.find(".refresh-btn");
		$btn.prop("disabled", true).find("svg").addClass("icon-spin");

		try {
			// Invalidate the server-side cache (available to any user with Item permission)
			await frappe.xcall("itemflow.api.invalidate_cache");

			// Reload settings, ignoring the boot cache
			await this.selector.config.reload(true);

			// Clear client-side caches
			this.selector.priceService.clearCache();
			this.selector.stockService.clearCache();
			this.selector.metaService.clearCache();
			this.tree.clearCache();

			// Reload the category tree
			await this.tree.loadGroups();

			frappe.show_alert({ message: __("Catalogue refreshed"), indicator: "green" }, 3);
		} catch (e) {
			frappe.show_alert({ message: __("Error refreshing catalogue"), indicator: "red" }, 3);
		} finally {
			$btn.prop("disabled", false).find("svg").removeClass("icon-spin");
		}
	}

	clearSelection() {
		const count = Object.keys(this.selector.selected_items).length;
		if (count > 0) {
			frappe.confirm(
				__("Are you sure you want to clear {0} selected items?", [count]),
				() => {
					this.selector.selected_items = {};
					this.itemsGrid.renderCurrentPage();
					this.updateSelectedCount();
					frappe.show_alert({ message: __("Selection cleared"), indicator: "blue" }, 3);
				}
			);
		}
	}

	clearTreeSelection() {
		this.dialog.$wrapper.find(".group-link").removeClass("active");
	}

	clearSearch() {
		this.dialog.$wrapper.find("#item-search-input").val("");
	}

	_collapseTree() {
		const $w = this.dialog.$wrapper;
		$w.find("#tree-sidebar-col").addClass("d-none");
		$w.find("#tree-restore-col").addClass("d-flex").removeClass("d-none");
		$w.find("#items-container").removeClass("col-8").addClass("col-12");
	}

	_expandTree() {
		const $w = this.dialog.$wrapper;
		$w.find("#tree-sidebar-col").removeClass("d-none");
		$w.find("#tree-restore-col").removeClass("d-flex").addClass("d-none");
		$w.find("#items-container").removeClass("col-12").addClass("col-8");
	}

	/* ---- Mobile mode: the category tree is presented as a drawer ---- */

	// Matches the stylesheet breakpoint (tablet + mobile).
	_isMobile() {
		return window.matchMedia("(max-width: 991.98px)").matches;
	}

	_openTreeDrawer() {
		this.dialog.$wrapper.find(".item-selector-container").addClass("if-tree-open");
	}

	_closeTreeDrawer() {
		this.dialog.$wrapper.find(".item-selector-container").removeClass("if-tree-open");
	}

	bindEvents() {
		const self = this;
		const isEdit = this.selector.mode === "edit";
		const $wrapper = this.dialog.$wrapper;
		const $searchInput = $wrapper.find("#item-search-input");
		const $clearBtn = $wrapper.find("#clear-search-btn");

		// Category tree toggle (add mode only)
		if (!isEdit) {
			const TREE_KEY = "itemflow-tree-collapsed";
			// The persisted collapsed state only applies to desktop; on mobile the
			// tree is a drawer that starts closed.
			if (!this._isMobile() && localStorage.getItem(TREE_KEY) === "1") {
				this._collapseTree();
			}
			// Mobile: open/close the drawer (closed by the chevron, the overlay
			// and when selecting a category group).
			$wrapper.find(".if-tree-open-btn").on("click", () => this._openTreeDrawer());
			$wrapper.find(".if-tree-overlay").on("click", () => this._closeTreeDrawer());
			$wrapper.on("click", ".group-link", () => this._closeTreeDrawer());
			$wrapper.find(".tree-toggle-btn").on("click", () => {
				if (this._isMobile()) {
					this._closeTreeDrawer();
					return;
				}
				this._collapseTree();
				localStorage.setItem(TREE_KEY, "1");
			});
			$wrapper.find(".tree-restore-btn").on("click", () => {
				this._expandTree();
				localStorage.setItem(TREE_KEY, "0");
			});
		}

		// Hide the X button while the search is empty (initial state)
		$clearBtn.hide();
		$wrapper.find(".filter-clear-btn").hide();

		const MIN_SEARCH_LENGTH = 3;
		const debouncedSearch = frappe.utils.debounce(function (val) {
			if (isEdit) {
				self.itemsGrid.filterDocumentItems(val);
			} else {
				// In add mode, overly short terms are not queried (noise + full
				// scan); an empty term still lists the catalogue.
				if (val.length > 0 && val.length < MIN_SEARCH_LENGTH) {
					return;
				}
				self.clearTreeSelection();
				self.itemsGrid.state.label = null;
				self.itemsGrid.searchItems(val);
			}
		}, 300);

		const debouncedFilter = frappe.utils.debounce(function (field, val) {
			self.itemsGrid.state.filters[field] = val;
			self.itemsGrid.state.page = 1;
			self.itemsGrid.renderCurrentPage();
		}, 300);

		// Debounced search + immediate X visibility (no debounce)
		$searchInput.on("input", function () {
			const val = this.value.trim();
			$clearBtn.toggle(this.value.length > 0);
			debouncedSearch(val);
		});

		// Button to clear the search
		$clearBtn.on("click", function () {
			$searchInput.val("").focus();
			$clearBtn.hide();
			if (isEdit) {
				self.itemsGrid.filterDocumentItems("");
			} else {
				self.clearTreeSelection();
				self.itemsGrid.state.label = null;
				self.itemsGrid.searchItems("");
			}
		});

		// Advanced filters (collapsible panel)
		$wrapper.find(".filter-input").each(function () {
			const $input = $(this);
			const $clear = $wrapper.find(`#clear-filter-${$input.data("field")}`);
			const field = $input.data("field");

			$input.on("input", function () {
				const val = this.value.trim();
				$clear.toggle(this.value.length > 0);
				debouncedFilter(field, val);
				self._updateFiltersBadge();
			});

			$clear.on("click", function () {
				$input.val("").focus();
				$clear.hide();
				self.itemsGrid.state.filters[field] = "";
				self.itemsGrid.state.page = 1;
				self.itemsGrid.renderCurrentPage();
				self._updateFiltersBadge();
			});
		});

		// Keep aria-expanded in sync with the collapse state
		$wrapper.find("#advanced-filters-collapse").on("show.bs.collapse hide.bs.collapse", function () {
			$wrapper.find(".advanced-toggle-btn").attr("aria-expanded", $(this).hasClass("show"));
		});

		// Open the panel if filters are already active, and refresh the badge
		if (Object.values(self.itemsGrid.state.filters || {}).some((v) => (v || "").trim() !== "")) {
			$wrapper.find("#advanced-filters-collapse").addClass("show");
			$wrapper.find(".advanced-toggle-btn").attr("aria-expanded", "true");
		}
		self._updateFiltersBadge();
	}

	_updateFiltersBadge() {
		const active = Object.values(this.itemsGrid.state.filters || {}).filter(
			(value) => (value || "").trim() !== ""
		).length;
		this.dialog.$wrapper
			.find(".filters-count-badge")
			.text(active)
			.toggleClass("d-none", active === 0);
	}

	getTemplate() {
		const isEdit = this.selector.mode === "edit";
		const searchPlaceholder = isEdit
			? __("Filter by item name or code...")
			: __("Search by item name, code or number...");
		const enabledFilters = this.enabledFilters;

		const renderFilterInput = (cfg) => `
            <div class="advanced-filter-item">
                <label class="small text-muted mb-0" for="filter-${cfg.field}">${cfg.label}</label>
                <div class="input-group input-group-sm search-filter-input">
                    <input type="text"
                        class="form-control filter-input"
                        id="filter-${cfg.field}"
                        data-field="${cfg.field}"
                        placeholder="${cfg.label}">
                    <button class="btn btn-outline-secondary btn-sm filter-clear-btn" type="button" id="clear-filter-${cfg.field}">
                        ${icon("x", "sm")}
                    </button>
                </div>
            </div>`;

		const searchInput = `
            <div class="input-group input-group-sm search-filter-input search-input-primary">
                <input type="text"
                    class="form-control"
                    id="item-search-input"
                    placeholder="${searchPlaceholder}">
                <button class="btn btn-outline-secondary btn-sm" type="button" id="clear-search-btn">
                    ${icon("x", "sm")}
                </button>
            </div>`;

		const filtersToggle = `
            <button class="btn btn-sm btn-default advanced-toggle-btn" type="button"
                data-toggle="collapse" data-target="#advanced-filters-collapse"
                aria-expanded="false" aria-controls="advanced-filters-collapse">
                ${icon("funnel", "sm")} ${__("Filters")}
                <span class="badge badge-secondary filters-count-badge d-none">0</span>
            </button>`;

		const filtersPanel = `
            <div class="collapse" id="advanced-filters-collapse">
                <div class="advanced-filters-grid">
                    ${enabledFilters.map(renderFilterInput).join("")}
                </div>
            </div>`;

		return `
        <div class="item-selector-container">
            ${
                !isEdit
                    ? `<div class="if-tree-overlay" aria-hidden="true"></div>`
                    : ""
            }
            <div class="search-bar-container">
                <div class="search-filter-row">
                    ${searchInput}
                    ${
                        !isEdit
                            ? `<button class="btn btn-sm btn-default if-tree-open-btn d-lg-none" type="button">
                                ${icon("list-tree", "sm")} ${__("Categories")}
                            </button>`
                            : ""
                    }
                    ${filtersToggle}
                    <div class="catalog-toolbar-actions" id="catalog-toolbar-actions"></div>
                </div>
                ${filtersPanel}
                <div id="search-result-count" class="search-result-count sr-only" role="status" aria-live="polite"></div>
            </div>
            <div class="row flex-nowrap">
                ${
					!isEdit
						? `
                <div class="col-4 flex-shrink-0" id="tree-sidebar-col">
                    <div class="d-flex align-items-center justify-content-between pb-1 mb-1 border-bottom">
                        <small class="text-muted">${__("Categories")}</small>
                        <button class="btn btn-sm btn-link p-0 tree-toggle-btn" title="${__(
							"Hide categories"
						)}">
                            ${icon("chevron-left", "sm", "text-muted")}
                        </button>
                    </div>
                    <div id="tree-container">
                        <div class="text-center p-3">
                            <div class="spinner-border spinner-border-sm if-text"></div>
                            <p class="mt-2 text-muted small mb-0">${__("Loading...")}</p>
                        </div>
                    </div>
                </div>
                <div class="d-none align-items-start pt-1" id="tree-restore-col" style="padding-left: 6px; padding-right: 6px;">
                    <button class="btn btn-sm btn-link p-0 tree-restore-btn" title="${__(
						"Show categories"
					)}">
                        ${icon("chevron-right", "sm", "text-muted")}
                    </button>
                </div>`
						: ""
				}
                <div class="${isEdit ? "col-12" : "col-8"} flex-grow-1" id="items-container">
                    <div class="text-center p-4 text-muted">
                        <div class="spinner-border spinner-border-sm if-text"></div>
                        <p class="mt-2 mb-0">${__("Loading...")}</p>
                    </div>
                </div>
            </div>
        </div>`;
	}

	updateSelectedCount() {
		const count = Object.keys(this.selector.selected_items).length;
		const isEdit = this.selector.mode === "edit";

		if (isEdit) {
			const hasChanges = this._hasEditChanges();
			if (hasChanges) {
				this.dialog.set_primary_action(__("Save Changes ({0})", [count]), () =>
					this.selector.executeUpdate()
				);
				this.dialog.enable_primary_action();
			} else {
				this.dialog.set_primary_action(__("Close"), () => this.dialog.hide());
				this.dialog.enable_primary_action();
			}
		} else {
			const label =
				count > 0 ? __("Add Selected Items ({0})", [count]) : __("Add Selected Items");
			this.dialog.set_primary_action(label, () => this.selector.executeAddition());
			count === 0
				? this.dialog.disable_primary_action()
				: this.dialog.enable_primary_action();
		}

		if (this.itemsGrid) {
			this.itemsGrid.updateTotals();
		}
	}

	_hasEditChanges() {
		const snapshot = this.selector._edit_snapshot || {};
		const current = this.selector.selected_items;

		for (const code of Object.keys(snapshot)) {
			const originalQty = snapshot[code];
			const currentQty = (current[code] || {}).qty || 0;
			if (currentQty !== originalQty) return true;
		}
		for (const code of Object.keys(current)) {
			if ((current[code].qty || 0) > 0 && !(code in snapshot)) return true;
		}
		return false;
	}

	hide() {
		this.dialog.hide();
	}
}
