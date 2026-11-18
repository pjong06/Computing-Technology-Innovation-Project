# 1. Camera AI Prototype：线上变更 Review

| where | what happen | why | 后果 | how to fix |
|---|---|---|---|---|
| backend/camera-ai/ | 已新增队列、worker、结果接口、人工复核和演示页；获用户批准后已应用 SQL | 单张测试后接入自动链路 | 已在本机 worker＋线上 Supabase＋Gemini 验证；Render 尚未接入 | Backend owner 按第 2 节接入并部署 |
| 新 public.camera_ai_reviews | 保存 pending／processing／completed／failed、模型、尝试次数及分类 | 重启后恢复任务并关联 evidence | 仅三个 active staff 可读，客户端不能直接写 AI 结果 | 通过 server-only claim／finish RPC 处理 |
| 新 public.camera_ai_human_reviews | 记录人工确认／错误／无法确认 | 不能覆盖 AI 原始结果 | 不会改变原 alert 的 acknowledge／resolve | 通过用户 JWT 的 human review RPC 写入 |
| 新 camera_ai_private.settings | 应用时默认关闭，核对权限后已按批准启用指定 station；UTC 每天最多 10 次领取 | 避免历史照片和超量调用 | 达到上限后任务等待次日，不自动加购额度 | 可随时关闭；调用尝试按领取计数，失败及崩溃也占额度 |
| alert_camera_evidence 新 AFTER INSERT trigger | 只给启用后的指定 station 新照片排队 | 上传和 metadata 保存成功后才能分析 | 不回填旧照片；不修改原表字段、RLS、alert 规则 | 新 trigger＋新表，不替换原 trigger |
| Render backend | 需要接入两行安装代码、添加环境变量 | 免费服务休眠时 worker 同时暂停 | 恢复后继续；不承诺实时，也不承诺 API 恰好调用一次 | 队列领取锁、3 分钟 lease、最多 3 次尝试和结果 fencing |
| Dashboard | 已新增独立 /camera-ai-demo 页面 | 避免修改其他成员页面 | 不是现有 IoT Dashboard 已完成整合 | Dashboard owner 按下方接口接入 |

## 2. 给 Backend owner 的接入代码

在 server.js 已加载环境变量、创建 app、已有 requireAuth 后，最终错误／404 middleware 前注册一次：

```javascript
const { installCameraAI } = require('../camera-ai/install.cjs');
const cameraAI = installCameraAI(app, requireAuth);
```

正常关机流程中调用 `await cameraAI.stop()`。原摄像头及 MQTT 流程不替换；Render 不操作 laptop 摄像头。不用新增 package 或独立 GPU 服务。

## 3. 私有环境配置

```dotenv
CAMERA_AI_ENABLED=true
```

还需 GEMINI_API_KEY、SUPABASE_URL、现有公开 Supabase key，以及 CAMERA_AI_DATABASE_SERVER_KEY（可先复用本地 CAMERA_DATABASE_SERVER_KEY）。这里只列变量名，不发送真实值。Server key 仍属可信的宽权限凭证，本方案不宣称它是专属最小权限身份。

数据库审核后可启用：

```sql
UPDATE camera_ai_private.settings SET enabled=true WHERE singleton;
```

暂停时把 CAMERA_AI_ENABLED 和数据库 enabled 都关闭；已经发出的请求可能完成。免费额度以 Google 项目实际计费设置为准，代码不能替用户关闭 billing。

## 4. 独立本地运行

原 backend 不用停止；此入口使用 localhost:3003，只用于本机 prototype。

```powershell
# 只展示页面／读取结果；未设置 CAMERA_AI_ENABLED=true 时不调用 AI
node camera-ai/prototype-server.cjs
```

打开 http://127.0.0.1:3003/camera-ai-demo ，使用 active Officer／Botanist／Researcher 登录。密码隐藏，JWT 仅放浏览器内存；只手动刷新。无队列时不会凭空生成旧照片任务。

