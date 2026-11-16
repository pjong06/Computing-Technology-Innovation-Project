# 4. 用户删除与停用

| Label | 内容 |
| --- | --- |
| where | Supabase website_users 的两个 AFTER DELETE trigger |
| what happen | 原有停用与硬删除 trigger 并存；现已移除硬删除行为 |
| why | 旧逻辑尝试删除 profiles／Auth，失败只发 warning |
| 后果 | 原本可能永久删除账号或因外键失败；现在保留账号与历史关联 |
| how to fix | 已应用 migration：单一按 ID 停用；拒绝 Officer／自身及无匹配 profile 的删除；不修改 RLS／整表授权 |

| 检查 | 状态 |
| --- | --- |
| 线上只读核查 | 完成；两个表 RLS 已启用；14 个 website ID 均匹配 profile，无 email-only 匹配 |
| Migration | 用户授权后直接应用；线上版本 20261115171620 |
| SQL 验证 | 应用前预演、应用后复测均通过；Officer 删除、保留停用 profile／Auth、其他账号不变、Officer／自身拒绝、无匹配 ID 原子拒绝 |
| 清理 | 两次测试均 ROLLBACK；独立检查临时 Auth／profile／website 记录为 0 |
| Secrets | 扫描通过 |
| 真实 session 验收 | COMPLETE，11 PASS；同一未过期 JWT：删除前 200、删除后因 profile 停用返回 403；Auth 仍验证该 JWT |
| 真实 fixture 清理 | 脚本核对通过；另经 Supabase 独立只读检查 Auth／website／profile 均为 0 |
| 范围 | 验证 Render /api/me 与正式用户删除 API；不扩大为所有接口／网页 UI 验收 |
| 剩余 | 提交代码后检查 CI／Sonar，再由团队 review；数据库修复与该项线上验收已完成 |

文件：`supabase/migrations/20261115171620_suspend_profile_on_website_user_delete.sql`；`supabase/tests/website_user_delete_check.sql`；`docs/security/task4-user-delete-results.json`。
本轮修改了线上 DELETE function／trigger，未操作现有账号、Approved 数据、frontend 或 backend 功能接口；本次提交补齐已应用 migration、验收脚本及证据。
停用保留 Auth 账号，不等于禁止 Supabase Auth 签发 token；受保护 API 须继续检查 profile.account_status。

真实 session 原始证据：`backend/user-delete-1794764603072-results.json`。历史 SQL 结果保持不变；其旧“待真实 JWT 验收”状态由本次结果补充。
