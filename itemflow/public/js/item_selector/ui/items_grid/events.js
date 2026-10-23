/**
 * DOM event bindings for the items grid.
 *
 * Faithful extraction of `_bindEvents`; reads selector/dialog/state from the
 * grid facade and delegates helpers back to it.
 */
import { icon } from "../icons.js";

export class ItemsGridEvents {
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

	renderCurrentPage(...args) {
		return this.grid.renderCurrentPage(...args);
	}

	_fallbackUom() {
		return this.grid._fallbackUom();
	}

	_currency() {
		return this.grid._currency();
	}

	_getDefaultUom(item) {
		return this.grid._getDefaultUom(item);
	}

	_getConversionFactor(item_code, uom) {
		return this.grid._getConversionFactor(item_code, uom);
	}

	_bindEvents(container, items, stockMap, priceMap, defaultQty) {
		const self = this;

		// External images: if loading fails (offline/DNS), replace with a placeholder
		container
			.find("img.item-image")
			.off("error")
			.on("error", function () {
				$(this).replaceWith(
					`<div style="width:32px;height:32px;background:var(--bg-light-gray);border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${icon(
						"box",
						"sm",
						"text-muted"
					)}</div>`
				);
			});

		// "In Stock Only" toggle (sales) or "Needs Restock" (purchases).
		// .off('change') is required: _bindEvents is called on every _renderItems
		// and the toggles (#in-stock-toggle, #restock-toggle) live in the
		// contextBar, which is rebuilt on every render. Without .off(), handlers
		// accumulate and one click triggers N concurrent renderCurrentPage()
		// calls (N = number of previous renders).
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

		// Read-only mode (Inventory page): toggles + pagination only; no
		// selection, quantities or UOM changes.
		if (this.selector.mode === "view") {
			this._bindPagination(container);
			return;
		}

		// Debounce for heavy operations when changing qty
		const debouncedUpdateCount = frappe.utils.debounce(
			() => self.dialog.updateSelectedCount(),
			150
		);

		// UOM select change events
		container
			.find(".uom-select")
			.off("change")
			.on("change", async function () {
				const $el = $(this);
				const itemCode = $el.attr("data-code");
				const newUom = $el.val();
				const conversionFactor =
					parseFloat($el.find("option:selected").attr("data-conversion-factor")) || 1;

				const item = items.find((i) => i.item_code === itemCode);
				const stock = stockMap[itemCode] ?? 0;
				const basePrice = priceMap[itemCode] || 0;

				let newPrice = basePrice;
				if (newUom !== item.stock_uom) {
					const priceList = self.selector.priceService.getPriceList();
					if (priceList) {
						const specificPrice = await self.selector.priceService.getPriceForUom(
							itemCode,
							newUom,
							priceList
						);
						if (specificPrice !== null && specificPrice > 0) {
							newPrice = specificPrice;
						} else {
							// Fallback: base price * conversion_factor
							newPrice = basePrice * conversionFactor;
						}
					} else {
						newPrice = basePrice * conversionFactor;
					}
				}

				const existing = self.selector.selected_items[itemCode] || {};
				self.selector.updateSelection(itemCode, {
					qty: existing.qty || 0,
					name: item ? item.item_name : itemCode,
					stock: stock,
					is_stock_item: item ? item.is_stock_item : 1,
					price: newPrice,
					base_price: basePrice,
					uom: newUom,
					stock_uom: item ? item.stock_uom : self._fallbackUom(),
					conversion_factor: conversionFactor,
					uoms: (self.state.uomsMap[itemCode] || {}).uoms || [],
				});

				// Visually update the price in the row
				const $row = $el.closest("tr");
				const $priceCell = $row.find(".price-cell");
				if ($priceCell.length) {
					$priceCell.attr("data-conversion-factor", conversionFactor);
					$priceCell.text(
						newPrice > 0 ? format_currency(newPrice, self._currency()) : "—"
					);
				}
				const $qtyInput = $row.find(".qty-input");
				$qtyInput.attr("data-price", newPrice);
				$qtyInput.trigger("change");
			});

		// Quantity input change events
		container.find(".qty-input").on("change input", function () {
			const $el = $(this);
			const itemCode = $el.attr("data-code");
			const price = parseFloat($el.attr("data-price")) || 0;

			let rawValue = $el.val();
			let qty = parseInt(rawValue) || 0;

			if (rawValue.includes(".") || rawValue.includes(",")) {
				$el.val(qty);
			}
			if (qty < 0) qty = 0;

			const item = items.find((i) => i.item_code === itemCode);
			const stock = stockMap[itemCode] ?? 0;
			const existing = self.selector.selected_items[itemCode] || {};

			// Prefer the live UOM dropdown value so a UOM change before qty is set is not lost
			const $row = $el.closest("tr");
			const $uomSelect = $row.find(".uom-select");
			const selectedUom = $uomSelect.length
				? $uomSelect.val()
				: existing.uom || self._getDefaultUom(item);
			const conversionFactor = self._getConversionFactor(itemCode, selectedUom);

			self.selector.updateSelection(itemCode, {
				qty: qty,
				name: item ? item.item_name : itemCode,
				stock: stock,
				is_stock_item: item ? item.is_stock_item : 1,
				price: price,
				base_price: existing.base_price || priceMap[itemCode] || 0,
				uom: selectedUom,
				stock_uom: item ? item.stock_uom : self._fallbackUom(),
				conversion_factor: conversionFactor,
				uoms: (self.state.uomsMap[itemCode] || {}).uoms || [],
			});

			const $nameDiv = $row.find(".fw-medium").first();
			if (qty > 0) {
				$row.addClass("item-selected");
				$el.addClass("qty-active");
				if (!$nameDiv.find(".item-selected-check").length) {
					$nameDiv.append(
						icon("circle-check", "sm", "text-success item-selected-check", "margin-left:8px;")
					);
				}
			} else {
				$row.removeClass("item-selected");
				$el.removeClass("qty-active");
				$nameDiv.find(".item-selected-check").remove();
			}

			const $docTotal = $row.find(".doc-total-cell");
			if ($docTotal.length) {
				const newAmount = qty * price;
				$docTotal.text(
					qty > 0 && newAmount > 0 ? format_currency(newAmount, self._currency()) : "—"
				);
			}

			debouncedUpdateCount();
		});

		// Decrement button
		container.find(".qty-dec").on("click", function (e) {
			e.stopPropagation();
			const $input = $(this).siblings(".qty-input");
			let qty = parseInt($input.val()) || 0;
			if (qty > 0) {
				qty--;
				$input.val(qty > 0 ? qty : "");
				$input.trigger("change");
			}
		});

		// Increment button
		container.find(".qty-inc").on("click", function (e) {
			e.stopPropagation();
			const $input = $(this).siblings(".qty-input");
			let qty = parseInt($input.val()) || 0;
			qty++;
			$input.val(qty);
			$input.trigger("change");
		});

		// Row click: toggle selection (ignore clicks on interactive controls)
		container.find("tbody tr").on("click", function (e) {
			if (
				$(e.target).is("input, select, textarea") ||
				$(e.target).closest(".qty-btn, .uom-select").length
			) {
				return;
			}
			const $row = $(this);
			const $input = $row.find(".qty-input");
			const currentQty = parseInt($input.val()) || 0;
			const rowDefaultQty = parseInt($row.data("default-qty")) || defaultQty;

			if (currentQty > 0) {
				$input.val("");
			} else {
				$input.val(rowDefaultQty);
				// Auto-focus + select so the user can adjust the quantity without a mouse
				$input.focus().select();
			}
			$input.trigger("change");
		});

		// Pagination click events
		this._bindPagination(container);
	}

	// Pagination binding (shared by add/view/edit modes).
	_bindPagination(container) {
		const self = this;
		container.find(".page-link").on("click", async function (e) {
			e.preventDefault();
			const page = parseInt($(this).data("page"));
			const totalPages = Math.ceil(self.state.totalItems / self.state.perPage);

			if (page && page !== self.state.page && page >= 1 && page <= totalPages) {
				self.state.page = page;
				await self.renderCurrentPage();
			}
		});
	}
}
