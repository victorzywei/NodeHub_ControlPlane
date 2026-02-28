# Cloudflare Pages Functions 调试指南

## 问题现象

所有 Functions 端点都返回 HTML 而不是预期的响应：
- `/agent/install` → 返回 HTML（应该返回 bash 脚本）
- `/api/system/status` → 返回 HTML（应该返回 JSON）

这说明 **Functions 根本没有被执行**。

## 可能的原因

### 1. KV 绑定未配置

Functions 代码中使用了 `env.NODEHUB_KV`，如果 KV 绑定未配置，Functions 可能会失败。

**解决方案：**
1. 进入 Cloudflare Pages 项目设置
2. 找到 "Settings" → "Functions"
3. 添加 KV 命名空间绑定：
   - 变量名：`NODEHUB_KV`
   - KV 命名空间：选择或创建一个 KV 命名空间

### 2. 环境变量未配置

Functions 需要 `ADMIN_KEY` 环境变量。

**解决方案：**
1. 进入 "Settings" → "Environment variables"
2. 添加：
   - 变量名：`ADMIN_KEY`
   - 值：你的管理员密钥
   - 环境：Production（和 Preview 如果需要）

### 3. Functions 未启用

Cloudflare Pages 可能需要手动启用 Functions。

**解决方案：**
1. 检查项目设置中是否有 "Functions" 选项
2. 确认 Functions 已启用
3. 检查兼容性日期设置

### 4. 构建配置问题

**检查构建设置：**
- 构建命令：`npm run build`
- 构建输出目录：`dist`
- Root 目录：`/`（留空或设为根目录）

**重要：** Functions 目录 (`functions/`) 应该在项目根目录，不应该在 `dist` 里面。

### 5. 路由优先级问题

`public/_redirects` 可能导致路由问题。

**当前配置：**
```
/assets/*  /assets/:splat  200
/api/*     /api/:splat     200
/agent/*   /agent/:splat   200
/sub/*     /sub/:splat     200
/*         /               200
```

这个配置看起来是对的，但可能需要调整。

**尝试简化：**
```
/*  /index.html  200
```

或者完全删除 `_redirects` 文件，让 Cloudflare Pages 自动处理。

## 调试步骤

### 步骤 1: 检查 Cloudflare Pages 控制台

1. 登录 Cloudflare Dashboard
2. 进入 Pages 项目
3. 查看最新部署的详细信息
4. 检查 "Functions" 标签页

**期望看到：**
- Functions 列表显示所有函数文件
- 没有错误或警告

### 步骤 2: 查看构建日志

在部署详情中查看完整的构建日志：

**查找关键信息：**
- ✅ "Validating asset output directory"
- ✅ "Deploying your site to Cloudflare's global network"
- ✅ "Success: Assets published!"
- ⚠️ 任何关于 Functions 的错误或警告

### 步骤 3: 测试简单的 Function

创建一个最简单的测试函数：

**`functions/test.js`:**
```javascript
export async function onRequestGet() {
  return new Response('Hello from Functions!', {
    headers: { 'Content-Type': 'text/plain' }
  });
}
```

提交并部署后，访问：
```bash
curl https://nodehub-controlplane.pages.dev/test
```

**如果返回 "Hello from Functions!"：**
- Functions 系统工作正常
- 问题在于特定函数的代码

**如果仍返回 HTML：**
- Functions 系统未启用或配置错误
- 需要检查 Cloudflare Pages 设置

### 步骤 4: 检查 Functions 日志

1. 在 Cloudflare Pages 控制台
2. 进入 "Functions" 标签
3. 查看实时日志
4. 访问端点并观察日志输出

**如果没有日志：**
- Functions 没有被执行
- 路由配置可能有问题

### 步骤 5: 验证文件结构

确认项目结构正确：

```
project-root/
├── functions/           ← Functions 目录（在根目录）
│   ├── agent/
│   │   ├── install.js
│   │   ├── heartbeat.js
│   │   └── ...
│   └── api/
│       └── ...
├── public/              ← 静态文件
│   ├── agent-install.sh
│   └── _redirects
├── src/                 ← Vue 源代码
├── dist/                ← 构建输出（不包含 functions）
└── package.json
```

**重要：** `functions/` 目录必须在项目根目录，不能在 `dist/` 里面。

## 快速修复尝试

### 尝试 1: 删除 _redirects

```bash
git rm public/_redirects
git commit -m "Remove _redirects to test Functions"
git push
```

等待部署后测试。

### 尝试 2: 简化 install.js

创建最简单的版本：

```javascript
export async function onRequestGet() {
  return new Response('#!/bin/bash\necho "test"', {
    headers: { 'Content-Type': 'text/plain' }
  });
}
```

如果这个能工作，说明问题在于 fetch 静态文件的逻辑。

### 尝试 3: 使用 Advanced 模式

在 Cloudflare Pages 设置中：
1. 找到 "Functions" 设置
2. 启用 "Advanced" 模式
3. 设置兼容性日期为最新

## 联系支持

如果以上都不行，可能需要：
1. 检查 Cloudflare Pages 的服务状态
2. 联系 Cloudflare 支持
3. 在 Cloudflare Community 论坛提问

## 当前状态

- ✅ 代码已更新（commit: ebeffe6）
- ✅ 使用正确的函数签名 `{ request }`
- ⏳ 等待部署完成
- ⏳ 需要验证 Functions 是否工作

## 下一步

1. 等待当前部署完成（2-5 分钟）
2. 测试端点：`curl https://nodehub-controlplane.pages.dev/agent/install`
3. 如果仍返回 HTML，按照上述调试步骤检查 Cloudflare Pages 配置
4. 特别关注 KV 绑定和环境变量配置
