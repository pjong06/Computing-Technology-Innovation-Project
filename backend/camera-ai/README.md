# 1. Gemini 单张照片测试

本节说明单张测试入口；自动队列、私有照片和独立演示页已另行验证，见 RESULTS.md。尚未接入现有 Render backend／IoT Dashboard。只新增文件，不修改现有模块或 package.json，不安装新依赖。

| 项目 | 内容 |
|---|---|
| 模型 | gemini-3.5-flash-lite，已核对官方图片输入及结构化输出支持 |
| 凭证 | 读取 backend/.env 的 GEMINI_API_KEY；不显示 key |
| 图片 | 本地 JPEG／PNG／WebP，最多 5 MiB；重编码为 JPEG，最长边 1280，去除 EXIF／GPS |
| 请求 | 明确加 --send 才发送一张图片到 Google；不自动重试／切换模型 |
| 结果 | person／animal 可同时出现；区分无目标和无法判断；始终要求人工复核 |
| 免费层 | 以项目 AI Studio 显示为准；脚本不能判断 billing 是否开启，也不能保证调用免费 |

在 backend 目录执行，替换路径为你自己的非敏感测试图：

```powershell
# 只检查图片，不读 key、不调用 API
node camera-ai/review-image.cjs --image "C:\path\sample.jpg"

# 确认项目免费额度及图片适合发送后，单次实际分析
node camera-ai/review-image.cjs --image "C:\path\sample.jpg" --send

# 本地模拟测试，不读取 key 或调用 Google
node --test camera-ai/gemini-review.test.cjs
```

不把 private Storage URL 传给模型，不扫描照片文件夹，不自动保存图片／分析结果，也不修改 alert 状态。模型输出无自由文本说明，避免把人物身份等不需要的信息带进日志。

## 2. 常见问题

| where | what happen | why | 后果 | how to fix |
|---|---|---|---|---|
| 本地配置 | GEMINI_KEY_MISSING | 运行环境及 backend/.env 未提供 key | 无法分析 | 本地确认变量名；不要发送 key |
| Google API | GEMINI_HTTP_429 | 配额／速率不足 | 本次失败，不重试 | 查 AI Studio 限额，稍后手动再试 |
| Google API | GEMINI_HTTP_400／403／404 | 请求、权限、区域或模型可用性需确认 | 本次失败 | 查项目权限及模型文档；不自动开 billing |
| Google 返回 | AI_RESPONSE_INCOMPLETE／AI_RESULT_INVALID | 拦截、截断或结果不符合约定 | 不输出成功结论 | 换非敏感测试图片并核对接口 |

接口依据：https://ai.google.dev/api/generate-content

模型依据：https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite

只有模拟测试通过不代表真实 API、模型准确率或自动流程已验收。下一步用指定的非敏感图片实际测试，再对比人／动物／无目标／模糊样本。
