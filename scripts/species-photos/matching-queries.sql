-- Species reference photos: matching the old website backup to public.species.
-- READ ONLY. Run each query on its own in the Supabase SQL Editor (select it, then Run).
-- Names are compared ignoring letter case, spaces at the ends and repeated spaces.
-- The iNaturalist photo id is the number after /photos/ in the backup URL.


-- Q1. Backup rows: total, and rows whose photo URL has no iNaturalist photo id.
SELECT
    count(*)                                                               AS backup_rows,
    count(*) FILTER (WHERE substring(photo FROM '/photos/([0-9]+)/') IS NULL) AS rows_without_photo_id,
    count(DISTINCT lower(regexp_replace(btrim(scientific_name), '\s+', ' ', 'g'))) AS distinct_names
FROM public.website_species_backup_20261106;


-- Q2. Matched / unmatched backup rows (and how many matched rows belong to approved species).
SELECT
    count(*) FILTER (WHERE s.id IS NOT NULL)                                  AS matched_rows,
    count(*) FILTER (WHERE s.id IS NOT NULL AND s.verification_status = 'approved') AS matched_rows_approved_species,
    count(*) FILTER (WHERE s.id IS NOT NULL AND s.verification_status <> 'approved') AS matched_rows_other_status,
    count(*) FILTER (WHERE s.id IS NULL)                                      AS unmatched_rows,
    count(DISTINCT b.scientific_name) FILTER (WHERE s.id IS NULL)             AS unmatched_names
FROM public.website_species_backup_20261106 b
LEFT JOIN public.species s
  ON lower(regexp_replace(btrim(s.scientific_name), '\s+', ' ', 'g'))
   = lower(regexp_replace(btrim(b.scientific_name), '\s+', ' ', 'g'));


-- Q3. Duplicates.
--   duplicate_backup_rows: rows that repeat the same species + photo as an earlier row
--                          (the old website had one row per species AND location).
--   names_with_several_photos: species that have more than one different photo in the backup.
--   species_names_duplicated: names that appear more than once in public.species itself
--                             (a backup row could then match two species; check these by hand).
WITH b AS (
    SELECT lower(regexp_replace(btrim(scientific_name), '\s+', ' ', 'g')) AS name_key,
           substring(photo FROM '/photos/([0-9]+)/') AS photo_id
    FROM public.website_species_backup_20261106
)
SELECT
    (SELECT count(*) - count(DISTINCT (name_key, photo_id)) FROM b)            AS duplicate_backup_rows,
    (SELECT count(*) FROM (SELECT name_key FROM b GROUP BY name_key
                           HAVING count(DISTINCT photo_id) > 1) x)            AS names_with_several_photos,
    (SELECT count(*) FROM (SELECT lower(regexp_replace(btrim(scientific_name), '\s+', ' ', 'g'))
                           FROM public.species GROUP BY 1 HAVING count(*) > 1) x) AS species_names_duplicated;


-- Q4. The backup names that match no species (fix by hand if it's a typo or synonym).
SELECT b.scientific_name, count(*) AS backup_rows
FROM public.website_species_backup_20261106 b
LEFT JOIN public.species s
  ON lower(regexp_replace(btrim(s.scientific_name), '\s+', ' ', 'g'))
   = lower(regexp_replace(btrim(b.scientific_name), '\s+', ' ', 'g'))
WHERE s.id IS NULL
GROUP BY b.scientific_name
ORDER BY b.scientific_name;


-- Q5. EXPORT: the list the licence script reads.
-- One line per approved species + different backup photo (duplicates removed).
-- Only approved species: the photo upload refuses others.
-- In the SQL Editor, run this, then use "Export" -> "Download CSV" and save it as
--   scripts/species-photos/species-photo-list.csv
SELECT DISTINCT
    s.id                                                     AS species_id,
    s.scientific_name                                        AS scientific_name,
    b.photo                                                  AS backup_photo_url,
    substring(b.photo FROM '/photos/([0-9]+)/')              AS inat_photo_id
FROM public.species s
JOIN public.website_species_backup_20261106 b
  ON lower(regexp_replace(btrim(s.scientific_name), '\s+', ' ', 'g'))
   = lower(regexp_replace(btrim(b.scientific_name), '\s+', ' ', 'g'))
WHERE s.verification_status = 'approved'
ORDER BY s.scientific_name, inat_photo_id;
