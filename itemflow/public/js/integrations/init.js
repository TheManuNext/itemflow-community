import { ItemSelectorConfig } from '../item_selector/config.js';
import { ItemSelectorValidator } from '../item_selector/validator.js';
import { ItemSelectorPlus } from '../item_selector/selector.js';

// Frappe v16 renders custom buttons as `.es-button`, styled via data-variant
// (not Bootstrap `.btn-*` classes). Translate the stored style to the v16
// vocabulary and apply it through the public API; unknown values fall back to
// the button's default look.
const BUTTON_STYLE_TO_V16 = {
    // v2.8+ stores the v16 vocabulary directly.
    primary: 'primary',
    secondary: 'secondary',
    danger: 'danger',
    ghost: 'ghost',
    // Legacy Bootstrap classes (pre-v2.8 settings) — kept for stored values.
    'btn-primary': 'primary',
    'btn-secondary': 'secondary',
    'btn-dark': 'primary',
    'btn-warning': 'danger',
};

function applyButtonType(frm, label, style, fallback) {
    if (typeof frm.change_custom_button_type !== 'function') return;
    frm.change_custom_button_type(label, null, BUTTON_STYLE_TO_V16[style] || fallback);
}

export async function initializeItemSelector(frm, doctype) {
    const validator = new ItemSelectorValidator(frm);

    if (!validator.shouldShowButton()) return;

    const btnLabel = __('Advanced Search');
    if (frm.custom_buttons && frm.custom_buttons[btnLabel]) return;

    // Load settings to check doctype enabled + button style
    const config = new ItemSelectorConfig();
    const settings = await config.load();

    if (!config.isDoctypeEnabled(doctype)) return;

    frm.add_custom_button(btnLabel, async function() {
        const check = validator.validate();
        if (!check.valid) {
            validator.showMissingFieldsNotification(check.missing);
            return;
        }

        const selector = new ItemSelectorPlus(frm);
        await selector.init();
    });
    applyButtonType(frm, btnLabel, settings.button_style, 'primary');

    // "Review Items" button — views and edits items already in the document
    const editBtnLabel = __('Review Items');
    if (!frm.custom_buttons?.[editBtnLabel]) {
        frm.add_custom_button(editBtnLabel, async function() {
            if (!(frm.doc.items && frm.doc.items.length)) {
                frappe.show_alert({ message: __('No items in this document'), indicator: 'orange' }, 4);
                return;
            }
            const selector = new ItemSelectorPlus(frm, { mode: 'edit' });
            await selector.init();
        });
        applyButtonType(frm, editBtnLabel, settings.check_order_button_style, 'secondary');
    }
}
