/**
 * ItemFlow — item selector orchestrator.
 *
 * One core, three modes:
 *   - "add"  (default): modal on a supported doctype; adds rows to `frm.doc`.
 *   - "edit"          : modal on a supported doctype; reviews/edits its rows.
 *   - "view"          : inline (Desk Page), read-only catalogue. There is no `frm`,
 *                       so a `view_context` is built from `get_inventory_context`.
 *
 * The host (modal vs inline) is decided in `ui/dialog.js` from `options.container`.
 */
import { ItemSelectorConfig } from './config.js';
import { ItemSelectorStockService } from './services/stock_service.js';
import { ItemSelectorPriceService } from './services/price_service.js';
import { ItemSelectorMetaService } from './services/meta_service.js';
import { ItemSelectorBulkAdder } from './services/bulk_adder.js';
import { ItemSelectorDialog } from './ui/dialog.js';
import { icon } from './ui/icons.js';
import { chunk } from './ui/items_grid/domain.js';
import { makeViewContext } from './view_context.js';

export class ItemSelectorPlus {
    constructor(frm, options = {}) {
        this.frm = frm;
        this.mode = options.mode || 'add';
        this.container = options.container || null;
        this.selected_items = {};
        this._edit_original_codes = new Set();
        this.settings = null;
        this.config = new ItemSelectorConfig();
        // `view` mode only: initial company and request token to discard
        // out-of-order responses when the user switches companies quickly.
        this._company_option = options.company || null;
        this._companyRequestId = 0;
        this.viewContext = null;
    }

    async init() {
        try {
            this.settings = await this.config.load();
            this.config.debug('Settings loaded:', this.settings);

            // `view` mode (Inventory page): there is no form, so a read-only
            // context is built from ERPNext's standard singles
            // (Selling Settings / user defaults).
            if (this.mode === 'view' && !this.frm) {
                await this._resolveViewContext(this._company_option);
            }

            this.stockService = new ItemSelectorStockService(this.frm);
            this.priceService = new ItemSelectorPriceService(this.frm);
            this.metaService = new ItemSelectorMetaService(this.frm);

            this.dialog = new ItemSelectorDialog(this);
            this.dialog.create();

            if (this.mode === 'edit') {
                await this.dialog.itemsGrid.loadDocumentItems();
                this.dialog.show();
            } else {
                // Create the dialog in the DOM before loading the tree (needed to
                // access the container), but do not show it yet. The tree loads in
                // the background with its own spinner. Only when the tree finishes
                // is the dialog shown, avoiding the race condition where the user
                // interacts with an incomplete loading state.
                await this.dialog.tree.loadGroups();
                this.dialog.show();
            }
        } catch (e) {
            this.config.debug('Initialisation error:', e);
            frappe.msgprint({
                title: __('Error'),
                message: __('Failed to initialize Item Selector. Please refresh and try again.'),
                indicator: 'red'
            });
        }
    }

    async _resolveViewContext(company = null) {
        const context = (await frappe.xcall('itemflow.api.get_inventory_context', {
            company: company || null,
        })) || {};
        this.viewContext = context;
        this.frm = makeViewContext({
            company: context.company || '',
            priceList: context.price_list || null,
            buying: !!context.buying,
            warehouse: context.warehouse || '',
        });
    }

    getCompany() {
        return (this.frm && this.frm.doc && this.frm.doc.company) || '';
    }

    getCompanies() {
        return (this.viewContext && this.viewContext.companies) || [];
    }

    async setCompany(company) {
        if (this.mode !== 'view' || !this.frm || !this.frm.doc || !this.priceService) return null;

        // Rapid company changes can resolve out of order: only the latest
        // request is allowed to apply its context.
        this._companyRequestId += 1;
        const requestId = this._companyRequestId;

        const context = (await frappe.xcall('itemflow.api.get_inventory_context', {
            company: company || null,
        })) || {};

        if (requestId !== this._companyRequestId) return null;

        const doc = this.frm.doc;
        doc.company = context.company || '';
        doc.selling_price_list = context.buying ? null : context.price_list || null;
        doc.buying_price_list = context.buying ? context.price_list : null;
        doc.set_warehouse = context.warehouse || '';

        this.priceService.clearCache();
        this.stockService.clearCache();
        this.metaService.clearCache();

        const grid = this.dialog && this.dialog.itemsGrid;
        if (grid) {
            grid.state.contextVersion += 1;
            grid.state.page = 1;

            if (!doc.company) {
                grid.showNoCompanyMessage?.();
            } else {
                await grid.renderCurrentPage();
                grid.updateTotals?.();
            }
        }

        this.viewContext = context;
        return context;
    }

