frappe.ui.form.on("Quotation", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Quotation");
		}
	},
});
