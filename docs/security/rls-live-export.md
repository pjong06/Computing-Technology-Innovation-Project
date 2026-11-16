# 6. 线上 RLS 证据

| Label | 内容 |
| --- | --- |
| where | Niah Supabase public schema；本文件对应同名 JSON 原始导出 |
| what happen | 25/25 张表已启用 RLS；78 条 policies；本次补齐仓库证据与幂等 migration |
| why | 部分设置来自 dashboard，不能仅靠已有 migration 证明当前状态 |
| 后果 | 本导出证明配置现状，不证明每条 policy 正确或全部角色业务验收通过 |
| how to fix | migration 只 ENABLE ROW LEVEL SECURITY；保留 policy、grants、owner 和 FORCE RLS；尚未正式应用 |

## 表状态

表级 SELECT 指示不包含列级授权，也不等于可以读取所有行。无 policy 的表保持默认拒绝普通调用者；不会为其新增放行规则。

| 表 | RLS | policies | anon 表级 SELECT | authenticated 表级 SELECT |
| --- | --- | --- | --- | --- |
| alert_camera_evidence | ON | 2 | false | true |
| alert_rules | ON | 1 | false | false |
| alerts | ON | 5 | false | true |
| audit_logs | ON | 2 | false | true |
| observation_media | ON | 6 | false | true |
| observation_reviews | ON | 4 | false | true |
| observations | ON | 9 | false | true |
| park_visitors | ON | 5 | false | true |
| plant_edit_requests | ON | 0 | false | false |
| plant_media | ON | 3 | false | true |
| plant_observation_history | ON | 2 | false | true |
| plants | ON | 8 | false | true |
| profiles | ON | 4 | false | true |
| sensor_readings | ON | 2 | false | true |
| sensor_stations | ON | 2 | false | true |
| species | ON | 5 | true | true |
| species_media | ON | 6 | true | true |
| species_reference_photos | ON | 1 | false | true |
| sync_events | ON | 4 | false | true |
| tag_reservation_batches | ON | 0 | false | false |
| tag_reservations | ON | 1 | false | true |
| taxonomy | ON | 3 | true | true |
| website_plant_migration_map | ON | 0 | false | false |
| website_species | ON | 2 | false | true |
| website_users | ON | 1 | false | true |

## Policy 原文

