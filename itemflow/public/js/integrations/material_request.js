frappe.ui.form.on("Material Request", {
	refresh: function (frm) {
		if (typeof window.initializeItemSelector === "function") {
			window.initializeItemSelector(frm, "Material Request");
		}
	},
});
