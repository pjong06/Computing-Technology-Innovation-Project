# 1. QR代理集中诊断

| Label | 内容 |
| --- | --- |
| where | publicQrProtection.js；Render QR_IP_DEBUG=true时启用，默认关闭 |
| what happen | 日志标识qr-ip-diagnostic，含testMarker、processInstance、IP链带盐哈希、count、limit、windowMs、windowEndsAt、status及outcome |
| why | 原日志无法准确对应电脑／手机，也无法比较代理链与进程计数 |
| 后果 | 一轮三次电脑＋三次手机请求可缩小原因；不是自动确认根因或完成限流验收 |
| how to fix | 先部署本分支，启用开关；执行下述对照，按证据修复，结束后关闭开关 |

## 2. 执行

1. 确认部署包含本次修改。Render设置QR_IP_DEBUG=true；Logs筛选qr-ip-diagnostic。
2. backend目录运行：`node scripts/diagnose-qr-proxy.cjs`。仅发三次空QR请求（正常400），输出三条手机链接和本地JSON结果。
3. 手机关闭Wi-Fi并启用移动数据，分别打开输出的三条链接一次；电脑不再刷新QR。
4. 从Render复制同一run的六条日志，按testMarker匹配。日志不含密码、token、原始IP、QR值或完整URL。
5. 完成后关闭QR_IP_DEBUG，确认新请求不再产生日志；代理问题修复后仍需429／恢复及双客户端验收。

## 3. 判读

| 现象 | 下一步 |
| --- | --- |
| 同一客户端ipHash变化，而cfConnectingIpHash／代理链某段稳定 | 可能取到变化的代理；结合可信代理拓扑确认，不能盲改hop数 |
| 手机与电脑ipHash相同，但其余客户端候选哈希不同 | 检查计数key是否使用共享代理地址 |
| processInstance不同 | 先核查部署／重启；不同进程的盐不同，IP哈希不能直接跨进程比较 |
| count或windowEndsAt不同／重置 | 结合processInstance和时间检查新窗口、重启或不同key |
| 手机日志缺失 | 核对部署、日志范围、URL标记及缓存；不能判为通过 |

所有转发头仅是待验证线索，可能被伪造；本改动不把CF或XFF当可信授权来源，不修改trust proxy或60次／60秒限流。HMAC盐仅保留进程内，不写入日志。只接受sec76-computer/phone加数字run及1–3的固定标记格式，不输出任意query内容；代理链最多记录16段哈希。
