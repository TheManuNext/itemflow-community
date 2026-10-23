import { icon } from "./icons.js";

export class ItemSelectorTree {
	constructor(dialog) {
		this.dialog = dialog;
		this.groups_cache = null;
		this.groups_by_parent = {};
		this.expanded_groups = new Set();
	}

	get _config() {
		return this.dialog.selector.config;
	}

	async loadGroups() {
		const container = this.dialog.dialog.$wrapper.find("#tree-container");

		container.html(`
            <div class="text-center p-3">
                <div class="spinner-border spinner-border-sm if-text" role="status"></div>
                <p class="mt-2 text-muted small">${__("Loading categories...")}</p>
            </div>
        `);

		try {
			// frappe.xcall returns r.message directly (modern Frappe pattern)
			const groups = (await frappe.xcall("itemflow.api.get_item_groups_hierarchy")) || [];
			this.groups_cache = groups;
			this._config.debug("Groups loaded:", groups.length);

			this.buildGroupHierarchy(groups);
			this.renderTree(container, groups);

			// Load "All Items" automatically when the catalogue opens,
			// so the user sees items immediately without having to click.
			this.loadGroupItems("__all__");
			container.find('[data-group="__all__"]').addClass("active");
		} catch (e) {
			container.html(`
                <div class="alert alert-warning p-2">
                    ${icon("circle-alert", "sm")} ${__("Error loading categories")}
                </div>
            `);
		}
	}

	buildGroupHierarchy(groups) {
		this.groups_by_parent = {};
		groups.forEach((g) => {
			const parent = g.parent_item_group || "All Item Groups";
			if (!this.groups_by_parent[parent]) {
				this.groups_by_parent[parent] = [];
			}
			this.groups_by_parent[parent].push(g);
		});
	}

	renderTree(container, groups) {
		if (groups.length === 0) {
			container.html(`
                <div class="text-muted text-center p-3">
                    ${icon("folder-open", "md")}
                    <p class="small mt-1">${__("No categories found")}</p>
                </div>
            `);
			return;
		}

		const rootGroups = [];

		if (this.groups_by_parent["All Item Groups"]) {
			rootGroups.push(...this.groups_by_parent["All Item Groups"]);
		}

		if (rootGroups.length === 0) {
			// Use a Set to avoid the O(n²) of nested .some() — now O(n)
			const groupNames = new Set(groups.map((g) => g.name));
			groups.forEach((g) => {
				if (
					!g.parent_item_group ||
					g.parent_item_group === "All Item Groups" ||
					!groupNames.has(g.parent_item_group)
				) {
					rootGroups.push(g);
				}
			});
		}

		let html = '<div class="item-group-tree">';

		// Root node "All Items" — loads all items
		html += `
            <div class="tree-item mb-1">
                <a href="#"
                   class="group-link d-flex align-items-center p-2 rounded hover-bg"
                   data-group="__all__"
                   data-is-folder="false"
                   data-has-children="false">
                    <span style="width: 16px; display: inline-block;"></span>
                    ${icon("list-tree", "sm", "text-muted", "font-size: 0.85em;")}
                    <span>${__("All Items")}</span>
                </a>
            </div>
        `;

		const rendered = new Set();

		rootGroups.forEach((g) => {
			if (!rendered.has(g.name)) {
				html += this.renderGroupNode(g, 0, rendered, new Set());
			}
		});

		html += "</div>";
		container.html(html);
		this.bindTreeEvents(container);
	}

