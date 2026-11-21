# 2. 独立响应头模块验证

| Label | 内容 |
| --- | --- |
| where | 新建 portalSecurityHeaders.js；临时 localhost server／独立 ZAP session |
| what happen | 仅新增文件；现有 server.js、frontend HTML／JS／CSS 均未修改；未注册到实际 App |
| why | 按用户要求，跨 owner 的接入及页面迁移交给负责人处理 |
| 后果 | 本地验证可评估模块，不能证明 Render 已修复或现有页面已兼容严格 CSP |
| how to fix | 按 security-headers-owner-handover.md 接入并回归，再部署及线上复扫 |

| 验证项 | 结果 |
| --- | --- |
| 新模块测试 | 6 PASS：正常／错误响应、报告／严格模式、来源参数、模拟 HTTPS、JSON MIME |
| 本地 ZAP | 10 次 GET；被动队列 0；主动扫描 0；不执行网页 JS |
| 防点击劫持告警 | baseline 2 → candidate 0；X-Frame-Options DENY 生效 |
| nosniff 告警 | baseline 5 → candidate 0 |
| HSTS | 单元测试与模拟 HTTPS 转发头返回 max-age=31536000；真实 Render HTTPS 尚未复测 |
| CSP | 尚未关闭；默认 report-only，CSP Header Not Set 仍为 2；不得标成修复 |
| 字体 SRI | 仍为 2；交 Phoebe 处理，不在本模块内修改 |
| 其他提示 | Suspicious Comments／Modern Web Application 保留；report-only 为 Info |
| 初版过渡策略 | 曾产生 CSP 缺少指令／隐式 inline 告警；原报告保留，最终版本不再采用该半套执行策略 |

最终原始证据：zap-local-headers-20261117-final/comparison.json、baseline-alerts.json、candidate-alerts.json、zap-local-report.zip（内含原始 HTML）。
初版证据：zap-local-headers-20261117/。两者均非线上修复后报告。

未操作账号、密码、RLS、数据库或 Render；本 PR 仅提交新建模块和证据，未接入 App。