    updateSelection(item_code, data) {
        if (data.qty > 0) {
            this.selected_items[item_code] = data;
        } else {
            delete this.selected_items[item_code];
        }
        this.dialog.updateSelectedCount();
    }

    async executeAddition() {
        const codes = Object.keys(this.selected_items);

        if (codes.length === 0) {
            frappe.msgprint(__('Please select at least one item.'));
            return;
        }

        const maxItems = this.settings?.max_items || 15;
        if (codes.length > maxItems) {
            frappe.msgprint({
                title: __('Too Many Items'),
                message: __('Maximum {0} items allowed. You selected {1}.', [maxItems, codes.length]),
                indicator: 'red'
            });
            return;
        }

        // Check for out-of-stock items — skip for replenishment doctypes
        const skipStockWarnings = [
            'Purchase Order',
            'Material Request',
            'Supplier Quotation',
            'Purchase Invoice',
            'Purchase Receipt',
            'Stock Entry'
        ].includes(this.frm.doctype);

        if (!skipStockWarnings) {
            const confirmed = await this.confirmStockWarnings(codes);
            if (!confirmed) return;
        }

        // Check for duplicate items (already present in the document)
        const existingRows = this.frm.doc.items || [];
        const duplicateCodes = codes.filter(code => existingRows.some(r => r.item_code === code));
        for (const code of duplicateCodes) {
            const item = this.selected_items[code];
            const existingQty = existingRows
                .filter(r => r.item_code === code)
                .reduce((sum, r) => sum + (r.qty || 0), 0);
            const action = await this.showDuplicateItemDialog(code, item.name, item.qty, existingQty);
            if (action === 'cancel') return;
            this.selected_items[code]._action = action;
        }

        // Add in automatic batches with a progress bar (no confirmation).
        const chunkSize = Math.max(1, this.settings?.add_chunk_size || 10);

        // Proceed with the addition (intentional close: no confirmation requested)
        this.dialog._intentional_close = true;
        this.dialog.hide();

        // Wait for the item selector to be fully closed before showing the progress
        // dialog. Otherwise, Bootstrap backdrops overlap: the item selector's
        // (fade-out) and the progress one's (fade-in) are sequential, which can
        // make shown.bs.modal take >350ms → the fallback fires while
        // _isTransitioning=true → modal("hide") is ignored → the dialog gets stuck.
        await new Promise(resolve => {
            const $w = this.dialog.dialog.$wrapper;
            const fallback = setTimeout(resolve, 400);
            $w.one('hidden.bs.modal', () => { clearTimeout(fallback); resolve(); });
        });

        try {
            const result = await this._executeInChunks(codes, chunkSize);
            this.selected_items = {};
            this._showAddSummary(result, codes.length);
        } catch (e) {
            frappe.hide_progress();
            this.config.debug('Error adding items:', e);
            frappe.msgprint({
                title: __('Error'),
                message: __('Some items could not be added. Please check the console for details.'),
                indicator: 'red'
            });
        }
    }

    // Adds the selection in batches of `chunkSize` to the (unsaved) document,
    // updating a single progress dialog across batches. The document is not
    // saved between batches.
    async _executeInChunks(codes, chunkSize) {
        const batches = chunk(codes, chunkSize);
        const total = codes.length;
        let added = 0;
        const failed_items = [];
        const batch_serial_rows = [];

        this._showProgress(total);
        const progressShownPromise = this._progressShownPromise;

        for (let i = 0; i < batches.length; i++) {
            const adder = new ItemSelectorBulkAdder(this);
            const stats = await adder.execute(batches[i]);
            added += stats.added;
            failed_items.push(...stats.failed_items);
            batch_serial_rows.push(...(stats.batch_serial_rows || []));

            const done = Math.min((i + 1) * chunkSize, total);
            frappe.show_progress(
                __('Adding items'),
                done,
                total,
                __('Batch {0}/{1} ({2}/{3})', [i + 1, batches.length, done, total])
            );
            this.frm.refresh_field('items');
        }

        const cscript = this.frm.cscript;
        if (cscript && typeof cscript.calculate_taxes_and_totals === 'function') {
            await cscript.calculate_taxes_and_totals();
        }
        this.frm.refresh_field('items');
        this.frm.dirty();

        await progressShownPromise;
        frappe.hide_progress();

        // Mixed-condition pricing rules must see every added row.
        this._applyRuleOnOtherItems();

        // Serial/batch selection is deferred until the catalogue closed so it can
        // run one selector per row without fighting the progress dialog.
        if (batch_serial_rows.length) {
            await this._applyDeferredSerialBatch(batch_serial_rows);
        }

        return { added, failed: failed_items.length, failed_items };
    }

