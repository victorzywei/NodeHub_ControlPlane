# NodeHub Modern (Greenfield)

全新项目（未复用 `old/` 代码），采用前后端解耦架构：

- Frontend: Vue 3 + TypeScript + Vue Router + Pinia
- API: Cloudflare Pages Functions (`functions/`)
- Storage: Cloudflare KV (`NODEHUB_KV`)
- Testing: Vitest + Playwright

## 信息架构

- `/overview` 总览
- `/nodes` 节点（列表 + 详情抽屉 + 批量删除）
- `/templates` 配置模板（内置/自定义 + 统一参数编辑器）
- `/release` 发布中心（抽屉式直连下发，保留最近 10 次操作）
- `/subscriptions` 订阅（卡片式管理 + v2ray/clash/singbox 链接）
- `/system` 系统
- `/login` 登录

## 内置协议模板

- `VLESS + Reality + TCP`（默认端口 `49443`）
- `Hysteria2`（默认端口 `49444`）
- `Shadowsocks 2022`（默认端口 `49445`）
- `VLESS + WS + TLS`（默认端口 `2053`）
- `Trojan + TCP + TLS`（默认端口 `2087`）

模板编辑器会优先使用下拉选项；无可选项时使用输入框。密钥/密码类参数在缺省时会自动生成。

## 本地开发

```bash
npm install
npm run dev
```

## 质量检查

```bash
npm run typecheck
npm run test
```

## 构建

```bash
npm run build
```

## E2E 冒烟

```bash
set PLAYWRIGHT_ADMIN_KEY=your-admin-key
npm run e2e
```


## Cloudflare Pages

- 构建输出目录：`dist`
- Functions 目录：`functions`
- 必需环境变量：`ADMIN_KEY`
- 可选环境变量：`SUBSCRIPTION_BASE_URL`（用于订阅链接固定域名，例如 `https://sub.example.com`）
- 必需 KV 绑定：`NODEHUB_KV`
- 路由策略：`public/_redirects` 已配置 `/api/*`、`/agent/*`、`/sub/*` 与 SPA fallback
- 生产部署手册：见 `DEPLOYMENT.md`

## 发布流建议

1. PR Preview 环境验证
2. 核心冒烟（登录、建节点、下发配置、订阅）
3. Promote 到生产
4. 若异常，修复后重新对节点下发最新配置

## 代理在线性边界

- 不保证：网络分区期间无法 100% 保证管理端“在线可见”。
- 可保证：心跳链路与拉版本/应用链路解耦，应用异常不应影响心跳上报。
- 可保证：VPS 心跳每 5 分钟上报一次，包含部署信息、协议应用版本、最近错误、CPU/内存占用。
- 可保证：代理会将 `apply_result` 事件落盘到本地 `pending-events.jsonl`，并在网络恢复后重试补发。
- 可保证：安装脚本会注册 `nodehub-heartbeat.service` 与 `nodehub-reconcile.service`（`Restart=always`），由 systemd 托管以降低单线程崩溃影响。
