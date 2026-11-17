# 4. 真实 session 删除验收

```powershell
$env:TASK4_OFFICER_EMAIL = 'officer@example.com' # 替换为实际 Officer 邮箱
npm run test:user-delete:live
```

| Label | 内容 |
| --- | --- |
| where | 当前 backend；Render /api/me、/api/web-data/users；Niah Supabase |
| what happen | 隐藏输入一次 Officer 密码；自动创建临时 Botanist，验证同一 JWT 删除前 200、删除后因停用返回 403 |
| why | SQL 模拟无法证明真实 Auth session 与部署 API 的行为 |
| 后果 | 只有真实 session、账号保留与清理检查均通过，结果才为 COMPLETE；失败不伪装 PASS |
| how to fix | 根据结果文件中失败步骤排查；本脚本不改权限，不删除业务／audit 记录 |

使用 backend/.env；不存在的项沿用 Steven-Sprint2-Security/backend/.env。需要 URL、public key，以及服务端 Auth 管理 key（SUPABASE_SECRET_KEY、SUPABASE_SERVICE_ROLE_KEY 或 IOT_DATABASE_SERVER_KEY）。不新增授权；缺配置时先停止。不要把 key 或密码发聊天。

必须在本地环境变量或忽略提交的 .env 设置 TASK4_OFFICER_EMAIL；代码没有默认个人邮箱。未设置或为空时，在网络请求和密码输入前停止。示例 example.com 不是真实账号。仅该临时账号被启用／删除；不会重写整张用户表。临时密码随机生成，JWT 不刷新、不保存。

结果：backend/user-delete-*-results.json；只含步骤、HTTP、布尔结果及 run ID，不含账号 ID、email、密码、JWT。清理会先移除 fixture website 行，再删除 fixture Auth，独立核对 profile／Auth／website 均不存在。

若窗口被强制关闭或清理失败，使用结果中的 run ID：
```powershell
npm run test:user-delete:live -- --cleanup-run=<run ID>
```
只清理 metadata 与 email 均匹配该 run 的临时账号；找不到／无法确认归属时不触碰其他账号。保留结果文件中的失败项，不要把离线测试当作真实验收。
