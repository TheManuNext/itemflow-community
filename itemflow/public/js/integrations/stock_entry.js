frappe.ui.form.on("Stock Entry", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Stock Entry");
		}
	},
});