本地自动处理需要同时满足：SQL 已应用、数据库 enabled=true、本地 CAMERA_AI_ENABLED=true，以及有效的私有配置。当前 SQL 和指定 station 已启用；本轮运行的 shell 已设 CAMERA_AI_ENABLED，不修改用户 .env。重新打开终端时可先执行 `$env:CAMERA_AI_ENABLED='true'`。

## 5. Dashboard API

| 方法／路径 | 用途 |
|---|---|
| GET /api/iot/camera-ai/reviews | 每页 25 条，响应 next_cursor；?cursor=... 查看更早任务 |
| GET /api/iot/camera-ai/alerts/:alertId/evidence/:evidenceId | 查询指定 alert／照片的分析结果，关联不符返回 404 |
| GET /api/iot/camera-ai/reviews/:reviewId/photo | 用用户 RLS 读取照片 bytes，不公开 bucket 或永久 URL |
| PATCH /api/iot/camera-ai/reviews/:reviewId/human | JSON decision=confirmed／incorrect／uncertain；记录登录用户，不接受客户端 reviewer_id |

所有接口需要 Bearer JWT 和 active staff 权限。未排队时结果为 null，不代表分析完成；no_target_detected 不代表现场安全。

## 6. 验收及剩余问题

本机 SQL 用隔离 PostgreSQL 18 和简化现有表验证，不是线上真实 JWT 验收；所有 SQL 测试回滚。Node 测试使用假 Gemini，不发送照片。此前的单张真实 Gemini 结果由用户在本地运行提供。

- 已覆盖：新照片范围、无历史回填、唯一约束、领取／过期 lease、旧结果拒绝、角色 RLS、人工复核、每日上限、429 等待和有限重试。
- 已获批准应用 migration 20261118120218_camera_ai_persistent_review_queue；原 alert function hash 和 evidence RLS 保持一致；106 条历史照片未回填。
- 真实自动验收：新建一张程序生成的纯黑照片，上传私有 bucket、写入 evidence 后自动入队，worker 以一次尝试保存 completed／unclear／uncertain=true；未发送个人照片。
- Node 模拟及 HTTP 测试 16/16 通过；演示页真实浏览器返回 200、密码隐藏、localStorage 为空。
- PR review 后补强：AI 响应和照片流式大小／超时限制、演示页分页；追加 migration 20261118123358，修复额度耗尽时终止 lease 未结算的问题，不改原已应用 migration。
- 真实账号页面验收：用户确认照片可见及人工复核成功；独立 SQL 确认 active Officer 的复核记录，原 alert 仍为 open。Botanist／Researcher 本轮只有本地 HTTP／SQL-role 验证，不能声称已完成真实 session 验收。
- Fixture 已清理并独立确认：测试 alert、evidence、AI 结果、人工复核记录及 Storage 对象均为 0；原有 106 条 evidence 保留。页面刷新后测试任务消失属于正常清理。
- Supabase advisor 对 camera_ai_review_human 给出 authenticated SECURITY DEFINER 提示；这是有意的受限写入口，函数固定 search_path、检查 auth.uid＋active staff，匿名不能执行、不能指定其他 reviewer_id；需由 owner review，不代表全项目 advisor 全通过。
- 待完成：main 接入、PR／CI／Sonar、Render 部署及部署后复测；现有 IoT Dashboard 整合由对应 owner 完成。
- 进程若在 Gemini 成功后、保存结果前崩溃，恢复时可能再次调用；唯一记录和 lease 防止重复保存，不宣称恰好一次调用。
- Laptop 漏拍和 movement／PIR 条件不同的问题仍需单独解决；AI 不补拍过去现场。
- 现有 Sonar 组织 LOC 上限问题不能由本功能规避；不能把本地 secrets scan 当成云端 Quality Gate。

本次只新增 camera-ai 文件和与线上版本一致的 migration 文件；经用户批准新增数据库对象并启用指定 station，没有修改其他成员代码、原 alert 规则／RLS 或 Render 配置，未 push。