    // Port of `apply_rule_on_other_items` (transaction.js:2349): pricing rules
    // with mixed conditions update matching rows elsewhere in the document.
    _applyRuleOnOtherItems() {
        const cscript = this.frm.cscript;
        if (!cscript || typeof cscript.apply_rule_on_other_items !== 'function') return;

        const rule_rows = {};
        (this.frm.doc.items || []).forEach((row) => {
            if (row.apply_rule_on_other_items) rule_rows[row.name] = row;
        });

        if (Object.keys(rule_rows).length) {
            cscript.apply_rule_on_other_items(rule_rows);
        }
    }

    async _applyDeferredSerialBatch(rows) {
        for (const row of rows) {
            // The selector saves the document, which can replace the row
            // instances; always re-resolve by name before opening the dialog.
            const live = (this.frm.doc.items || []).find((d) => d.name === row.name) || row;
            if (!live.item_code) continue;
            if (live.serial_and_batch_bundle || cint(live.use_serial_batch_fields) === 1) {
                continue;
            }
            await this._showSerialBatchSelector(live);
        }
        this.frm.refresh_field('items');
    }

    _showSerialBatchSelector(row) {
        const frm = this.frm;
        return new Promise((resolve) => {
            if (typeof erpnext === 'undefined' || typeof erpnext.show_serial_batch_selector !== 'function') {
                resolve();
                return;
            }

            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            // Capture the selector instance so the promise settles when the
            // dialog closes (after its internal save) or when the user cancels.
            const Original = erpnext.SerialBatchPackageSelector;
            const restore = () => { erpnext.SerialBatchPackageSelector = Original; };
            const patched = typeof Original === 'function';

            if (patched) {
                erpnext.SerialBatchPackageSelector = class extends Original {
                    constructor(...args) {
                        super(...args);
                        const attach = () => {
                            if (this.dialog && this.dialog.$wrapper) {
                                this.dialog.$wrapper.one('hidden.bs.modal', finish);
                            } else {
                                setTimeout(attach, 50);
                            }
                        };
                        attach();
                    }
                };
            }

            try {
                erpnext.show_serial_batch_selector(
                    frm,
                    row,
                    () => {
                        frm.script_manager.trigger('qty', row.doctype, row.name);
                        if (!frm.doc.set_warehouse) {
                            frm.script_manager.trigger('warehouse', row.doctype, row.name);
                        }
                        // Without the dialog hook we can only settle here.
                        if (!patched) finish();
                    },
                    undefined,
                    true
                );
            } catch (e) {
                finish();
            } finally {
                if (patched) setTimeout(restore, 0);
            }
        });
    }

    _showProgress(total) {
        frappe.show_progress(__('Adding items'), 0, total, __('Starting...'));
        this._progressShownPromise = new Promise((resolve) => {
            const $w = frappe.cur_progress?.$wrapper;
            if ($w) {
                const fallback = setTimeout(resolve, 400);
                $w.one('shown.bs.modal', () => { clearTimeout(fallback); resolve(); });
            } else {
                resolve();
            }
        });
    }

    _showAddSummary(result, total) {
        if (result.failed > 0) {
            frappe.show_alert({
                message: __('Added {0} of {1} items. {2} failed.', [result.added, total, result.failed]),
                indicator: 'orange'
            }, 7);
        } else {
            frappe.show_alert({
                message: __('Successfully added {0} items', [result.added]),
                indicator: 'green'
            }, 5);
        }
    }

    async _refreshSelectedStock(codes) {
        // Re-query stock so warnings show exact figures
        try {
            this.stockService.clearCache();
            const stockMap = await this.stockService.getStockLevels(codes);
            codes.forEach(code => {
                if (this.selected_items[code]) {
                    this.selected_items[code].stock = stockMap[code] ?? 0;
                }
            });
        } catch (e) {
            this.config.debug('Stock refresh failed:', e);
        }
    }

