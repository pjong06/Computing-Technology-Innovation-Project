# Task 2 — 植物识别接口保护

| 项目 | 实现 |
| --- | --- |
| 接口 | POST /api/identify |
| 权限 | 服务器验证 JWT 与 active profile；仅 Botanist、Officer |
| 顺序 | IP 限流 → auth／role → user 限流 → 并发限制 → 上传 → AI |
| 默认限额 | 每 IP 20 次／60 秒；每用户 10 次／60 秒；拒绝请求也消耗 IP 配额 |
| 用户计数 | 使用服务器验证后的 user.id，不信任请求提供的角色／用户 ID |
| 超限 | 429、Retry-After；计数容量满时 503；窗口结束后恢复 |
| Mobile | 使用现有 session 的 Bearer token；无 session 时不上传 |
| 保留功能 | 现有 2 并发、10 MiB、JPG／PNG 上传保护 |
| 已验证 | 本地模拟 Auth／AI 的权限、限流、上传与 mobile 请求测试 |
| 限制 | 计数保存在单进程；重启清零，共用公网 IP 的用户共用 IP 配额 |
| 上线验收 | Backend 与 mobile 更新后，以真实 Botanist／Officer session 验证识别；检查匿名拒绝与 429；本地测试不代表线上已完成 |

限额是当前代码默认值，可在 createIdentifyRouter 配置中调整；不是 Render 环境变量。
无数据库 migration、无新依赖。本任务不包含 Task 3 的上传规则调整。
