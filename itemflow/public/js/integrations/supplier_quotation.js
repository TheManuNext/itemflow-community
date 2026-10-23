frappe.ui.form.on("Supplier Quotation", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Supplier Quotation");
		}
	},
});
