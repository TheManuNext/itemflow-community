frappe.ui.form.on('Itemflow Settings', {
    refresh: function(frm) {
        frm.add_custom_button(__('Reset to Defaults'), function() {
            frm.set_value('low_stock_threshold', 10);
            frm.set_value('default_qty', 1);
            frm.set_value('button_style', 'primary');
            frm.set_value('check_order_button_style', 'secondary');
            frm.set_value('button_position', 'top');
            frm.set_value('enable_debug_mode', 0);
        }, __('Actions'));

        frm.add_custom_button(__('Rebuild Search Index'), function() {
            frappe.confirm(
                __('Rebuild the item search index? This may take a moment.'),
                function() {
                    frappe.call({
                        method: 'itemflow.api.rebuild_search_index',
                        freeze: true,
                        freeze_message: __('Rebuilding search index...'),
                        callback: function(r) {
                            if (!r.message) return;
                            const msg = r.message.queued
                                ? __('Search index rebuild queued')
                                : __('Search index rebuilt ({0} items)', [r.message.total]);
                            frappe.show_alert({ message: msg, indicator: 'green' }, 6);
                        }
                    });
                }
            );
        }, __('Actions'));
    }
});