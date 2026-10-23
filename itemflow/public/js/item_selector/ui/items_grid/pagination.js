/**
 * Pure pagination helpers for the items grid.
 */

export function totalPages(totalItems, perPage) {
	if (!perPage || perPage <= 0) return 0;
	return Math.ceil((totalItems || 0) / perPage);
}

export function currentPageSlice(items, page, perPage) {
	const list = items || [];
	const size = perPage || 0;
	const start = ((page || 1) - 1) * size;
	return list.slice(start, start + size);
}
