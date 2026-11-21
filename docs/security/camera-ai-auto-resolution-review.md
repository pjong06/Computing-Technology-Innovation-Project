# 1. AI 自动关闭（已批准应用）

| Label | 内容 |
|---|---|
| where | `supabase/migrations/20261119103249_camera_ai_no_person_resolution.sql` |
| what happen | 新增 AI 关闭来源、分析记录关联、开关及受限内部触发器 |
| why | 无人照片不再占用人工审核；保留可追踪原因 |
| 后果 | 仅新照片、指定测试 station、未分派移动告警可自动 Resolve；不修改现有五条历史告警 |
| how to fix | SQL 已应用并完成回滚验收，已启用指定测试 station；原 worker 的 `camera_ai_finish` 即可触发，无新增模型调用 |

# 2. 自动关闭条件

| 情况 | 结果 |
|---|---|
| 全部照片分析完成、明确无人、uncertain=false | AI Resolve，记录原因 |
| 检测到人／人和动物同时出现 | 人工 |
| 不清楚、黑图被判 unclear、分析失败或未完成 | 人工 |
| 温湿度等非移动告警、已分派任务 | 人工，不自动关闭 |
| AI 关闭后收到新照片 | 重新打开，等待新照片分析 |

判定依赖模型输出；不能把 `uncertain=false` 当作准确率保证。原图、AI 结果与关闭原因保留，可在 Resolved → Closed by AI 查阅。没有把 bucket 公开，签名仍为 60 秒。

# 3. 验证与剩余工作

| Label | 内容 |
|---|---|
| where | `backend/scripts/verify-camera-ai-resolution.cjs`、新增测试、Dashboard |
| what happen | 独立 PostgreSQL 29 项检查通过；未调用 Gemini、未改线上数据 |
| why | 验证无人／动物、人物、不确定、失败、多图、分派、历史、范围、重开与伪造拒绝 |
| 后果 | 规则已在数据库启用；真实新照片的 Gemini 实测仍待验证 |
| how to fix | 后续确认真实 worker 正在运行；新 Dashboard 代码仍待 push/PR 与 Render 部署 |

线上回滚验收：无人结果自动关闭并记录原因、追加照片重开、人物保持 Open，全部通过。未上传照片、未调用 Gemini；alerts=5、evidence=3、reviews=0、readings=1519、Storage objects=654 不变。

# 4. Worker 运行待确认

| Label | 内容 |
|---|---|
| where | Render backend Environment / Logs |
| what happen | 最近一小时有正常 API 日志，但未观察到 `camera_ai_claim/finish` 请求 |
| why | 尚不能确认 worker 已启用或配置齐全；不能仅由零调用断言具体原因 |
| 后果 | 数据库规则已启用，但无人领取照片时不会自动分析／关闭 |
| how to fix | 确认 `CAMERA_AI_ENABLED=true`、私有 `GEMINI_API_KEY`、`CAMERA_AI_DATABASE_SERVER_KEY`（或已有 `CAMERA_DATABASE_SERVER_KEY`），运行含 worker 的 backend；不在聊天发送值。随后用测试 station 的新照片验收 |

新 Dashboard 在 Resolved 下增加 Closed by：AI／Staff，并显示 AI 关闭原因；代码尚未 push 或部署 Render。
