/**
 * Rendering for the items grid (catalogue / search / edit modes).
 *
 * Holds no state of its own: `selector`, `dialog` and `state` are read from the
 * grid facade. Kept as a faithful extraction of the original methods.
 */
import { totalPages as computeTotalPages } from "./pagination.js";
import { icon } from "../icons.js";

export class ItemsGridRenderer {
	constructor(grid) {
		this.grid = grid;
	}

	get selector() {
		return this.grid.selector;
	}

	get dialog() {
		return this.grid.dialog;
	}

	get state() {
		return this.grid.state;
	}

	_isRestockDoctype() {
		return this.grid._isRestockDoctype();
	}

	_isNoPriceDoctype() {
		return this.grid._isNoPriceDoctype();
	}

	_isStockItem(item) {
		return this.grid._isStockItem(item);
	}

	_getUomInfo(item_code) {
		return this.grid._getUomInfo(item_code);
	}

	_getConversionFactor(item_code, uom) {
		return this.grid._getConversionFactor(item_code, uom);
	}

	_getDefaultUom(item) {
		return this.grid._getDefaultUom(item);
	}

	_fallbackUom() {
		return this.grid._fallbackUom();
	}

	_currency() {
		return this.grid._currency();
	}

	_bindEvents(...args) {
		return this.grid._bindEvents(...args);
	}

	renderCurrentPage(...args) {
		return this.grid.renderCurrentPage(...args);
	}


	_renderUOMSelect(item_code, selected_uom) {
		const info = this._getUomInfo(item_code);
		let uoms = [...(info.uoms || [])];
		const safeCode = frappe.utils.escape_html(item_code);

		// Ensure the selected UOM is always available in the dropdown
		if (selected_uom && !uoms.some((u) => u.uom === selected_uom)) {
			uoms.push({
				uom: selected_uom,
				conversion_factor: this._getConversionFactor(item_code, selected_uom) || 1,
			});
		}

		if (uoms.length <= 1) {
			return `<span class="text-muted small uom-label">${frappe.utils.escape_html(
				selected_uom
			)}</span>`;
		}

		// Read-only mode (Inventory page): the UOM is informative, not editable.
		if (this.selector.mode === "view") {
			return `<span class="text-muted small uom-label">${frappe.utils.escape_html(
				selected_uom
			)}</span>`;
		}

		let options = uoms
			.map((u) => {
				const selected = u.uom === selected_uom ? "selected" : "";
				return `<option value="${frappe.utils.escape_html(
					u.uom
				)}" data-conversion-factor="${
					u.conversion_factor
				}" ${selected}>${frappe.utils.escape_html(u.uom)}</option>`;
			})
			.join("");

		return `<select class="form-control form-control-sm uom-select" data-code="${safeCode}" style="min-width:80px; padding:2px 24px 2px 8px; font-size:0.8rem;">${options}</select>`;
	}

