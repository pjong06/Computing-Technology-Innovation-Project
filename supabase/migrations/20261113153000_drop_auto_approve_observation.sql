-- This dashboard-created trigger auto-approved botanist submissions
-- (draft/rejected -> pending), bypassing officer review. It was removed
-- manually from the dashboard on 2026-11-13.
drop trigger if exists biotrack_auto_approve_observation on public.observations;
drop function if exists public.auto_approve_submitted_observation();
