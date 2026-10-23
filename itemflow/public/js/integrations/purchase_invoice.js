frappe.ui.form.on("Purchase Invoice", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Purchase Invoice");
		}
	},
});
