-- C17. Apply only after local review and database integration testing.
BEGIN;
CREATE TABLE public.tag_reservation_batches (
  request_id uuid NOT NULL,
  reserved_by uuid NOT NULL REFERENCES public.profiles(id),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reserved_by, request_id)
);
CREATE TABLE public.tag_reservations (
  qr_code_value text PRIMARY KEY CHECK (qr_code_value ~ '^NIAH-PLT-[0-9]{5}$'),
  reserved_by uuid NOT NULL REFERENCES public.profiles(id),
  request_id uuid NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  bound_plant_id uuid UNIQUE,
  bound_at timestamptz,
  FOREIGN KEY (reserved_by, request_id)
    REFERENCES public.tag_reservation_batches(reserved_by, request_id),
  CHECK ((bound_plant_id IS NULL) = (bound_at IS NULL))
);
-- bound_plant_id deliberately has no cascading FK: deletion must never recycle a tag.
CREATE INDEX tag_reservations_owner_order_idx
ON public.tag_reservations(reserved_by, reserved_at DESC, qr_code_value);
CREATE INDEX tag_reservations_owner_request_idx
ON public.tag_reservations(reserved_by, request_id);
ALTER TABLE public.tag_reservation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tag_reservation_batches, public.tag_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tag_reservations TO authenticated;
CREATE POLICY tag_reservations_read_own ON public.tag_reservations FOR SELECT TO authenticated
USING (reserved_by = auth.uid() AND public.current_app_role() = 'botanist');

-- Preserve existing physical labels without changing plant rows. Keep their numbers
-- permanently consumed even if the corresponding plant is later deleted.
INSERT INTO public.tag_reservation_batches(reserved_by, request_id, quantity)
SELECT registered_by, id, 1 FROM public.plants
WHERE qr_code_value ~ '^NIAH-PLT-[0-9]{5}$';
INSERT INTO public.tag_reservations(qr_code_value, reserved_by, request_id, bound_plant_id, bound_at)
SELECT qr_code_value, registered_by, id, id, now() FROM public.plants
WHERE qr_code_value ~ '^NIAH-PLT-[0-9]{5}$';

CREATE FUNCTION public.reserve_plant_tags(p_count integer, p_request_id uuid)
RETURNS TABLE(qr_code_value text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE existing_count integer; tags text[];
BEGIN
  IF auth.uid() IS NULL OR public.current_app_role() IS DISTINCT FROM 'botanist' THEN
    RAISE EXCEPTION 'Botanist access required' USING ERRCODE = '42501';
  END IF;
  IF p_count IS NULL OR p_count NOT BETWEEN 1 AND 100 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid reservation request' USING ERRCODE = '22023';
  END IF;
  -- Serialize allocation and idempotent retries across all application instances.
  PERFORM pg_catalog.pg_advisory_xact_lock(310031, 17);
  SELECT b.quantity INTO existing_count FROM public.tag_reservation_batches b
    WHERE b.reserved_by = auth.uid() AND b.request_id = p_request_id;
  IF FOUND THEN
    IF existing_count <> p_count THEN
      RAISE EXCEPTION 'Request ID already used with another quantity' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT pg_catalog.array_agg(candidate ORDER BY candidate) INTO tags FROM (
      SELECT 'NIAH-PLT-' || pg_catalog.lpad(n::text, 5, '0') AS candidate
      FROM pg_catalog.generate_series(1, 99999) n
      WHERE NOT EXISTS (SELECT 1 FROM public.plants p
        WHERE p.qr_code_value = 'NIAH-PLT-' || pg_catalog.lpad(n::text, 5, '0'))
      AND NOT EXISTS (SELECT 1 FROM public.tag_reservations r
        WHERE r.qr_code_value = 'NIAH-PLT-' || pg_catalog.lpad(n::text, 5, '0'))
      ORDER BY n LIMIT p_count
    ) available;
    IF COALESCE(pg_catalog.array_length(tags, 1), 0) <> p_count THEN
      RAISE EXCEPTION 'Tag number space exhausted' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.tag_reservation_batches(reserved_by, request_id, quantity)
      VALUES(auth.uid(), p_request_id, p_count);
    INSERT INTO public.tag_reservations(qr_code_value, reserved_by, request_id)
      SELECT tag, auth.uid(), p_request_id FROM pg_catalog.unnest(tags) tag;
  END IF;
  RETURN QUERY SELECT r.qr_code_value FROM public.tag_reservations r
    WHERE r.reserved_by = auth.uid() AND r.request_id = p_request_id ORDER BY r.qr_code_value;
END;
$fn$;

CREATE FUNCTION public.enforce_reserved_plant_tag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE reservation public.tag_reservations%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.qr_code_value ~ '^NIAH-PLT-[0-9]{5}$'
       AND NEW.registered_by IS DISTINCT FROM OLD.registered_by THEN
      RAISE EXCEPTION 'A tagged plant cannot change owner' USING ERRCODE = '42501';
    END IF;
    IF NEW.qr_code_value IS NOT DISTINCT FROM OLD.qr_code_value THEN RETURN NEW; END IF;
    IF OLD.qr_code_value ~ '^NIAH-PLT-[0-9]{5}$' THEN
      RAISE EXCEPTION 'A physical tag cannot be replaced' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.qr_code_value !~ '^NIAH-PLT-[0-9]{5}$' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR public.current_app_role() IS DISTINCT FROM 'botanist'
     OR NEW.registered_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the botanist owner may bind a tag' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO reservation FROM public.tag_reservations r
    WHERE r.qr_code_value = NEW.qr_code_value FOR UPDATE;
  IF NOT FOUND OR reservation.reserved_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Tag is not reserved by this botanist' USING ERRCODE = '42501';
  END IF;
  IF reservation.bound_plant_id IS NOT NULL THEN
    RAISE EXCEPTION 'Tag has already been used' USING ERRCODE = '23505';
  END IF;
  UPDATE public.tag_reservations SET bound_plant_id = NEW.id, bound_at = now()
    WHERE qr_code_value = NEW.qr_code_value;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER plants_require_reserved_tag BEFORE INSERT OR UPDATE OF qr_code_value, registered_by
ON public.plants FOR EACH ROW EXECUTE FUNCTION public.enforce_reserved_plant_tag();

CREATE FUNCTION public.attach_reserved_plant_tag(p_plant_id uuid, p_tag text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE plant public.plants%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_app_role() IS DISTINCT FROM 'botanist' THEN
    RAISE EXCEPTION 'Botanist access required' USING ERRCODE = '42501';
  END IF;
  IF p_tag IS NULL OR p_tag !~ '^NIAH-PLT-[0-9]{5}$' OR p_plant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid plant or tag' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO plant FROM public.plants WHERE id = p_plant_id FOR UPDATE;
  IF NOT FOUND OR plant.registered_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Plant is unavailable' USING ERRCODE = '42501';
  END IF;
  IF plant.qr_code_value = p_tag THEN RETURN plant.id; END IF;
  UPDATE public.plants SET qr_code_value = p_tag, row_version = row_version + 1
    WHERE id = p_plant_id;
  RETURN p_plant_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reserve_plant_tags(integer, uuid),
  public.attach_reserved_plant_tag(uuid, text), public.enforce_reserved_plant_tag()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_plant_tags(integer, uuid),
  public.attach_reserved_plant_tag(uuid, text) TO authenticated;
COMMIT;
