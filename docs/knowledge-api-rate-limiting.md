# Knowledge API rate limiting：实现与本地验收

## 范围与当前状态

在本地分支 `feat/knowledge-api-rate-limiting` 实现，基于本次 fetch 的 `origin/main`（首次 bb03026；已于 2026-11-21 快进到最新 `bac7949`）。尚未 commit、push、创建 PR 或部署，也没有更改 Supabase schema、数据或 RLS。

现有 benchmark 结果文件和本地工具目录保留，不属于本次提交范围。

## 1. 为什么这样实现

对 `/api/knowledge` 的读取、照片链接和写入分别限制请求次数，避免更换 URL、查询条件或图片 ID 就取得新额度。额度在每个类别内共用，而不是每个 endpoint 各给一份。

使用固定版本 `express-rate-limit@8.7.5`，保留该库的 IP 及 IPv6 子网键处理。没有从未验证的 Bearer 字符串提取用户身份。

| 类别 | 默认额度 | 范围 |
|---|---:|---|
| read | 300 / 60 秒 / IP | Knowledge 的 GET、HEAD，照片链接除外 |
| photo | 600 / 60 秒 / IP | GET、HEAD `/species/:id/photos/:photoId` |
| write | 60 / 60 秒 / IP | Knowledge 的 POST、PUT、PATCH、DELETE，包括提案／上传 |

这是保守的初始配置，不是已经通过真实多用户负载验证的最佳额度。同一 NAT、校园 Wi-Fi 的用户共享 IP 额度；IPv6 默认按 /56 聚合。上线前需观察正常访问和 App 离线目录初始化。

OPTIONS 不计数；其他不支持的方法继续由原路由处理。失败和未认证请求也计数，防止借助无效请求绕过保护。原来的输入验证、身份与角色检查仍然执行；配额耗尽时会先返回 429。

## 2. 改动文件及关键代码

### backend/src/middleware/knowledgeRateLimit.js

创建三个独立的内存 limiter，验证配置必须为正整数，无法识别的配置会使启动失败，不静默关闭保护。

```js
rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  // The actual module supplies a JSON handler for 429 responses.
});
```

只选择一个类别计数，不重复扣普通读取和照片额度。限制在认证、业务查询和 multipart 处理前执行；全局 JSON body parser 仍先运行，因此本改动不是完整的请求体内存防护。

### backend/src/routes/knowledge.js

在 router 创建后立即注册：

```js
const { createKnowledgeRateLimit } = require('../middleware/knowledgeRateLimit');
// Inside createKnowledgeRouter:
router.use(createKnowledgeRateLimit(rateLimitOptions));
```

工厂可注入测试配置，每个新 router 使用独立 limiter。生产环境仍由现有 server 挂载 `/api/knowledge`，不额外改服务器架构。

### backend/package.json / package-lock.json

固定依赖版本，更新 lockfile。`test:knowledge` 同时运行原 Knowledge 测试及两个新测试文件。

### backend/.env.example

```dotenv
KNOWLEDGE_RATE_WINDOW_MS=60000
KNOWLEDGE_READ_RATE_LIMIT=300
KNOWLEDGE_PHOTO_RATE_LIMIT=600
KNOWLEDGE_WRITE_RATE_LIMIT=60
```

不配置时使用上述默认值。修改环境变量后要重启。没有修改真实 `.env`。

### 新测试

- `backend/test/knowledgeRateLimit.test.js`：14 项，覆盖分类额度、不同 URL 共用额度、Retry-After、恢复、独立 IP、IPv6、代理链、Bearer 不能绕过、认证和数据库访问边界。
- `backend/test/knowledgeServerRateLimit.test.js`：1 项，加载实际 Express app，验证入口确有保护、安全 headers 保留、health 不受 Knowledge 限流影响。

## 3. 客户端看到什么

正常请求按原接口返回，同时带有：

```text
RateLimit-Limit: 300
RateLimit-Remaining: 299
RateLimit-Reset: <remaining seconds>
RateLimit-Policy: 300;w=60
```

