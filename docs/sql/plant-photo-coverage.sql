-- Read-only: which active approved plants have a photo the public copy can use.
--   (a) with_plant_photo            - a plant_media photo (not deleted)
--   (b) only_observation_photos     - no plant_media photo, but observation photos
--         b1 on_approved_observation  - one of them on an approved, active observation
--                                       (the public copy now falls back to these)
--         b2 only_unapproved          - only on observations not (yet) approved
--   (c) no_photo                    - no photo at all
-- Run in the Supabase SQL editor (it only reads).

WITH active_approved AS (
    SELECT p.id
    FROM public.plants AS p
    WHERE p.plant_status = 'approved'
      AND p.deleted_at IS NULL
),
classified AS (
    SELECT
        a.id,
        EXISTS (
            SELECT 1 FROM public.plant_media AS m
            WHERE m.plant_id = a.id AND m.deleted_at IS NULL
        ) AS has_plant_photo,
        EXISTS (
            SELECT 1
            FROM public.observations AS o
            JOIN public.observation_media AS om ON om.observation_id = o.id
            WHERE o.plant_id = a.id AND o.deleted_at IS NULL
        ) AS has_observation_photo,
        EXISTS (
            SELECT 1
            FROM public.observations AS o
            JOIN public.observation_media AS om ON om.observation_id = o.id
            WHERE o.plant_id = a.id AND o.deleted_at IS NULL AND o.review_status = 'approved'
        ) AS has_approved_observation_photo
    FROM active_approved AS a
)
SELECT
    count(*)                                                           AS active_approved_plants,
    count(*) FILTER (WHERE has_plant_photo)                            AS a_with_plant_photo,
    count(*) FILTER (WHERE NOT has_plant_photo AND has_observation_photo) AS b_only_observation_photos,
    count(*) FILTER (WHERE NOT has_plant_photo AND has_approved_observation_photo) AS b1_on_approved_observation,
    count(*) FILTER (WHERE NOT has_plant_photo AND has_observation_photo
                       AND NOT has_approved_observation_photo)         AS b2_only_unapproved,
    count(*) FILTER (WHERE NOT has_plant_photo AND NOT has_observation_photo) AS c_no_photo
FROM classified;
