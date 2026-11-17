# 1. 安全响应头接入分工

| Label | 内容 |
| --- | --- |
| where | 新建 backend/src/middleware/portalSecurityHeaders.js；现有 server／frontend 均未修改 |
| what happen | 提供防嵌入、nosniff、HTTPS HSTS 及分阶段 CSP；独立模块尚未接入线上 |
| why | 现有页面有内联事件／样式，直接执行严格 CSP 会使功能失效 |
| 后果 | 新文件本身不会改变网站；本地测试／扫描不能作为 Render 已修复证据 |
| how to fix | 下表由对应 owner 接入、迁移并部署；Steven 再进行线上同范围复扫 |

| 负责人 | 改哪里 | 具体改什么 |
| --- | --- | --- |
| Phoebe／server.js owner | backend/src/server.js，app.disable 后、body parser／routes 前 | 引入并注册下方新 middleware；保留现有 trust proxy 配置 |
| Phoebe／portal owner | editor、forgot-password、login、map、reports、reset-password、species、users 的 HTML | 将 19 处 onclick／onchange／oninput 改为外部 JS addEventListener，保留原有调用、参数及错误处理 |
| Phoebe／portal owner | rejected.html；frontend/js/alerts.js | 将 1 处 HTML style 属性和 2 处模板 style 属性移到 CSS class |
| Phoebe／portal owner | plant、plants、proposals、species 的 HTML | 将 style block 移到自有 CSS，或传入准确 inlineStyleHashes；不能放开 unsafe-inline |
| Phoebe／portal owner | frontend/js/editor.js 的 uploadPhoto | fetch(newPhoto) 会读取 data URL；改为直接从本地图片数据push构建 Blob，避免为此扩大 connect-src |
| Phoebe／portal owner | Google Fonts CSS 引用 | 第 3 项 SRI 仍独立处理：自托管或稳定资源＋匹配 hash；新 middleware 不会解决它 |
| Gerald（部署） | Render 部署与代理链 | 确认 req.secure 能识别真实 HTTPS；部署后核对 HSTS，不改成信任任意原始转发头 |
| Steven（安全） | 新 middleware／独立测试与报告 | 维护策略、协助 owner；迁移后开启 enforce，再复扫和核对浏览器功能 |

## 首次接入（仅报告严格 CSP，不阻断旧内联脚本）

```javascript
const { createPortalSecurityHeaders } = require('./middleware/portalSecurityHeaders');
app.use(createPortalSecurityHeaders({ portalCspMode: 'report-only' }));
```

报告模式只执行 X-Frame-Options DENY、nosniff、HTTPS HSTS；Portal 的完整 CSP 仅报告，不输出半套执行策略。不是 CSP 修复，也未接收服务端 violation report（可在浏览器 Console 检查）。

HSTS 仅 req.secure 为 true 时返回 max-age=31536000；不含 includeSubDomains／preload。请确认门户不需要被其他页面嵌入；API MIME／错误响应需回归。

## 迁移后开启

```javascript
app.use(createPortalSecurityHeaders({ portalCspMode: 'enforce' }));
```

只保留一处注册，不要同时注册两种模式。若用 style hash，inlineStyleHashes 接收 sha256-… 字符串，不包含外围引号；hash 必须对应实际样式内容。

策略允许当前 Supabase HTTPS／WSS、固定版本 Supabase／Leaflet JS、Google Fonts、Esri 瓦片、同源／Supabase 图片和本地 blob／data 图片；没有 wildcard、unsafe-inline 或 unsafe-eval。依赖地址变化须同步审查来源。

## 验收

新测试：backend/test/portalSecurityHeaders.test.js。本地 ZAP 对照脚本：backend/scripts/scan-security-headers-local.cjs（需要独立 localhost:8097 ZAP）。
最终本地报告位于 docs/security/zap-local-headers-20261117-final；使用模拟 HTTPS 转发头，不证明真实 TLS／Render HSTS。第一版过渡策略的未通过报告保留在 zap-local-headers-20261117，不作为最终修复结果。

owner 接入后验证登录、重置密码按钮、地图过滤、图片预览／上传、报表导出、角色页面，再部署复扫。保留初扫和本地未关闭告警，不能把 report-only 当作严格 CSP 已通过。
