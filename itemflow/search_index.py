"""N-gram search index for items.

MariaDB has no ``ngram`` full-text parser, so we build our own token index to
make substring search (required for Thai, which has no word separators)
indexable. Tokens are regenerated per item on save and can be rebuilt in
batches for existing data.
"""

import frappe

TOKEN_DOCTYPE = "ItemFlow Search Token"
NGRAM = 2
BATCH_SIZE = 250
REBUILD_INLINE_MAX = 10000
MAX_TOKEN_RESULTS = 5000


def normalize(text):
	"""Lowercase and collapse whitespace."""
	if not text:
		return ""
	return " ".join(str(text).lower().split())


def ngrams(word, n=NGRAM):
	"""Character n-grams of a single word.

	Words shorter than ``n`` return themselves so short terms stay searchable.
	"""
	if not word:
		return set()
	if len(word) < n:
		return {word}
	return {word[i : i + n] for i in range(len(word) - n + 1)}


def tokenize(text):
	"""Union of the n-grams of every word in ``text``."""
	tokens = set()
	for word in normalize(text).split():
		tokens.update(ngrams(word))
	return tokens


def tokens_for_item(item):
	"""Tokens for an item, derived from its code, name and brand."""
	tokens = set()
	for value in (item.get("item_code"), item.get("item_name"), item.get("brand")):
		tokens.update(tokenize(value))
	return tokens


def _delete_tokens(item_codes):
	if not item_codes:
		return
	frappe.db.delete(TOKEN_DOCTYPE, {"item_code": ["in", list(item_codes)]})


def _build_rows(items):
	rows = []
	for item in items:
		item_code = item.get("item_code") or item.get("name")
		if not item_code:
			continue
		for token in tokens_for_item(item):
			rows.append((frappe.generate_hash(length=12), item_code, token))
	return rows


def _write_rows(rows):
	if not rows:
		return
	frappe.db.bulk_insert(
		TOKEN_DOCTYPE,
		["name", "item_code", "token"],
		rows,
		ignore_duplicates=True,
		chunk_size=1000,
	)


def index_item(doc, method=None):
	"""Index a single item. Hook: ``after_insert`` / ``on_update``."""
	item_code = doc.get("item_code") or doc.get("name")
	if not item_code:
		return
	_delete_tokens([item_code])
	if doc.get("disabled"):
		# Disabled items are not searchable: keep the index clean.
		return
	_write_rows(_build_rows([doc]))


def remove_item(doc, method=None):
	"""Remove an item's tokens. Hook: ``on_trash``."""
	item_code = doc.get("item_code") or doc.get("name")
	if item_code:
		_delete_tokens([item_code])


def rename_item(doc, method=None, old=None, new=None, merge=False):
	"""Reindex on rename. Hook: ``after_rename``."""
	if old:
		_delete_tokens([old])
	if not merge:
		index_item(doc)


def find_item_codes(term, limit=MAX_TOKEN_RESULTS):
	"""Item codes whose tokens match all n-grams of ``term``.

	Returns an empty list when the term has no tokens (e.g. too short) or the
	index is empty, so callers can fall back to LIKE.
	"""
	tokens = tokenize(term)
	if not tokens:
		return []
	placeholders = ", ".join(["%s"] * len(tokens))
	rows = frappe.db.sql(
		f"""SELECT item_code
		    FROM `tab{TOKEN_DOCTYPE}`
		    WHERE token IN ({placeholders})
		    GROUP BY item_code
		    HAVING COUNT(DISTINCT token) = %s
		    LIMIT %s""",
		[*tokens, len(tokens), limit],
		as_dict=True,
	)
	return [row.item_code for row in rows]


def token_match_subquery(term):
	"""Return ``(sql_fragment, params)`` with ``item_code IN (subquery)``.

	Instead of materialising the codes and putting them in a literal ``IN``
	(which grows without bound), let the database resolve the candidates with a
	subquery over the token index. Pagination is applied by the outer query;
	``LIMIT`` is not used here because MariaDB does not allow it in
	``IN (subquery)``.

	Returns ``(None, ())`` when the term produces no tokens (the caller falls
	back to LIKE).
	"""
	tokens = tokenize(term)
	if not tokens:
		return None, ()

	placeholders = ", ".join(["%s"] * len(tokens))
	sql = (
		"item_code IN ("
		f"SELECT t.item_code FROM `tab{TOKEN_DOCTYPE}` t "
		f"WHERE t.token IN ({placeholders}) "
		"GROUP BY t.item_code "
		"HAVING COUNT(DISTINCT t.token) = %s)"
	)
	return sql, (*tokens, len(tokens))


def rebuild_index():
	"""Rebuild the index for all non-disabled items.

	Runs inline for small catalogues; enqueues a long job for large ones.
	Returns a dict describing what happened.
	"""
	total = frappe.db.count("Item", {"disabled": 0})
	if total > REBUILD_INLINE_MAX:
		frappe.enqueue(
			"itemflow.search_index._rebuild_index_inline",
			queue="long",
			timeout=max(600, total),
			job_name="itemflow_rebuild_search_index",
			now=frappe.flags.in_test,
		)
		return {"queued": True, "total": total}
	_rebuild_index_inline()
	return {"queued": False, "total": total}


def _rebuild_index_inline():
	"""Rebuild the whole index in batches (committing after each batch)."""
	frappe.db.delete(TOKEN_DOCTYPE)
	start = 0
	indexed = 0
	while True:
		items = frappe.get_all(
			"Item",
			filters={"disabled": 0},
			fields=["name", "item_code", "item_name", "brand"],
			order_by="name asc",
			offset=start,
			limit=BATCH_SIZE,
		)
		if not items:
			break
		_write_rows(_build_rows(items))
		frappe.db.commit()
		indexed += len(items)
		start += BATCH_SIZE
	frappe.db.commit()
	return indexed
