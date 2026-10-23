frappe.ui.form.on("Purchase Receipt", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Purchase Receipt");
		}
	},
});
