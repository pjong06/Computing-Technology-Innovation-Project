# Website access-control changes

These migrations restrict the website tables by trusted profile role and observation ownership.

- Administrators manage website users and supported roles.
- Officers manage species and review observations.
- Botanists submit their own Draft/Pending observations and edit only their own Draft/Rejected submissions.
- Researchers read approved observations and the internal species catalogue.
- Observation review changes are limited to state and rejection reason.
- Observation identity/ownership cannot be changed by clients.
- Existing observations are not assigned owners from display names.
- Excess client table-management privileges are removed from the three website tables.

## Integration
The browser-storage prototype is not converted to a Supabase client by this change. A future integration must use Supabase Auth user tokens, handle RLS failures, preserve owner_id, and update page controls from the trusted profile role. User creation requires a pre-existing Auth profile. Botanist/public species browsing should use the separate approved-species API rather than the internal location-bearing catalogue. Never expose service-role credentials.

## Test
supabase/tests/website_access_smoke.sql is a privileged, database-level smoke test. Run it on development/staging data with active botanist, officer, administrator and researcher profiles, a second active botanist, a suspended profile and a profile-backed website user. Fixture changes are deliberately rolled back. It does not test real Auth sign-ins or browser integration.

## Migration history
The migration filenames mirror the versions assigned by Supabase when applied. Review migration history before deployment to avoid reapplying them to a database that already recorded these versions.
