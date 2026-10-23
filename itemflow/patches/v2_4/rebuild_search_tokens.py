from itemflow.search_index import rebuild_index


def execute():
	"""Backfill the n-gram search index for items that already exist."""
	rebuild_index()
