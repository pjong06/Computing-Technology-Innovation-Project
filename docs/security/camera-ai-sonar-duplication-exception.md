# 1. PR 121：已批准的 migration 重复率例外

| where | what happen | why | 后果 | how to fix |
|---|---|---|---|---|
| Sonar PR #121 | 新代码重复率 3.4%，要求不超过 3% | 两份已执行 migration 的函数重定义有 18 行相同 | CI 通过，Quality Gate 尚未通过 | 仅对下面的历史补丁设置 duplication exclusion；用户已批准 |
| 当前 Sonar 账号 | API 未能修改设置；showSettings=false、canScanProject=false | 没有项目管理权限 | 不能声称云端设置已保存 | 已提供仓库 .sonarcloud.properties；验证是否被 PR 分析采用 |
| Sonar owner | 如 PR 不采用仓库配置，需要 owner 设置 | 自动扫描配置可能需默认分支生效 | draft PR 保持，不能称为通过 | Administration → General Settings → Analysis Scope → Duplications → Duplication Exclusions，增加下方精确路径；保留其他配置后重扫 |

```text
supabase/migrations/20261118123358_camera_ai_settle_exhausted_leases_before_quota.sql
```

仅排除重复率计算，不排除安全分析、不改 3% 阈值、不改写已应用 SQL、不排除整个目录。官方说明：https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/project-analysis/setting-analysis-scope/exclude-from-coverage-duplication
