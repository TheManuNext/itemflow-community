frappe.ui.form.on("Sales Invoice", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Sales Invoice");
		}
	},
});
