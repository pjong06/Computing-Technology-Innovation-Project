# 1. 新 Dashboard 接线

| Label | 内容 |
|---|---|
| where | `/portal/iot-workspace.html`、`/api/iot-workspace` |
| what happen | 新增独立页面；原 `alerts.html`、`alerts.js` 保留 |
| why | 接入真实会话、读数、任务、位置和照片 |
| 后果 | 新页面没有模拟数据或角色切换；需要登录 |
| how to fix | SQL 已批准应用；还需合并部署并用真实账号验收 |

# 2. 数据库变更（已批准应用）

| Label | 内容 |
|---|---|
| where | `supabase/migrations/20261119082701_assigned_iot_workspace.sql` |
| what happen | 新增 `assigned_to/by/at`、`assignment_notes`、索引和四个受限 RPC |
| why | 保存分派；防止 Botanist 绕过页面读取全部 IoT 数据 |
| 后果 | Officer 分派；仅被分派 Botanist 可填写备注并完成；Researcher 拒绝。旧页面仍在，但旧的共享权限及无分派状态操作不再适用 |
| how to fix | 已应用 SQL。保留现有五条 Resolved 告警，不回填、不重置、不删除账号或遥测 |

# 3. 图片流量与失败处理

| Label | 内容 |
|---|---|
| where | `frontend/iot-workspace/photos.js`、`backend/src/routes/iotWorkspace.js` |
| what happen | 选择告警且图片可见后才加载；并发最多 2；失败后最多自动重试 3 次，退避 1/2/4 秒 |
| why | 签名更新不能清零失败次数；刷新复用已解码图片节点 |
| 后果 | 列表不下载照片；详情用最长边受限的小图，点开才取原图；已加载图片不因签名过期重下 |
| how to fix | 保持私有 bucket、签名 60 秒；失败停止后显示 Refresh，人工点击才开启新的有限重试周期 |

缩略图：backend `sharp` 输出最大 480×320、JPEG quality 65；内存缓存最多 32 张、5 分钟；每次命中仍重新检查任务权限。页面缓存最多 12 个图片节点，不写本地存储。原图签名只在真正打开原图时获取。

验证：后端完整测试 590 PASS（含新增 13 项 workspace 检查及 3 项 AI 分类检查）；独立 PostgreSQL 25 项权限/流程检查通过；浏览器接口夹具验证通过。以上不是线上账号验收。线上 SQL 已应用；事务回滚验证 Officer 分派、本人读取位置/完成、跨 Botanist 与 Researcher 拒绝通过。此处使用数据库角色/claims 模拟，不等同真实 JWT 验收。Render 未部署本分支。

# 4. 上线状态

| Label | 内容 |
|---|---|
| where | `/portal/iot-workspace.html` |
| what happen | 本地已接真实 Supabase；旧 Dashboard 文件未修改 |
| why | 需先核对真实账号读取和照片，再部署 |
| 后果 | 线上 RLS 已按新分工收紧；旧共享读取与旧的无分派操作会被拒绝。仅新页面的代码尚未上线 |
| how to fix | 真实账号验收后 push/PR、CI/Sonar、合并与 Render 部署；本轮尚未 push |

数据核对：5 alerts、3 照片关联、1519 readings、654 Storage 对象均不变；回滚 fixture 为 0。

已检查 Advisor：三个 authenticated SECURITY DEFINER 提示为刻意保留的受限入口（Botanist 目录、任务位置、Officer 人工 AI 复核）；均检查实时角色/身份，固定 search_path，anon 无 EXECUTE。其余模块提示未在本次更改。

图片验收：浏览器验证原图签名连续更新时仍最多 4 次总尝试，失败后重绘不重启；Refresh 人工重试可用。实际缩略图测试确认尺寸与字节数小于原图。

# 5. PR 前 review 修复

| Label | 内容 |
|---|---|
| where | 新页面、共享导航、AI 重开 guard 补丁 migration |
| what happen | 修复新照片与关闭时间竞争；刷新元数据/AI、切换照片分析、保留已加载历史页；注册公共导航入口 |
| why | 避免上传失败、旧分析、任务入口不可达及历史页被刷新清空 |
| 后果 | 原 Dashboard 保留；导航 IoT 区域新增 Workspace 页签，Botanist 可进入自己的任务 |
| how to fix | 已本地验证；SQL guard 补丁已应用，待 PR/CI 和部署后账号验收 |

注意：部署新后端前，旧 Render 的内存型 IoT API 仍可能使用旧共享角色规则；不能仅凭数据库 RLS 宣称所有线上入口已收紧。