    _classifyStockWarnings(codes) {
        const threshold = this.settings?.low_stock_threshold || 10;
        const outOfStock = [];
        const insufficient = [];
        const low = [];

		for (const code of codes) {
			const item = this.selected_items[code];
			// Non-stock items (services) do not take part in stock warnings.
			if (item.is_stock_item === 0 || item.is_stock_item === false) continue;
			const stock = item.stock ?? 0;
			const requested = item.qty;
			const row = { code, name: item.name, requested, available: stock };

            if (stock <= 0) {
                outOfStock.push(row);
            } else if (stock < requested) {
                insufficient.push(row);
            } else if (stock < threshold) {
                row.threshold = threshold;
                low.push(row);
            }
        }

        return { outOfStock, insufficient, low };
    }

	async confirmStockWarnings(codes) {
		await this._refreshSelectedStock(codes);
		const { outOfStock, insufficient, low } = this._classifyStockWarnings(codes);

		// Stock Settings.allow_negative_stock: do not block on insufficient stock.
		if (this.settings?.allow_negative_stock) {
			outOfStock.length = 0;
			insufficient.length = 0;
		}

        if (outOfStock.length > 0) {
            const ok = await this.showStockWarningDialog({
                title: __('Out of Stock'),
                message: __('No stock available. These items will be added anyway.'),
                variant: 'danger',
                primaryLabel: __('Add Anyway'),
                columns: [
                    { key: 'code', label: __('Item Code'), code: true },
                    { key: 'name', label: __('Item Name') },
                    { key: 'requested', label: __('Requested Qty') }
                ],
                rows: outOfStock
            });
            if (!ok) return false;
        }

        if (insufficient.length > 0) {
            const ok = await this.showStockWarningDialog({
                title: __('Insufficient Stock'),
                message: __('Requested quantity exceeds available stock for these items.'),
                variant: 'danger',
                primaryLabel: __('Add Anyway'),
                columns: [
                    { key: 'code', label: __('Item Code'), code: true },
                    { key: 'name', label: __('Item Name') },
                    { key: 'requested', label: __('Requested') },
                    { key: 'available', label: __('Available'), available: true }
                ],
                rows: insufficient
            });
            if (!ok) return false;
        }

        if (low.length > 0) {
            const ok = await this.showStockWarningDialog({
                title: __('Low Stock'),
                message: __(
                    'Available stock is below the low-stock threshold ({0}).',
                    [this.settings?.low_stock_threshold || 10]
                ),
                variant: 'warning',
                primaryLabel: __('Continue'),
                columns: [
                    { key: 'code', label: __('Item Code'), code: true },
                    { key: 'name', label: __('Item Name') },
                    { key: 'available', label: __('Available') },
                    { key: 'threshold', label: __('Threshold') }
                ],
                rows: low
            });
            if (!ok) return false;
        }

        return true;
    }