| 表 | Policy | roles | command | permissive | USING | WITH CHECK |
| --- | --- | --- | --- | --- | --- | --- |
| alert_camera_evidence | botanists_researchers_read_camera_evidence | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['botanist'::text, 'researcher'::text])) | — |
| alert_camera_evidence | camera_evidence_officer_read | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = 'officer'::text) | — |
| alert_rules | officers manage alert rules | authenticated | ALL | PERMISSIVE | (current_app_role() = 'officer'::text) | (current_app_role() = 'officer'::text) |
| alerts | botanists and researchers read alerts | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['botanist'::text, 'researcher'::text])) | — |
| alerts | officer_delete_iot_alerts | authenticated | DELETE | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = 'officer'::text) | — |
| alerts | officers read alerts | authenticated | SELECT | PERMISSIVE | (current_app_role() = 'officer'::text) | — |
| alerts | officers update alerts | authenticated | UPDATE | PERMISSIVE | (current_app_role() = 'officer'::text) | (current_app_role() = 'officer'::text) |
| alerts | staff_handle_alerts | authenticated | UPDATE | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['botanist'::text, 'researcher'::text])) | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['botanist'::text, 'researcher'::text])) |
| audit_logs | botanists read own audit logs | authenticated | SELECT | PERMISSIVE | ((owner_id = auth.uid()) AND (current_app_role() = 'botanist'::text)) | — |
| audit_logs | officers read audit logs | authenticated | SELECT | PERMISSIVE | (current_app_role() = 'officer'::text) | — |
| observation_media | botanists read approved observation photos | authenticated | SELECT | PERMISSIVE | ((current_app_role() = 'botanist'::text) AND (EXISTS ( SELECT 1 FROM observations o WHERE ((o.id = observation_media.observation_id) AND (o.review_status = 'approved'::text) AND (o.deleted_at IS NULL))))) | — |
| observation_media | botanists read photos of own observations | authenticated | SELECT | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (EXISTS ( SELECT 1 FROM observations o WHERE ((o.id = observation_media.observation_id) AND (o.observer_id = ( SELECT auth.uid() AS uid)) AND (o.deleted_at IS NULL))))) | — |
| observation_media | botanists upload photos to editable observations | authenticated | INSERT | PERMISSIVE | — | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM observations o WHERE ((o.id = observation_media.observation_id) AND (o.observer_id = ( SELECT auth.uid() AS uid)) AND (o.review_status = ANY (ARRAY['draft'::text, 'rejected'::text])) AND (o.deleted_at IS NULL)))) AND security_private.can_link_observation_object(file_path)) |
| observation_media | officers read observation photos | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = 'officer'::text) | — |
| observation_media | officers upload own observation media | authenticated | INSERT | PERMISSIVE | — | ((( SELECT current_app_role() AS current_app_role) = 'officer'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM observations o WHERE ((o.id = observation_media.observation_id) AND (o.observer_id = ( SELECT auth.uid() AS uid)) AND (o.review_status = ANY (ARRAY['draft'::text, 'rejected'::text])) AND (o.deleted_at IS NULL))))) |
| observation_media | researchers read approved observation photos | authenticated | SELECT | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = 'researcher'::text) AND (EXISTS ( SELECT 1 FROM observations o WHERE ((o.id = observation_media.observation_id) AND (o.review_status = 'approved'::text) AND (o.deleted_at IS NULL))))) | — |
| observation_reviews | botanists read reviews of own observations | authenticated | SELECT | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (EXISTS ( SELECT 1 FROM observations o WHERE ((o.id = observation_reviews.observation_id) AND (o.observer_id = ( SELECT auth.uid() AS uid)) AND (o.deleted_at IS NULL))))) | — |
| observation_reviews | officers create pending observation reviews | authenticated | INSERT | PERMISSIVE | — | ((( SELECT current_app_role() AS current_app_role) = 'officer'::text) AND (reviewer_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM observations o WHERE ((o.id = observation_reviews.observation_id) AND (o.review_status = 'pending'::text) AND (o.deleted_at IS NULL))))) |
| observation_reviews | officers read observation reviews | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = 'officer'::text) | — |
| observation_reviews | researchers read approved observation reviews | authenticated | SELECT | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = 'researcher'::text) AND (EXISTS ( SELECT 1 FROM observations o WHERE ((o.id = observation_reviews.observation_id) AND (o.review_status = 'approved'::text) AND (o.deleted_at IS NULL))))) | — |
| observations | botanists create draft observations | authenticated | INSERT | PERMISSIVE | — | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (observer_id = ( SELECT auth.uid() AS uid)) AND (review_status = 'draft'::text) AND (deleted_at IS NULL) AND (deleted_by IS NULL) AND (EXISTS ( SELECT 1 FROM plants p WHERE ((p.id = observations.plant_id) AND (p.registered_by = ( SELECT auth.uid() AS uid)))))) |
| observations | botanists delete own draft observations | authenticated | DELETE | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (observer_id = ( SELECT auth.uid() AS uid)) AND (review_status = 'draft'::text) AND (deleted_at IS NULL)) | — |
| observations | botanists edit own draft or rejected observations | authenticated | UPDATE | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (observer_id = ( SELECT auth.uid() AS uid)) AND (review_status = ANY (ARRAY['draft'::text, 'rejected'::text])) AND (deleted_at IS NULL)) | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (observer_id = ( SELECT auth.uid() AS uid)) AND (review_status = ANY (ARRAY['draft'::text, 'rejected'::text, 'pending'::text])) AND (deleted_at IS NULL) AND (deleted_by IS NULL) AND (EXISTS ( SELECT 1 FROM plants p WHERE ((p.id = observations.plant_id) AND (p.registered_by = ( SELECT auth.uid() AS uid)))))) |
| observations | botanists read own active observations | authenticated | SELECT | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (observer_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL)) | — |
| observations | officers create own observations | authenticated | INSERT | PERMISSIVE | — | ((current_app_role() = 'officer'::text) AND (observer_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM plants p WHERE ((p.id = observations.plant_id) AND (p.deleted_at IS NULL))))) |
| observations | officers read all observations | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = 'officer'::text) | — |
| observations | officers reopen rejected observations | authenticated | UPDATE | PERMISSIVE | ((current_app_role() = 'officer'::text) AND (review_status = 'rejected'::text) AND (deleted_at IS NULL)) | ((current_app_role() = 'officer'::text) AND (review_status = 'pending'::text) AND (deleted_at IS NULL)) |
| observations | officers soft-delete or restore approved observations | authenticated | UPDATE | PERMISSIVE | ((current_app_role() = 'officer'::text) AND (review_status = 'approved'::text)) | ((current_app_role() = 'officer'::text) AND (review_status = 'approved'::text)) |
| observations | staff read approved active observations | authenticated | SELECT | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['botanist'::text, 'researcher'::text])) AND (review_status = 'approved'::text) AND (deleted_at IS NULL)) | — |
| park_visitors | staff create park visits | authenticated | INSERT | PERMISSIVE | — | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['officer'::text, 'admin'::text])) |
| park_visitors | staff read park visits | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['officer'::text, 'admin'::text])) | — |
| park_visitors | staff update park visits | authenticated | UPDATE | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['officer'::text, 'admin'::text])) | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['officer'::text, 'admin'::text])) |
| park_visitors | visitors create own park visits | authenticated | INSERT | PERMISSIVE | — | (user_id = ( SELECT auth.uid() AS uid)) |
| park_visitors | visitors read own park visits | authenticated | SELECT | PERMISSIVE | (user_id = ( SELECT auth.uid() AS uid)) | — |
| plant_media | botanists upload own editable plant photos | authenticated | INSERT | PERMISSIVE | — | ((( SELECT current_app_role() AS current_app_role) = 'botanist'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM plants p WHERE ((p.id = plant_media.plant_id) AND (p.registered_by = ( SELECT auth.uid() AS uid)) AND (p.plant_status = 'pending'::text) AND (NOT plant_has_submitted_observation(p.id)))))) |
| plant_media | officers upload plant photos | authenticated | INSERT | PERMISSIVE | — | ((current_app_role() = 'officer'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM plants p WHERE ((p.id = plant_media.plant_id) AND (p.plant_status = 'approved'::text))))) |
| plant_media | staff read visible plant photos | authenticated | SELECT | PERMISSIVE | ((( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['botanist'::text, 'officer'::text, 'researcher'::text])) AND (EXISTS ( SELECT 1 FROM plants p WHERE (p.id = plant_media.plant_id)))) | — |
| plant_observation_history | Officers add plant observations | authenticated | INSERT | PERMISSIVE | — | ((staff_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = 'officer'::text) AND (profiles.account_status = 'active'::text))))) |
| plant_observation_history | Read plant observation history | authenticated | SELECT | PERMISSIVE | true | — |
| plants | Officers can register plants | authenticated | INSERT | PERMISSIVE | — | ((registered_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = 'officer'::text))))) |
| plants | botanists create plants | authenticated | INSERT | PERMISSIVE | — | ((registered_by = ( SELECT auth.uid() AS uid)) AND (plant_status = 'pending'::text) AND (current_app_role() = 'botanist'::text)) |
| plants | botanists edit own pending plants | authenticated | UPDATE | PERMISSIVE | ((registered_by = ( SELECT auth.uid() AS uid)) AND (plant_status = 'pending'::text) AND (current_app_role() = 'botanist'::text) AND (NOT plant_has_submitted_observation(id))) | ((registered_by = ( SELECT auth.uid() AS uid)) AND (plant_status = 'pending'::text) AND (current_app_role() = 'botanist'::text) AND (NOT plant_has_submitted_observation(id))) |
| plants | botanists read own plants | authenticated | SELECT | PERMISSIVE | ((registered_by = ( SELECT auth.uid() AS uid)) AND (current_app_role() = 'botanist'::text)) | — |
| plants | officers delete plants | authenticated | DELETE | PERMISSIVE | (current_app_role() = 'officer'::text) | — |
| plants | officers read plants | authenticated | SELECT | PERMISSIVE | (current_app_role() = 'officer'::text) | — |
| plants | officers update plants | authenticated | UPDATE | PERMISSIVE | (current_app_role() = 'officer'::text) | (current_app_role() = 'officer'::text) |
| plants | read approved plants | authenticated | SELECT | PERMISSIVE | ((plant_status = 'approved'::text) AND (current_app_role() = ANY (ARRAY['botanist'::text, 'officer'::text, 'researcher'::text]))) | — |
| profiles | Allow authenticated users to read own profile | authenticated | SELECT | PERMISSIVE | (auth.uid() = id) | — |
| profiles | Users can read their own profile | authenticated | SELECT | PERMISSIVE | (( SELECT auth.uid() AS uid) = id) | — |
| profiles | Users can update their own profile | authenticated | UPDATE | PERMISSIVE | (( SELECT auth.uid() AS uid) = id) | (( SELECT auth.uid() AS uid) = id) |
| profiles | officers read profiles | authenticated | SELECT | PERMISSIVE | (current_app_role() = 'officer'::text) | — |
| sensor_readings | botanists and researchers read sensor readings | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['botanist'::text, 'researcher'::text])) | — |
| sensor_readings | officers read sensor readings | authenticated | SELECT | PERMISSIVE | (current_app_role() = 'officer'::text) | — |
| sensor_stations | officers read stations | authenticated | SELECT | PERMISSIVE | (current_app_role() = 'officer'::text) | — |
| sensor_stations | staff_read_sensor_stations | authenticated | SELECT | PERMISSIVE | (( SELECT current_app_role() AS current_app_role) = ANY (ARRAY['botanist'::text, 'researcher'::text])) | — |
| species | botanists propose species | authenticated | INSERT | PERMISSIVE | — | ((current_app_role() = 'botanist'::text) AND (verification_status = 'pending'::text) AND (proposed_by = auth.uid()) AND (taxonomy_id IS NULL) AND (review_comment IS NULL)) |
| species | botanists read own proposals | authenticated | SELECT | PERMISSIVE | ((current_app_role() = 'botanist'::text) AND (proposed_by = auth.uid())) | — |
| species | officers can permanently delete species | authenticated | DELETE | PERMISSIVE | (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'officer'::text) AND (profiles.account_status = 'active'::text)))) | — |
| species | officers manage species | authenticated | ALL | PERMISSIVE | (current_app_role() = 'officer'::text) | (current_app_role() = 'officer'::text) |
| species | read approved species | anon, authenticated | SELECT | PERMISSIVE | (verification_status = 'approved'::text) | — |
| species_media | approved species media for staff | authenticated | SELECT | PERMISSIVE | ((current_app_role() = ANY (ARRAY['botanist'::text, 'admin'::text])) AND (EXISTS ( SELECT 1 FROM species s WHERE ((s.id = species_media.species_id) AND (s.verification_status = 'approved'::text))))) | — |
| species_media | botanists add own pending species media | authenticated | INSERT | PERMISSIVE | — | ((uploaded_by = ( SELECT auth.uid() AS uid)) AND (is_primary = false) AND (current_app_role() = 'botanist'::text) AND (EXISTS ( SELECT 1 FROM species s WHERE ((s.id = species_media.species_id) AND (s.proposed_by = ( SELECT auth.uid() AS uid)) AND (s.verification_status = 'pending'::text))))) |
| species_media | botanists read own pending species media | authenticated | SELECT | PERMISSIVE | ((current_app_role() = 'botanist'::text) AND (EXISTS ( SELECT 1 FROM species s WHERE ((s.id = species_media.species_id) AND (s.proposed_by = ( SELECT auth.uid() AS uid)) AND (s.verification_status = 'pending'::text))))) | — |
| species_media | officers manage species photos | authenticated | ALL | PERMISSIVE | (current_app_role() = 'officer'::text) | (current_app_role() = 'officer'::text) |
| species_media | public read approved species photos | anon | SELECT | PERMISSIVE | (EXISTS ( SELECT 1 FROM species s WHERE ((s.id = species_media.species_id) AND (s.verification_status = 'approved'::text)))) | — |
| species_media | researchers read approved species media | authenticated | SELECT | PERMISSIVE | ((current_app_role() = 'researcher'::text) AND (EXISTS ( SELECT 1 FROM species s WHERE ((s.id = species_media.species_id) AND (s.verification_status = 'approved'::text))))) | — |
| species_reference_photos | Authenticated users can view reference photos | authenticated | SELECT | PERMISSIVE | true | — |
| sync_events | botanists insert own sync events | authenticated | INSERT | PERMISSIVE | — | ((user_id = auth.uid()) AND (current_app_role() = 'botanist'::text)) |
| sync_events | botanists read own sync events | authenticated | SELECT | PERMISSIVE | ((user_id = auth.uid()) AND (current_app_role() = 'botanist'::text)) | — |
| sync_events | users log own sync events | authenticated | INSERT | PERMISSIVE | — | ((user_id = ( SELECT auth.uid() AS uid)) AND (current_app_role() = 'botanist'::text)) |
| sync_events | users read own sync events | authenticated | SELECT | PERMISSIVE | ((user_id = ( SELECT auth.uid() AS uid)) OR (current_app_role() = 'officer'::text)) | — |
| tag_reservations | tag_reservations_read_own | authenticated | SELECT | PERMISSIVE | ((reserved_by = auth.uid()) AND (current_app_role() = 'botanist'::text)) | — |
| taxonomy | Allow public read access to taxonomy | anon, authenticated, service_role | SELECT | PERMISSIVE | true | — |
| taxonomy | officers manage taxonomy | authenticated | ALL | PERMISSIVE | (current_app_role() = 'officer'::text) | (current_app_role() = 'officer'::text) |
| taxonomy | public read taxonomy | anon, authenticated | SELECT | PERMISSIVE | true | — |
| website_species | officers manage plants | authenticated | ALL | PERMISSIVE | (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'officer'::text) AND (profiles.account_status = 'active'::text)))) | (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'officer'::text) AND (profiles.account_status = 'active'::text)))) |
| website_species | staff view plants | authenticated | SELECT | PERMISSIVE | (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.account_status = 'active'::text)))) | — |
| website_users | only the officer can use website users | authenticated | ALL | PERMISSIVE | (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'officer'::text) AND (p.account_status = 'active'::text)))) | (EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.role = 'officer'::text) AND (p.account_status = 'active'::text)))) |

## View 边界

| View | security_invoker | anon 表级 SELECT | authenticated 表级 SELECT |
| --- | --- | --- | --- |
| plant_map_points | true | false | true |
| public_species | 未设置 | false | false |

View 不适用表级 ENABLE RLS。public_species 仅投影 approved species，当前无 anon／authenticated 表级 SELECT；不将其描述为已启用 security_invoker。Owner／BYPASSRLS 访问不等于普通用户验收。

## 验证状态

| 项目 | 状态 |
| --- | --- |
| 线上只读导出 | 完成；配置为查询时快照 |
| 幂等预演 | PASS；同一 migration body 连续执行两次，policy／表与列 grants／owner／FORCE RLS 摘要不变；全部回滚 |
| 去重复复测 | PASS；当前脚本动态生成命令，25 个表名与 migration 逐项一致；执行两次并回滚，权限摘要不变 |
| 独立复查 | 仍为 25/25 RLS ON、78 policies；正式 migration 未应用 |
| 正式应用 | 未执行；交团队 review |
| 真实账号行为 | 不包含在本次配置导出中 |

Migration：`supabase/migrations/20261115180038_capture_public_table_rls_enablement.sql`。