	async _renderItems(container, items, preloadedStockMap = null, preloadedPriceMap = null) {
		// Context bar: built before the early return so it is included in the empty state
		const isRestock = this._isRestockDoctype();
		const noPrice = this._isNoPriceDoctype();
		const isEdit = this.selector.mode === "edit";
		const isView = this.selector.mode === "view";
		// In edit mode the stock toggles are not shown (they are server-side filters)
		const inStockToggle = isEdit
			? ""
			: isRestock
			? `
            <div style="display:flex; align-items:center; gap:6px; margin-left:auto;">
                <input class="form-check-input" type="checkbox" id="restock-toggle" role="switch" ${
					this.state.restockOnly ? "checked" : ""
				} style="margin:0; cursor:pointer;">
                <label class="small text-muted" for="restock-toggle" style="margin:0; cursor:pointer; line-height:1;">
                    ${__("Needs Restock")}
                </label>
            </div>`
			: `
            <div style="display:flex; align-items:center; gap:6px; margin-left:auto;">
                <input class="form-check-input" type="checkbox" id="in-stock-toggle" role="switch" ${
					this.state.inStockOnly ? "checked" : ""
				} style="margin:0; cursor:pointer;">
                <label class="small text-muted" for="in-stock-toggle" style="margin:0; cursor:pointer; line-height:1;">
                    ${__("In Stock Only")}
                </label>
            </div>`;
		const activeFilterBadges = Object.entries(this.state.filters || {})
			.filter(([, value]) => (value || "").trim() !== "")
			.map(([field, value]) => {
				const definition = this.selector.config
					.getFilterDefinitions()
					.find((candidate) => candidate.fieldname === field);
				const label =
					definition?.label ||
					field.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
				return `<span class="badge badge-info" style="font-size:0.7rem;">${frappe.utils.escape_html(
					label
				)}: ${frappe.utils.escape_html(value)}</span>`;
			})
			.join("");

		const companyContext =
			isView && this.selector.getCompany()
				? `<span class="text-muted small ml-2">· ${__("Stock for")} <strong>${frappe.utils.escape_html(
						this.selector.getCompany()
				  )}</strong></span>`
				: "";

		let contextBar = "";
		if (this.state.mode === "doc") {
			contextBar = `
                <div class="context-bar d-flex align-items-center px-1 pb-1 mb-1 border-bottom">
                    ${icon("list", "sm", "text-muted", "font-size:0.85rem;")}
                    <span class="fw-medium small">${__("Document Items")}</span>
                    <span class="text-muted small ml-1">(${this.state.totalItems})</span>
					${activeFilterBadges}
                </div>`;
		} else if (this.state.label) {
			const isAll = this.state.label === __("All Items");
			const iconName = isAll ? "list-tree" : "folder-open";
			contextBar = `
                <div class="context-bar d-flex align-items-center px-1 pb-1 mb-1 border-bottom">
                    ${icon(iconName, "sm", "text-muted", "font-size:0.85rem;")}
                    <span class="fw-medium small">                    ${frappe.utils.escape_html(
						this.state.label
					)}</span>
                    ${companyContext}
                    ${activeFilterBadges}
                    ${inStockToggle}
                </div>`;
		} else if (this.state.mode === "search" && this.state.search) {
			contextBar = `
                <div class="context-bar d-flex align-items-center px-1 pb-1 mb-1 border-bottom">
                    ${icon("search", "sm", "text-muted", "font-size:0.85rem;")}
                    <span class="small text-muted">${__(
						"Results for"
					)} <strong>${frappe.utils.escape_html(this.state.search)}</strong></span>
                    ${companyContext}
                    ${activeFilterBadges}
                    ${inStockToggle}
                </div>`;
		}

		if (items.length === 0) {
			container.html(`
                <div style="display:flex; flex-direction:column; height:100%;">
                    ${contextBar}
                    <div class="text-center p-4 text-muted">
                        ${icon("inbox", "lg", "mb-2")}
                        <p>${__("No items found")}</p>
                    </div>
                </div>
            `);
			// Rebind the toggle in the empty state.
			// .off('change') before .on() to avoid accumulating handlers:
			// _renderItems runs on every render and the toggle lives outside the
			// container (it is not destroyed by container.html()), so without
			// .off() each render would add another handler and one click would
			// trigger N simultaneous renders.
			const self = this;
			container
				.find("#in-stock-toggle")
				.off("change")
				.on("change", function () {
					self.state.inStockOnly = this.checked;
					self.state.page = 1;
					self.renderCurrentPage();
				});
			container
				.find("#restock-toggle")
				.off("change")
				.on("change", function () {
					self.state.restockOnly = this.checked;
					self.state.page = 1;
					self.renderCurrentPage();
				});
			this._updateResultCount();
			this.updateTotals();
			return;
		}

		// Build map of items already in the document (item_code → total qty)
		const existingDocItems = {};
		(this.selector.frm.doc.items || []).forEach((row) => {
			if (row.item_code) {
				existingDocItems[row.item_code] =
					(existingDocItems[row.item_code] || 0) + (row.qty || 0);
			}
		});

		// Fetch stock and prices only for current page items
		// (in edit mode, pre-loaded maps are passed to avoid server calls)
		let stockMap, priceMap;
		if (preloadedStockMap !== null) {
			stockMap = preloadedStockMap;
			priceMap = preloadedPriceMap || {};
		} else {
			const priceList = this.selector.priceService.getPriceList();
			// Non-stock items (services) have no Bin: stock is not queried for them.
			const stockCodes = items
				.filter((i) => this._isStockItem(i))
				.map((i) => i.item_code);
			[stockMap, priceMap] = await Promise.all([
				this.selector.stockService.getStockLevels(stockCodes),
				!noPrice && priceList
					? this.selector.priceService.getPrices(
							items.map((i) => i.item_code),
							priceList
					  )
					: Promise.resolve({}),
			]);
		}

		const settings = this.selector.settings || {};
		const lowStockThreshold = settings.low_stock_threshold || 10;
		const defaultQty = settings.default_qty || 1;
		// Images are external (for example, Cloudinary): they are only shown when online.
		const online = typeof navigator === "undefined" || navigator.onLine !== false;
		const showImages =
			(settings.show_item_images !== undefined ? !!settings.show_item_images : true) &&
			online;
		const showBrand = settings.show_brand !== undefined ? !!settings.show_brand : true;
		const columnFields = this.selector.config.getColumnFields();

		let html = `
            <div class="items-grid-wrapper" style="display: flex; flex-direction: column; height: 100%;">
                ${contextBar}
                <div class="items-grid-container">
                    <table class="table table-sm table-hover mb-0 itemflow-items-table">
                        <thead class="table-light" style="position: sticky; top: 0; z-index: 1;">
                            <tr>
                                <th scope="col">${__("Item")}</th>
                                ${columnFields
									.map(
										(field) =>
											`<th scope="col" style="width: 12%">${frappe.utils.escape_html(
												field.label
											)}</th>`
									)
									.join("")}
                                <th scope="col" style="width: ${
									noPrice ? "18%" : "12%"
								}"><div style="display:flex; align-items:center; gap:6px;"><span>${__(
			"Stock"
		)}</span><small class="text-muted fw-normal">${__("UOM")}</small></div></th>
                                ${
									isView
										? ""
										: `<th scope="col" style="width: 100px; padding-left: 8px;">${__(
												"Order UOM"
										  )}</th>`
								}
                                ${
									!noPrice
										? `<th scope="col" style="width: 12%">${__("Price")}</th>`
										: ""
								}
                                ${
									isEdit && !noPrice
										? `<th scope="col" style="width: 12%">${__("Discount")} / ${__(
												"Total"
										  )}</th>`
										: ""
								}
                                ${
									isView
										? ""
										: `<th scope="col" style="width: 100px; padding-left: 12px;">${__("Qty")}</th>`
								}
                            </tr>
                        </thead>
                        <tbody>
        `;

		items.forEach((item) => {
			const isStockItem = this._isStockItem(item);
			const stock = isStockItem ? stockMap[item.item_code] ?? 0 : null;
			const basePrice = priceMap[item.item_code] || 0;
			const selected = this.selector.selected_items[item.item_code];
			const qty = selected ? Math.floor(selected.qty) : 0;
			const selectedUom = selected ? selected.uom : this._getDefaultUom(item);
			const conversionFactor = selected
				? selected.conversion_factor
				: this._getConversionFactor(item.item_code, selectedUom);

			const safeCode = frappe.utils.escape_html(item.item_code);
			const safeName = frappe.utils.escape_html(item.item_name);
			const safeStockUOM = frappe.utils.escape_html(item.stock_uom || this._fallbackUom());

			let stockClass = "";
			let stockBadge = "";
			let stockDisplay = stock ?? 0;
			if (!isStockItem) {
				stockClass = "text-muted";
				stockDisplay = "—";
			} else if (stock <= 0) {
				stockClass = "text-danger fw-bold";
				stockBadge = `<span class="badge badge-danger" style="font-size:0.7rem;" title="${__(
					"Out of Stock"
				)}">${__("Out of Stock")}</span>`;
			} else if (stock < lowStockThreshold) {
				stockClass = "if-text-warning fw-bold";
				stockBadge = `<span class="badge badge-warning" style="font-size:0.7rem;" title="${__(
					"Low Stock"
				)}">${__("Low Stock")}</span>`;
			} else {
				stockClass = "text-success";
			}

			const rowClass = qty > 0 ? "item-selected" : "";
			const checkIcon =
				qty > 0
					? icon("circle-check", "sm", "text-success item-selected-check", "margin-left:8px;")
					: "";
			const inDocQty = existingDocItems[item.item_code];
			const inDocBadge = inDocQty
				? `<span class="badge badge-info" style="font-size:0.7rem; margin-left:8px; vertical-align:middle;" title="${__(
						"Already in document"
				  )}">${__("In doc")}: ${inDocQty}</span>`
				: "";

			let displayPrice;
			if (isEdit) {
				displayPrice = item.price_list_rate || 0;
			} else if (selected && selected.price !== undefined) {
				displayPrice = selected.price;
			} else {
				displayPrice = basePrice;
			}

			const uomSelect = isView ? "" : this._renderUOMSelect(item.item_code, selectedUom);

			// Combined discount + total cell (document mode with price only)
			let discTotalCell = "";
			if (isEdit && !noPrice) {
				const discPct = item.discount_percentage || 0;
				const discAmt = item.discount_amount || 0;
				const amount = item.amount || 0;
				let discBadge = "";
				if (discPct > 0) {
					const discPctDisplay = parseFloat(discPct.toFixed(2));
					discBadge = `<span class="badge badge-warning" style="font-size:0.7rem; margin-right:6px;">-${discPctDisplay}%</span>`;
				} else if (discAmt > 0) {
					discBadge = `<span class="badge badge-warning" style="font-size:0.7rem; margin-right:6px;">-${format_currency(
						discAmt,
						this._currency()
					)}</span>`;
				}
				const totalHtml = `<span class="fw-medium doc-total-cell">${
					amount > 0 ? format_currency(amount, this._currency()) : "—"
				}</span>`;
				discTotalCell = `<td data-label="${__("Total")}">${discBadge}${totalHtml}</td>`;
			}

			const qtyCell = isView
				? ""
				: `
                    <td data-label="${__("Qty")}">
                        <div class="qty-btn-group">
                            <button class="btn btn-outline-secondary btn-sm qty-btn qty-dec"
                                    data-code="${safeCode}" type="button"
                                    aria-label="${__("Decrease quantity")}">
                                ${icon("minus", "sm")}
                            </button>
                            <input type="number" class="form-control form-control-sm qty-input text-center${
								qty > 0 ? " qty-active" : ""
							}"
                                data-code="${safeCode}" data-price="${displayPrice}"
                                value="${qty > 0 ? qty : ""}"
                                placeholder="${defaultQty}"
                                min="0" step="1"
                                aria-label="${__("Quantity for")} ${safeName}"
                                onfocus="this.select()"
                                onkeypress="return event.charCode >= 48 && event.charCode <= 57">
                            <button class="btn btn-outline-secondary btn-sm qty-btn qty-inc"
                                    data-code="${safeCode}" type="button"
                                    aria-label="${__("Increase quantity")}">
                                ${icon("plus", "sm")}
                            </button>
                        </div>
                    </td>`;

			html += `
                <tr class="${rowClass}" data-item-code="${safeCode}" data-default-qty="${defaultQty}">
                    <td class="if-cell-item">
                        <div class="d-flex align-items-center item-cell">
                            ${
								showImages
									? item.image
										? `<img class="item-image" src="${frappe.utils.escape_html(
												item.image
										  )}" loading="lazy" style="width:32px;height:32px;object-fit:cover;border-radius:4px;flex-shrink:0;">`
										: `<div style="width:32px;height:32px;background:var(--bg-light-gray);border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon(
												"box",
												"sm",
												"text-muted"
										  )}</div>`
									: ""
							}
                            <div>
                                <div class="fw-medium">${safeName}${checkIcon}${inDocBadge}</div>
                                <small class="text-muted">${safeCode}</small>
                                ${
									showBrand && item.brand
										? `<small class="text-info ml-2">${icon("tag", "xs")} ${frappe.utils.escape_html(
												item.brand
										  )}</small>`
										: ""
								}
                            </div>
                        </div>
                    </td>
                    ${columnFields
						.map((field) => {
							const value = item[field.fieldname];
							return `<td data-label="${frappe.utils.escape_html(
								field.label
							)}"><small class="text-muted">${frappe.utils.escape_html(
								String(value ?? "")
							)}</small></td>`;
						})
						.join("")}
                    <td data-label="${__("Stock")}">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span class="${stockClass}" style="font-weight:700;">${
				stockDisplay
			}</span>
                            <small class="text-muted">${safeStockUOM}</small>
                            ${stockBadge}
                        </div>
                    </td>
                    ${
						isView
							? ""
							: `<td data-label="${__("Order UOM")}" style="padding-left:8px;">${uomSelect}</td>`
					}
                    ${
						!noPrice
							? `<td class="price-cell" data-label="${__("Price")}" data-base-price="${basePrice}" data-conversion-factor="${conversionFactor}">${
									displayPrice > 0
										? format_currency(displayPrice, this._currency())
										: '<span class="text-muted">—</span>'
							  }</td>`
							: ""
					}
                    ${discTotalCell}
                    ${qtyCell}
                </tr>
            `;
		});

		html += `
                        </tbody>
                    </table>
                </div>
        `;

		html += this._renderPagination();
		html += `</div>`;

		container.html(html);
		this._bindEvents(container, items, stockMap, priceMap, defaultQty);
		this._updateResultCount();
		this.updateTotals();
	}

	_renderPagination() {
		const totalPages = computeTotalPages(this.state.totalItems, this.state.perPage);
		if (totalPages <= 1) return "";

		const start = (this.state.page - 1) * this.state.perPage + 1;
		const end = Math.min(this.state.page * this.state.perPage, this.state.totalItems);

		let html = `
            <div class="pagination-container border-top p-2">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="text-muted small">
                        ${__("Showing")} <strong>${start}</strong> - <strong>${end}</strong>
                        ${__("of")} <strong>${this.state.totalItems}</strong> ${__("items")}
                    </div>
                    <nav>
                        <ul class="pagination pagination-sm mb-0">
        `;

        html += `<li class="page-item ${this.state.page === 1 ? "disabled" : ""}">
            <a class="page-link" href="#" data-page="${this.state.page - 1}"
               aria-label="${__("Previous page")}">
                ${icon("chevron-left", "sm")}
            </a>
        </li>`;

		const maxVisible = 5;
		let startPage = Math.max(1, this.state.page - Math.floor(maxVisible / 2));
		let endPage = Math.min(totalPages, startPage + maxVisible - 1);
		if (endPage - startPage < maxVisible - 1) {
			startPage = Math.max(1, endPage - maxVisible + 1);
		}

		if (startPage > 1) {
			html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
			if (startPage > 2) {
				html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
			}
		}

        for (let i = startPage; i <= endPage; i++) {
            html += `<li class="page-item ${i === this.state.page ? "active" : ""}">
                <a class="page-link" href="#" data-page="${i}"${
				i === this.state.page ? ' aria-current="page"' : ""
			}>${i}</a>
            </li>`;
        }

		if (endPage < totalPages) {
			if (endPage < totalPages - 1) {
				html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
			}
			html += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
		}

        html += `<li class="page-item ${this.state.page === totalPages ? "disabled" : ""}">
            <a class="page-link" href="#" data-page="${this.state.page + 1}"
               aria-label="${__("Next page")}">
                ${icon("chevron-right", "sm")}
            </a>
        </li>`;

		html += `</ul></nav></div></div>`;
		return html;
	}

	_updateResultCount() {
		const $counter = this.dialog.dialog.$wrapper.find("#search-result-count");
		if (!$counter.length) return;

		// Only show when there is an active search term —
		// the "Showing X-Y of N" count already appears in the bottom pagination bar.
		if (this.state.mode === "search" && this.state.search) {
			if (this.state.totalItems === 0) {
				$counter.html(`<span class="text-muted">${__("No items found")}</span>`);
			} else {
				$counter.html(
					`<span>${__("Results for")} "<strong>${frappe.utils.escape_html(
						this.state.search
					)}</strong>"</span>`
				);
			}
		} else {
			$counter.html("");
		}
	}

	updateTotals() {
		const selected = this.selector.selected_items;
		const codes = Object.keys(selected);
		const noPrice = this._isNoPriceDoctype();

		let totalQty = 0;
		let totalAmount = 0;

		codes.forEach((code) => {
			const item = selected[code];
			totalQty += item.qty || 0;
			totalAmount += (item.qty || 0) * (item.price || 0);
		});

		const summaryHtml = `
            <div style="display:flex; align-items:center; gap:6px; line-height:1;">
                <span class="text-muted">${__("Selected")}:</span>
                <span class="fw-bold ${codes.length > 0 ? "text-success" : ""}">${
			codes.length
		}</span>
                <span class="text-muted">|</span>
                <span class="text-muted">${__("Qty")}:</span>
                <span class="fw-bold">${totalQty}</span>
                ${
					!noPrice
						? `
                <span class="text-muted">|</span>
                <span class="text-muted">${__("Total")}:</span>
                <span class="fw-bold if-text">${format_currency(
					totalAmount,
					this._currency()
				)}</span>
                `
						: ""
				}
            </div>
        `;

		const $summary = this.dialog.dialog.$wrapper.find("#items-summary");
		if ($summary.length) {
			$summary.html(summaryHtml);
		}
	}

	_showLoading(container) {
		container.html(`
            <div class="text-center p-4">
                <div class="spinner-border if-text" role="status"></div>
                <p class="mt-2 text-muted">${__("Loading items...")}</p>
            </div>
        `);
	}

	_showError(container, e) {
		container.html(`
            <div class="alert alert-danger m-3">
                ${icon("triangle-alert", "sm")}
                <strong>${__("Error loading items")}</strong><br>${frappe.utils.escape_html(
			e.message || ""
		)}
            </div>
        `);
	}
}
