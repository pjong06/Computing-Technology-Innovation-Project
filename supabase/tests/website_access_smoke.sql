-- All fixture changes run in a subtransaction that is rolled back deliberately.
CREATE TEMP TABLE website_security_test_result(result jsonb);
DO $$
DECLARE b uuid; b2 uuid; o uuid; a uuid; r uuid; s uuid; obs text := 'security-test-' || gen_random_uuid();
 n integer; passed integer := 0; denied boolean; fixture_user uuid; species_id uuid := gen_random_uuid(); actor uuid;
BEGIN
 SELECT id INTO b FROM public.profiles WHERE role='botanist' AND account_status='active' LIMIT 1;
 SELECT id INTO b2 FROM public.profiles WHERE role='botanist' AND account_status='active' AND id<>b LIMIT 1;
 SELECT id INTO o FROM public.profiles WHERE role='officer' AND account_status='active' LIMIT 1;
 SELECT id INTO a FROM public.profiles WHERE role='admin' AND account_status='active' LIMIT 1;
 SELECT id INTO r FROM public.profiles WHERE role='researcher' AND account_status='active' LIMIT 1;
 SELECT id INTO s FROM public.profiles WHERE account_status='suspended' LIMIT 1;
 IF b IS NULL OR b2 IS NULL OR o IS NULL OR a IS NULL OR r IS NULL OR s IS NULL THEN
  RAISE EXCEPTION 'Missing role fixtures'; END IF;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.website_observations(id,scientific_name,state) VALUES(obs,'Security test','Draft');
  passed := passed+1;
  denied := false;
  BEGIN
   INSERT INTO public.website_observations(id,scientific_name,state,owner_id) VALUES(obs||'-spoof','Security test','Draft',b2);
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Ownership spoof accepted'; END IF; passed := passed+1;
  denied := false;
  BEGIN
   INSERT INTO public.website_observations(id,scientific_name,state) VALUES(obs||'-approve','Security test','Approved');
  EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Botanist self-approval accepted'; END IF; passed := passed+1;
  UPDATE public.website_observations SET notes='editable',state='Pending' WHERE id=obs;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Own Draft submission failed'; END IF; passed:=passed+1;
  UPDATE public.website_observations SET notes='must not change' WHERE id=obs;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Pending observation edited'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',b2::text,true);
  SELECT count(*) INTO n FROM public.website_observations WHERE id=obs;
  IF n<>0 THEN RAISE EXCEPTION 'Other botanist sees private submission'; END IF; passed:=passed+1;
  UPDATE public.website_observations SET state='Approved' WHERE id=obs;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Other botanist writes submission'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',o::text,true);
  denied:=false;
  BEGIN UPDATE public.website_observations SET notes='altered evidence',state='Approved' WHERE id=obs;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Officer changed submitted evidence'; END IF; passed:=passed+1;
  denied:=false;
  BEGIN UPDATE public.website_observations SET state='Rejected' WHERE id=obs;
  EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Empty rejection accepted'; END IF; passed:=passed+1;
  UPDATE public.website_observations SET state='Rejected',reject_reason='Please verify' WHERE id=obs;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Officer rejection failed'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  UPDATE public.website_observations SET state='Pending',reject_reason='',notes='corrected' WHERE id=obs;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Owner resubmission failed'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',r::text,true);
  SELECT count(*) INTO n FROM public.website_observations WHERE id=obs;
  IF n<>0 THEN RAISE EXCEPTION 'Researcher sees pending submission'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',o::text,true);
  UPDATE public.website_observations SET state='Approved' WHERE id=obs;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Officer approval failed'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',r::text,true);
  SELECT count(*) INTO n FROM public.website_observations WHERE id=obs;
  IF n<>1 THEN RAISE EXCEPTION 'Researcher cannot see approved observation'; END IF; passed:=passed+1;
  UPDATE public.website_observations SET notes='researcher write' WHERE id=obs;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'Researcher edited observation'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',s::text,true);
  SELECT count(*) INTO n FROM public.website_observations;
  IF n<>0 THEN RAISE EXCEPTION 'Suspended user sees observations'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  SELECT count(*) INTO n FROM public.website_observations;
  IF n<>0 THEN RAISE EXCEPTION 'Admin sees raw ecological observations'; END IF; passed:=passed+1;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',o::text,true);
  INSERT INTO public.website_species(id,scientific_name) VALUES(species_id,'Security test');
  passed:=passed+1;
  UPDATE public.website_species SET description='Officer edited' WHERE id=species_id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Officer catalogue edit failed'; END IF; passed:=passed+1;
  FOREACH actor IN ARRAY ARRAY[b,r,a,s] LOOP
   PERFORM set_config('request.jwt.claim.sub',actor::text,true);
   denied:=false;
   BEGIN INSERT INTO public.website_species(id,scientific_name) VALUES(gen_random_uuid(),'Must fail');
   EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   IF NOT denied THEN RAISE EXCEPTION 'Non-officer created species'; END IF; passed:=passed+1;
   UPDATE public.website_species SET description='Must fail' WHERE id=species_id;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>0 THEN RAISE EXCEPTION 'Non-officer edited species'; END IF; passed:=passed+1;
   DELETE FROM public.website_species WHERE id=species_id;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>0 THEN RAISE EXCEPTION 'Non-officer deleted species'; END IF; passed:=passed+1;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub',o::text,true);
  DELETE FROM public.website_species WHERE id=species_id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Officer species delete failed'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  denied:=false;
  BEGIN DELETE FROM public.website_observations WHERE id=obs;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Observation deletion privilege remains'; END IF; passed:=passed+1;
  RESET ROLE;
  SET LOCAL ROLE anon;
  denied:=false;
  BEGIN PERFORM count(*) FROM public.website_users;
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Anonymous user data access allowed'; END IF; passed:=passed+1;
  RESET ROLE;
  -- Use an existing profile-backed user only inside the rollback fixture.
  SELECT id INTO fixture_user FROM public.website_users WHERE id IN (SELECT id FROM public.profiles) LIMIT 1;
  IF fixture_user IS NULL THEN RAISE EXCEPTION 'Missing website-user fixture'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',o::text,true);
  SELECT count(*) INTO n FROM public.website_users;
  IF n<>0 THEN RAISE EXCEPTION 'Officer retains user management access'; END IF; passed:=passed+1;
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  UPDATE public.website_users SET role='Researcher' WHERE id=fixture_user;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'Admin user management denied'; END IF; passed:=passed+1;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.profiles WHERE id=fixture_user AND role='researcher';
  IF n<>1 THEN RAISE EXCEPTION 'Researcher mapping failed'; END IF; passed:=passed+1;
  -- Preserve the acting admin fixture if that same row was selected above.
  UPDATE public.profiles SET role='admin',account_status='active' WHERE id=a;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  UPDATE public.website_users SET role='Administrator' WHERE id=fixture_user;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.profiles WHERE id=fixture_user AND role='admin';
  IF n<>1 THEN RAISE EXCEPTION 'Administrator mapping failed'; END IF; passed:=passed+1;
  SET LOCAL ROLE authenticated;
  denied:=false;
  BEGIN UPDATE public.website_users SET role='Unrecognized' WHERE id=fixture_user;
  EXCEPTION WHEN check_violation THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Unknown role silently accepted'; END IF; passed:=passed+1;
  RESET ROLE;
  FOR n IN 1..2 LOOP
   IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN (VALUES('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
    WHERE c.oid IN ('public.website_users'::regclass,'public.website_species'::regclass,'public.website_observations'::regclass)
    AND has_table_privilege(CASE n WHEN 1 THEN 'anon' ELSE 'authenticated' END,c.oid,p.priv)) THEN
    RAISE EXCEPTION 'Excess client privilege remains'; END IF;
   passed:=passed+1;
  END LOOP;
  RAISE EXCEPTION 'rollback_security_fixtures' USING ERRCODE='Z0001';
 EXCEPTION WHEN SQLSTATE 'Z0001' THEN
  INSERT INTO website_security_test_result VALUES(jsonb_build_object('passed',passed,'fixtures_rolled_back',true));
 END;
END $$;
SELECT * FROM website_security_test_result;