	renderGroupNode(group, level, rendered, path) {
		if (rendered.has(group.name)) return "";
		rendered.add(group.name);

		if (path.has(group.name)) return "";
		if (level > 8) return "";

		const safeName = frappe.utils.escape_html(group.name);
		const hasChildren = !!(
			this.groups_by_parent[group.name] && this.groups_by_parent[group.name].length > 0
		);
		const isExpanded = this.expanded_groups.has(group.name);
		const indent = level * 12;
		const newPath = new Set(path);
		newPath.add(group.name);

		let html = "";

		if (hasChildren) {
			html += `
                <div class="tree-node" style="margin-left: ${indent}px">
                    <div class="tree-item mb-1">
                        <a href="#"
                           class="group-link d-flex align-items-center p-2 rounded hover-bg"
                           data-group="${safeName}"
                           data-is-folder="true"
                           data-has-children="true">
                            <span class="toggle-icon" style="width: 16px; display: inline-block; text-align: center;">
                                ${icon(
									isExpanded ? "chevron-down" : "chevron-right",
									"sm",
									"text-muted"
								)}
                            </span>
                            ${icon(
								isExpanded ? "folder-open" : "folder",
								"sm",
								"folder-icon text-muted"
							)}
                            <span title="${safeName}">${safeName}</span>
                        </a>
                    </div>
                    <div class="tree-children ps-2 ${
						isExpanded ? "" : "d-none"
					}" data-parent="${safeName}">
            `;

			this.groups_by_parent[group.name].forEach((child) => {
				html += this.renderGroupNode(child, level + 1, rendered, newPath);
			});

			html += `
                    </div>
                </div>
            `;
		} else {
			html += `
                <div class="tree-item mb-1" style="margin-left: ${indent}px">
                    <a href="#"
                       class="group-link d-flex align-items-center p-2 rounded hover-bg"
                       data-group="${safeName}"
                       data-is-folder="false"
                       data-has-children="false">
                        <span style="width: 16px; display: inline-block;"></span>
                        ${icon("tag", "sm", "text-muted", "font-size: 0.85em;")}
                        <span title="${safeName}">${safeName}</span>
                    </a>
                </div>
            `;
		}

		return html;
	}

	bindTreeEvents(container) {
		const self = this;

		container.off("click", ".group-link").on("click", ".group-link", function (e) {
			e.preventDefault();
			e.stopPropagation();

			const $link = $(this);
			const group = $link.data("group");
			const isFolder =
				$link.data("is-folder") === true || $link.data("is-folder") === "true";
			const hasChildren =
				$link.data("has-children") === true || $link.data("has-children") === "true";

			self.dialog.clearSearch();

			if (hasChildren && isFolder) {
				const $children = $link.closest(".tree-node").find("> .tree-children");
				const isExpanded = !$children.hasClass("d-none");

				if (isExpanded) {
					$children.addClass("d-none");
					$link.find(".toggle-icon use").attr("href", "#icon-chevron-right");
					$link.find(".folder-icon use").attr("href", "#icon-folder");
					self.expanded_groups.delete(group);
				} else {
					$children.removeClass("d-none");
					$link.find(".toggle-icon use").attr("href", "#icon-chevron-down");
					$link.find(".folder-icon use").attr("href", "#icon-folder-open");
					self.expanded_groups.add(group);
				}
			}

			self.loadGroupItems(group);

			container.find(".group-link").removeClass("active");
			$link.addClass("active");
		});
	}

	async loadGroupItems(group) {
		this._config.debug("Loading items for group:", group);

		const filters = this.dialog.itemsGrid.state.filters || {};

		if (group === "__all__") {
			this.dialog.itemsGrid.state.label = __("All Items");
			await this.dialog.itemsGrid.searchItems("", 1, filters);
		} else {
			this.dialog.itemsGrid.state.label = group;
			try {
				// frappe.xcall returns r.message directly (modern Frappe pattern)
				const allGroups = (await frappe.xcall("itemflow.api.get_descendant_groups", {
					group_name: group,
				})) || [group];
				await this.dialog.itemsGrid.loadItemsByGroups(allGroups, 1, filters);
			} catch (err) {
				await this.dialog.itemsGrid.loadItemsByGroups([group], 1, filters);
			}
		}
	}

	clearCache() {
		this.groups_cache = null;
		this.groups_by_parent = {};
		this.expanded_groups.clear();
	}
}