    showStockWarningDialog(config) {
        return new Promise(resolve => {
            const variant = config.variant === 'warning' ? 'warning' : 'danger';
            const alertClass = variant === 'danger' ? 'alert-danger' : 'alert-warning';
            const iconName = variant === 'danger' ? 'circle-alert' : 'triangle-alert';

            const header = config.columns.map(c => `<th>${c.label}</th>`).join('');
            const tableRows = config.rows.map(row => {
                const cells = config.columns.map(col => {
                    const raw = row[col.key];
                    if (col.available) {
                        const cls = row.available < row.requested
                            ? 'text-danger font-weight-bold'
                            : 'if-text-warning';
                        return `<td class="${cls}">${raw}</td>`;
                    }
                    const value = frappe.utils.escape_html(String(raw ?? ''));
                    return col.code ? `<td><code>${value}</code></td>` : `<td>${value}</td>`;
                }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');

            const d = new frappe.ui.Dialog({
                title: config.title,
                fields: [
                    {
                        fieldtype: 'HTML',
                        fieldname: 'msg',
                        options: `
                            <div class="alert ${alertClass}">
                                ${icon(iconName, "sm")} ${config.message}
                            </div>
                            <div style="max-height: 300px; overflow-y: auto;">
                                <table class="table table-bordered table-sm">
                                    <thead><tr>${header}</tr></thead>
                                    <tbody>${tableRows}</tbody>
                                </table>
                            </div>
                        `
                    }
                ],
                primary_action_label: config.primaryLabel || __('Add Anyway'),
                primary_action: () => { d.hide(); resolve(true); },
                secondary_action_label: __('Cancel'),
                secondary_action: () => { d.hide(); resolve(false); }
            });
            // Fallback: if the user closes with ESC, the backdrop or the X, resolve as cancel
            d.$wrapper.on('hidden.bs.modal', () => resolve(false));
            d.show();
        });
    }

    showDuplicateItemDialog(_item_code, item_name, new_qty, existing_qty) {
        return new Promise(resolve => {
            const d = new frappe.ui.Dialog({
                title: __('Item Already in Document'),
                fields: [{
                    fieldtype: 'HTML',
                    fieldname: 'msg',
                    options: `
                        <div class="alert alert-info">
                            <strong>${frappe.utils.escape_html(item_name)}</strong>
                            ${__('is already in this document with qty')} <strong>${existing_qty}</strong>.
                        </div>
                        <p>${__('What would you like to do with the new qty of')} <strong>${new_qty}</strong>?</p>
                    `
                }],
                primary_action_label: __('Add as New Line'),
                primary_action: () => { d.hide(); resolve('new_line'); },
                secondary_action_label: __('Add to Existing Line'),
                secondary_action: () => { d.hide(); resolve('merge'); }
            });
            d.$wrapper.find('.btn-modal-close').on('click', () => resolve('cancel'));
            d.$wrapper.on('hidden.bs.modal', () => resolve('cancel'));
            d.show();
        });
    }

    async executeUpdate() {
        const codes = Object.keys(this.selected_items);
        const grid = this.frm.get_field('items').grid;
        const doc_rows_map = this.dialog.itemsGrid.state.docRowsMap;

        // Update quantities and UOMs of selected items
        for (const code of codes) {
            const data = this.selected_items[code];
            const newQty = data.qty;
            const entry = doc_rows_map[code];
            if (!entry) continue;

            if (newQty <= 0) {
                // Remove all rows for this item_code
                const allNames = [entry.first_row.name, ...(entry.extra_names || [])];
                for (const rowName of allNames) {
                    const gridRow = grid.grid_rows_by_docname?.[rowName];
                    if (gridRow) gridRow.remove();
                }
            } else {
                const row = entry.first_row;
                const uomChanged = data.uom && data.uom !== row.uom;

                // Update UOM and conversion_factor if changed
                if (uomChanged) {
                    row.uom = data.uom;
                    row.conversion_factor = data.conversion_factor || 1;
                }

                // Update quantity
                row.qty = newQty;

                // Trigger ERPNext recalculation
                try {
                    const triggers = [
                        this.frm.script_manager.trigger('qty', row.doctype, row.name)
                    ];
                    if (uomChanged) {
                        triggers.push(this.frm.script_manager.trigger('uom', row.doctype, row.name));
                    }
                    await Promise.race([
                        Promise.all(triggers),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('qty trigger timeout')), 5000))
                    ]);

                    // Ensure ERPNext has not reset the UOM or conversion_factor
                    if (uomChanged) {
                        if (row.uom !== data.uom) {
                            row.uom = data.uom;
                        }
                        if (row.conversion_factor !== data.conversion_factor) {
                            row.conversion_factor = data.conversion_factor || 1;
                        }
                    }
                } catch (e) {
                    // Manual fallback if the trigger fails or times out
                    if (uomChanged) {
                        row.uom = data.uom;
                        row.conversion_factor = data.conversion_factor || 1;
                    }
                    row.amount = newQty * (row.rate || 0);
                    this.config.debug('qty/uom trigger warning:', e.message);
                }

                // Ensure a coherent amount
                row.amount = flt(row.qty) * flt(row.rate || 0);
                // Remove extra rows (merged duplicates)
                for (const rowName of (entry.extra_names || [])) {
                    const gridRow = grid.grid_rows_by_docname?.[rowName];
                    if (gridRow) gridRow.remove();
                }
            }
        }

        // Remove rows for items the user set to qty=0 (removed from selected_items)
        for (const code of this._edit_original_codes) {
            if (!this.selected_items[code]) {
                const entry = doc_rows_map[code];
                if (!entry) continue;
                const allNames = [entry.first_row.name, ...(entry.extra_names || [])];
                for (const rowName of allNames) {
                    const gridRow = grid.grid_rows_by_docname?.[rowName];
                    if (gridRow) gridRow.remove();
                }
            }
        }

        this.frm.refresh_field('items');
        this.frm.dirty();
        this.dialog._intentional_close = true;
        this.dialog.hide();

        frappe.show_alert({ message: __('Changes saved successfully'), indicator: 'green' }, 4);
    }

    // Method to clean up resources
    destroy() {
        this.selected_items = {};
        if (this.dialog) {
            this.dialog.hide();
        }
    }
}
