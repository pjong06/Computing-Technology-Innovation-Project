# Task 3 — 上传保护

| 接口 | 原有限制 | 本次补齐 |
| --- | --- | --- |
| POST /api/identify | Multer 内存上传；10 MiB；image 字段 1 张；无额外字段；JPEG／PNG MIME 与文件头检查 | WebP 文件头及解码校验；WebP 转 JPEG 后识别；超大返回 413；明确类型／数量错误 |
| POST /api/knowledge/species/:id/photos | Multer 内存上传；5 MiB；photo 字段 1 张；无额外字段；Sharp 校验 JPEG／PNG、25 MP 上限并转 JPEG | Multer JPEG／PNG／WebP allowlist；内容格式与 MIME 一致；WebP 支持；明确 4xx 提示 |

保留 identify 10 MiB，兼容已有手机照片选择；knowledge 保留 5 MiB，与现有网页上传流程一致，控制服务端内存。每次一张，避免批量占用内存。

WebP 使用现有 Sharp，最多 25 MP，转为最长边 2000 px 的 JPEG；不新增依赖。Knowledge 的 JPEG／PNG 继续按原有处理流程转换。Identify 的 JPEG／PNG 保留原有文件头校验，不宣称完整解码验收。

本地测试覆盖：过大、过多、额外字段、错误 MIME、伪装内容、损坏 WebP，以及正常 JPEG／PNG／WebP。外部 AI、数据库和 Storage 使用模拟，不消耗线上配额或写入数据。

范围仅为上传安全；权限与 mobile JWT 在 PR #99。Mobile 目前仍只允许选择 JPEG／PNG；本次 WebP 支持属于后端 API，不宣称 App 已支持 WebP 选择。部署后仍需真实账号与客户端验收。
