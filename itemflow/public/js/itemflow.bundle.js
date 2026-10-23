// ItemFlow - Frappe v16 ES6 Bundle

import { ItemSelectorPlus } from './item_selector/selector.js';
import { initializeItemSelector } from './integrations/init.js';
import { mountInventoryPage } from './item_selector/inventory_page.js';

// Expose functions globally so doctype_js can use them.
// Note: app_include_js loads this bundle on every page, but imported modules do
// not run heavy logic until they are explicitly invoked.
window.ItemSelectorPlus = ItemSelectorPlus;
window.initializeItemSelector = initializeItemSelector;
// Entry point for the Inventory Desk Page (read-only mode).
window.ItemFlowInventory = { mount: mountInventoryPage };
