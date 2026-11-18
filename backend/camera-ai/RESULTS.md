# 1. Camera AI Prototype 验收

| where | what happen | why | 后果 | how to fix |
|---|---|---|---|---|
| 本机 worker＋线上 Supabase／Gemini | 新黑图自动入队并完成分析，1 次尝试，结果 unclear／uncertain=true | 私有照片上传后 trigger 排队，worker 领取处理 | 自动分析链路通过；不是实际 PIR 拍照验收 | 保留结果于 prototype-acceptance.json |
| /camera-ai-demo | 用户用 active Officer 看到照片、结果并提交人工复核；原 alert 仍 open | JWT／RLS 读取，复核使用独立表 | 本轮真实 Officer 页面验收通过 | Botanist／Researcher 真实 session 后续补验 |
| 本机测试 | Node／HTTP 16 PASS；隔离 PostgreSQL 实际执行及角色权限测试通过并回滚 | 检查去重、lease、恢复、额度、重试及权限边界 | 不把模拟测试当作所有线上角色通过 | 部署后按相同范围复测 |
| PR review 修正 | 补流式限制、分页及额度耗尽时的 lease 结算；AI 22 PASS，全 backend 最终 553 PASS | 修复 review 找到的四个边界 | 新测试已接入 npm test；追加 migration 20261118123358 已应用 | 部署使用最新两个 migration 和新增模块 |
| 中间回归记录 | 一次 identify 测试文件终止，原因未确认；单独 29 PASS、随后全量 553 PASS | 不能把一次失败抹去或归咎其他成员 | 最终通过不等于已解释中间失败 | CI 若重现，按具体日志定位；本轮未改 identify |
| 数据库／Storage | 本轮 fixture 各项残留 0，旧 evidence 106 条保留 | 精确 ID 清理并独立查询确认 | 不留下演示数据 | 不清理其他 station 或旧照片 |

# 2. 剩余整合

| where | what happen | why | 后果 | how to fix |
|---|---|---|---|---|
| 最新 main／Render；Gerald／Backend owner | 新模块尚未接入部署 | 本轮遵守不修改其他成员现有代码 | 目前只有本机 worker 自动处理 | 按 PROTOTYPE-REVIEW.md 接入 installCameraAI；配置私有变量，PR 后部署 |
| IoT Dashboard；页面 owner | 只有独立 prototype 页面 | 未修改现有 Dashboard | 原 Dashboard 不会自动出现 AI 结果 | 调用新增查询／照片／人工复核接口 |
| 持久化任务 | 保存成功前若进程崩溃，可能再调用 Gemini | 外部 API 与数据库不是同一事务 | 有重复调用可能；结果保存有唯一约束和 lease 保护 | 保持低额度、核对 attempts；不承诺恰好一次 |
| 免费 Render | 休眠时不处理任务 | 免费实例运行限制 | pending 等待唤醒；不保证实时 | 恢复后领取；需实时则采用持续运行服务 |

# 3. 本机启动

在此 backend 目录运行：

```powershell
$env:CAMERA_AI_ENABLED='true'
node camera-ai/prototype-server.cjs
```

打开 http://127.0.0.1:3003/camera-ai-demo 。当前数据库只允许 steven-sprint2-test-01 的新照片，UTC 每天最多 10 次领取；本轮已用 1 次，不重置预算。退出页面用“退出”，停止本机服务用 Ctrl+C。

仅新增 camera-ai 模块和 migration 20261118120218；线上新增对象经用户批准。未 push，未修改 Render 配置、原 alert 规则或照片 RLS。
