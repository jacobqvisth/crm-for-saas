-- Remember which Webflow CMS item an article became.
--
-- Without this, a staged article was a dead end: the row had a published_url but
-- no way to identify the item in Webflow, so "publish it live" could only have
-- meant creating a second item at a conflicting slug. The publish route now
-- stores the item id on create, so going from staged to live publishes the
-- existing item instead of duplicating it.
--
-- Also lets a future edit update the item in place, which is the only safe way
-- to change something already published: deleting a published Webflow item keeps
-- its slug reserved and the page live, so delete-and-recreate is a trap.

ALTER TABLE articles ADD COLUMN IF NOT EXISTS webflow_item_id TEXT;

COMMENT ON COLUMN articles.webflow_item_id IS
  'Webflow CMS item id, set when the article is first sent to the site. Present and status=approved means staged but not public; present and status=published means live.';
