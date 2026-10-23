frappe.ui.form.on("Purchase Order", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Purchase Order");
		}
	},
});
