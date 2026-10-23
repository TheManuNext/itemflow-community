frappe.ui.form.on("Sales Order", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Sales Order");
		}
	},
});