超限后示例：

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 10
Cache-Control: no-store
```

```json
{
  "message": "Too many Knowledge API requests. Please retry later.",
  "code": "KNOWLEDGE_RATE_LIMITED",
  "policy": "read",
  "retry_after_seconds": 10
}
```

实际秒数取决于窗口剩余时间。计数窗口不是整个服务同时在每分钟整点归零。客户端应等待 Retry-After，而不是立即循环重试。本次未修改网站和 App 的 429 交互。

## 4. 自动化测试

在 backend 目录：

```powershell
npm ci --ignore-scripts
npm run test:knowledge
npm test
npm audit
```

只跑新增测试：

```powershell
node --test test/knowledgeRateLimit.test.js test/knowledgeServerRateLimit.test.js
```

新增测试使用本地 HTTP 端口、伪造数据库适配器或无效 ID，不修改共享 Supabase。不会启动 MQTT 或 AI worker。

验收结果见最终检查记录；首次检查发现的两项导航失败已由最新 main 修复，合并后完整套件 649 项全部通过。

## 5. Postman 手动验证：不用访问数据库

保留原来的 3000 端口服务。在新 PowerShell 终端，进入 backend 目录，用进程环境变量运行一个 3011 本地审核服务：

```powershell
$env:KNOWLEDGE_READ_RATE_LIMIT = '2'
$env:KNOWLEDGE_PHOTO_RATE_LIMIT = '2'
$env:KNOWLEDGE_WRITE_RATE_LIMIT = '2'
$env:KNOWLEDGE_RATE_WINDOW_MS = '10000'
node -e "require('./src/server').listen(3011, '127.0.0.1', () => console.log('Review server: http://127.0.0.1:3011'))"
```

这会加载真实 app，但不会调用 `npm start` 启动段中的 MQTT／AI worker。使用现有本地配置；不要把令牌放进截图。

在 Postman 创建 GET：

```text
http://127.0.0.1:3011/api/knowledge/species/invalid-id
```

在 10 秒内连续 Send 三次：

1. 第一次 **400**，因为 ID 故意无效；Remaining 应为 1。
2. 第二次 **400**，Remaining 应为 0。
3. 第三次 **429**，有 Retry-After 和 `policy: read`。
4. 按 Retry-After 等待后再 Send，应恢复 **400**。

这里 400 是预期验证错误，目的是完全避免数据库访问。它证明失败请求也会消耗配额，而不是测试成功读取数据。

### 验证其他接口不受影响

read 已超限时访问：

```text
GET http://127.0.0.1:3011/api/health
```

应为 **200**。

### 验证类别独立且照片路径被覆盖

read 已超限时，访问以下故意无效 ID 的路径：

```text
GET http://127.0.0.1:3011/api/knowledge/species/invalid-id/photos/invalid-id
```

前两次应 **400**，第三次 **429**，`policy: photo`。它使用独立照片预算。

### 验证写入不会绕过认证

Postman 不设置 Authorization，Body 选 none：

```text
POST http://127.0.0.1:3011/api/knowledge/species
```

前两次应 **401**，第三次 **429**，`policy: write`。不创建资料，不上传文件，不修改用户。

### 可选：真实读取验证

若本地 Supabase 连接正常，重新等待窗口结束后，在同一个低额度服务上执行：

```text
GET http://127.0.0.1:3011/api/knowledge/taxonomy?page=1&page_size=2
```

前两次应 200 且含分页资料，第三次 429。这会产生少量真实只读查询，因此不是默认离线测试。

### 恢复默认

Ctrl+C 停止审核服务。在该终端执行：

```powershell
Remove-Item Env:KNOWLEDGE_READ_RATE_LIMIT -ErrorAction SilentlyContinue
Remove-Item Env:KNOWLEDGE_PHOTO_RATE_LIMIT -ErrorAction SilentlyContinue
Remove-Item Env:KNOWLEDGE_WRITE_RATE_LIMIT -ErrorAction SilentlyContinue
Remove-Item Env:KNOWLEDGE_RATE_WINDOW_MS -ErrorAction SilentlyContinue
```

关闭该终端也会清除这次临时进程配置。不要把测试用的 2 次／10 秒上传到 Render。

## 6. 部署与限制

- 本次默认是单 Node 进程的 MemoryStore，重启会重置计数；多实例不共享额度，扩容前应换共享 store。
- 未添加 Redis、数据库表或 migration。
- 复用 main 的 `trust proxy = 3`。测试证明该配置下伪造左侧 X-Forwarded-For 不会改变选定的客户端 IP，但线上真实代理拓扑仍需部署负责人核对；不要直接改成 trust proxy true。
- 同 IP 多用户共用额度，这是本次明确的实现选择，不是已验证用户级限流。
- 内存限流不是 DDoS 防护，也不替代入口层的流量保护。
- `/api/iot`、Camera 图片链接及其他非 Knowledge 路由不在范围内。
- 浏览器直接请求 Supabase 图片，不经过此 limiter；不能靠这个修复 IoT 图片循环或保证 egress 不超额。
- 正常流量应在本地／预发布检查，确定默认值适合团队再部署。收到 429 的网站/App 目前可能只显示普通错误，后续可优化倒计时提示。

## 7. 提交前检查

- [ ] 检查新增的 15 项限流测试和全部 Knowledge 测试。
- [ ] 确认 npm audit 结果。
- [x] 更新到最新 main，完整测试 649 项通过，原导航测试问题已随 main 更新修复。
- [ ] 手动确认 429、Retry-After、窗口恢复、原身份验证和健康接口。
- [ ] 只暂存本次文件，不包含已有 benchmark、.postman、postman、.vscode、manual-sql 或 .env。
- [ ] 用户审阅后再决定 commit、push 和 PR；本次未执行这些操作。

官方参考：https://express-rate-limit.mintlify.app/reference/configuration

## 8. 本次验证结果（2026-11-21）

| 检查 | 结果 |
|---|---|
| 新增限流／实际 server 测试 | 15 项通过 |
| npm run test:knowledge | 76 项全部通过 |
| npm test：最新 main + 本次实现 | 649 项全部通过，0 失败 |
| npm audit | 0 个漏洞 |
| 新增 JavaScript 语法检查 | 通过 |
| git diff --check | 无空白错误；已有 benchmark 文件有换行提示 |

首次检查时，完整套件的两项导航测试在原 main 上已失败。随后重新 fetch 发现 main 新增 9 个提交，已无冲突快进至 bac7949；其中包含团队的导航测试修复。本次没有自行修改无关导航或测试预期。更新后完整 backend 测试 649 项全部通过，且 git ls-files -u 没有未解决冲突。

main-navigation-baseline 是仅供检查的部分源码快照，并非完整项目；该快照不能用于执行所有测试。有效的对照证据是 main-navigation-targeted.log 中仅执行这两项的结果。

目前仅完成本地自动化及静态配置验证；用户 Postman 验收和线上真实代理拓扑仍待检查。尚未 commit／push／创建 PR，也没有修改真实 .env 或共享 Supabase。
