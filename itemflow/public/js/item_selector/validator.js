export class ItemSelectorValidator {
    constructor(frm) {
        this.frm = frm;
        this.doctype = frm.doctype;

        // Required-field configuration per doctype
        this.doctype_config = {
            'Sales Order': {
                fields: ['customer', 'company'],
                labels: {
                    'customer': __('Customer'),
                    'company': __('Company')
                }
            },
            'Quotation': {
                fields: ['party_name', 'company'],
                labels: {
                    'party_name': __('Customer'),
                    'company': __('Company')
                }
            },
            'Sales Invoice': {
                fields: ['customer', 'company'],
                labels: {
                    'customer': __('Customer'),
                    'company': __('Company')
                }
            },
            'Purchase Order': {
                fields: ['supplier', 'company'],
                labels: {
                    'supplier': __('Supplier'),
                    'company': __('Company')
                }
            },
            'Material Request': {
                fields: ['company'],
                labels: {
                    'company': __('Company')
                }
            },
            'Supplier Quotation': {
                fields: ['supplier', 'company'],
                labels: {
                    'supplier': __('Supplier'),
                    'company': __('Company')
                }
            },
            'Purchase Invoice': {
                fields: ['supplier', 'company'],
                labels: {
                    'supplier': __('Supplier'),
                    'company': __('Company')
                }
            },
            'Purchase Receipt': {
                fields: ['supplier', 'company'],
                labels: {
                    'supplier': __('Supplier'),
                    'company': __('Company')
                }
            },
            'Stock Entry': {
                fields: ['company', 'to_warehouse'],
                labels: {
                    'company': __('Company'),
                    'to_warehouse': __('Warehouse')
                }
            }
        };

        // Get the config for the current doctype
        const config = this.doctype_config[this.doctype] || this.doctype_config['Sales Order'];
        this.required_fields = config.fields;
        this.field_labels = config.labels;
    }

    validate() {
        const missing = [];
        for (const field of this.required_fields) {
            if (!this.frm.doc[field]) {
                missing.push({
                    field: field,
                    label: this.field_labels[field] || field
                });
            }
        }
        return { valid: missing.length === 0, missing: missing };
    }

    showMissingFieldsNotification(missing) {
        const fields_list = missing.map(m => `<b>${m.label}</b>`).join(', ');
        frappe.show_alert({
            message: __('Please set {0} before adding items', [fields_list]),
            indicator: 'orange'
        }, 7);

        // Highlight missing fields
        missing.forEach(m => {
            const field = this.frm.get_field(m.field);
            if (field && field.$input) {
                field.$input.addClass('highlight-error');
                setTimeout(() => field.$input.removeClass('highlight-error'), 3000);
            }
        });
    }

    shouldShowButton() {
        return this.frm.doc.docstatus === 0;
    }
}
