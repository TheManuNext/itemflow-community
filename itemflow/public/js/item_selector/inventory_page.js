/**
 * Entry point for the Inventory Desk Page (read-only).
 *
 * Mounts the ItemFlow catalogue in `view` mode inside the page container,
 * reusing the same search, category tree, filters, grid and responsive CSS as
 * the selector. It does not write to any document.
 */
import { ItemSelectorPlus } from "./selector.js";

export function mountInventoryPage(container) {
	if (!container) {
		throw new Error("ItemFlow: a page container is required");
	}

	const selector = new ItemSelectorPlus(null, { mode: "view", container });

	selector.init().catch((e) => {
		console.error("[ItemFlow] Inventory page init failed", e);
		frappe.msgprint({
			title: __("Error"),
			message: __("Failed to initialize the inventory page. Please refresh and try again."),
			indicator: "red",
		});
	});

	return {
		refresh() {
			return selector.dialog?.refreshAll?.();
		},
	};
}
