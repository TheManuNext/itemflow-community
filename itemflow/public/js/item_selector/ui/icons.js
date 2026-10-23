/**
 * Icon helper for the Item Selector UI.
 *
 * Frappe v16.50 removed FontAwesome from the Desk bundle, so every icon now
 * renders through `frappe.utils.icon` (Lucide sprite). This wrapper keeps call
 * sites terse and always adds the `current-color` class so Bootstrap text
 * utilities (`text-muted`, `text-success`, `text-info`, ...) tint the icon.
 *
 * @param {string} name  Lucide icon name (e.g. "chevron-left", "circle-check").
 * @param {string} size  Icon size: xs | sm | md | lg | xl.
 * @param {string} cls   Extra classes for the <svg> (colours, hooks).
 * @param {string} style Inline style for the <svg>.
 */
export function icon(name, size = "sm", cls = "", style = "") {
	const svg_class = cls ? `${cls} current-color` : "current-color";
	return frappe.utils.icon(name, size, "", style, svg_class, true);
}
