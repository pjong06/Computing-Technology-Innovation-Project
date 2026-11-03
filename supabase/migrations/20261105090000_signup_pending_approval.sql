-- Close the self-sign-up hole.
--
-- Before: supabase.auth.signUp() with the public key ran handle_website_signup(), which
-- created an ACTIVE botanist profile and an active website_users row. Anyone could make a
-- working botanist account.
-- After:
--   1. New sign-ups get account_status = 'pending' (role stays 'botanist': profiles.role
--      is NOT NULL and its CHECK allows only botanist/officer/researcher) and an inactive
--      website_users row. current_app_role() already returns NULL unless the account is
--      active, and the backend's requireAuth already rejects non-active accounts, so a
--      pending account can do nothing anywhere.
--      Role and status in the user's sign-up metadata are ignored (only username and
--      name are read, as before).
--   2. Activation reuses the existing path: the officer sets the website_users row to
--      active on the User & role admin page; sync_website_user_to_profile() copies it to
--      the profile. That function now keeps 'pending' until the officer activates, instead
--      of turning an edited-but-not-activated sign-up into the inactive status.
--   3. Defence in depth: signed-in users lose the UPDATE privilege on profiles.role and
--      profiles.account_status (they keep full_name). Nothing in the app, web portal or
--      backend updates those columns as the user; the sync function runs as its owner
--      (SECURITY DEFINER), so it is not affected. protect_profile_privileges() stays.
-- Existing accounts and policies are not changed.
--
-- One transaction: if anything fails, nothing is applied.

BEGIN;

-- 1. Sign-ups start pending. Same as the current function except the two marked lines.
CREATE OR REPLACE FUNCTION public.handle_website_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  chosen_username text;
  shown_name text;
begin
  if coalesce(new.raw_user_meta_data->>'source', '') <> 'website' then
    return new;
  end if;

  chosen_username := coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1));
  shown_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), chosen_username);

  -- CHANGED: 'pending', not 'active'. An officer activates the account.
  insert into public.profiles (id, full_name, role, account_status)
  values (new.id, shown_name, 'botanist', 'pending')
  on conflict (id) do nothing;

  -- CHANGED: active = false until the officer activates it.
  insert into public.website_users (id, name, username, email, role, active, sort_order)
  values (new.id, shown_name, chosen_username, new.email, 'Botanist', false,
          (select coalesce(max(sort_order), -1) + 1 from public.website_users))
  on conflict (id) do nothing;

  return new;
end $function$;

-- 2. Same as the current function, except an inactive row keeps a 'pending' profile
--    pending (only an officer setting active = true lets the account in).
CREATE OR REPLACE FUNCTION public.sync_website_user_to_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    execute format('update public.profiles set account_status = %L where id = %L',
                   public.website_inactive_status(), old.id);
    return old;
  end if;
  execute format('update public.profiles set role = %L, account_status = '
                 || 'case when %L::boolean then ''active'' '
                 || 'when account_status = ''pending'' then ''pending'' '
                 || 'else %L end where id = %L',
                 case when new.role = 'Conservation Officer' then 'officer' else 'botanist' end,
                 new.active,
                 public.website_inactive_status(),
                 new.id);
  return new;
end $function$;

-- 3. Signed-in users can no longer write role or account_status at all (column level).
--    Table-level UPDATE is revoked too in case it was ever granted, then only full_name
--    (the one column the app may edit) is granted back.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated, anon;
REVOKE UPDATE (role, account_status) ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

COMMIT;
