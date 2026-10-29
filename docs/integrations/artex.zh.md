# ARTEX 扩展模块集成指南

本仓库（ds-art，主体为 DeepSeek Harness）将 [ARTEX](https://github.com/RuoJi6/ARTEX) —— AI 自主渗透测试系统 —— 作为**功能扩展模块**完整集成。集成遵循一条核心原则：**ds-art 架构是主体，ARTEX 是可拆卸的功能模块**，两者在构建、依赖与运行时层面完全隔离。

## 集成结构

```
extensions/artex/              ← 完整 ARTEX 源码（Go 后端 + Next.js 前端 + skills）
  ├─ cmd/artex/                ← Go 服务端入口（REST API + 静态资源）
  ├─ agent/ server/ db/ llmpool/ mcphttp/ traffic/ intercept/ …
  ├─ web/                      ← Next.js 前端（npm，独立于 pnpm workspace）
  ├─ skills/                   ← api-recon / scopesentry / playwright-cli（SKILL.md 格式）
  ├─ LICENSE                   ← 原始 AGPL-3.0 许可，原样保留
  └─ README.md                 ← ARTEX 自身文档
packages/artex/artex-bridge/   ← dsh 桥接插件（@deepseek-ai/dsh-artex-bridge，MIT）
  ├─ src/client.ts             ← 零依赖 ARTEX REST 客户端
  ├─ src/index.ts              ← Cordis 插件：注册 7 个 artex_* 工具到 ctx.tools
  └─ tests/artex-client.smoke.ts ← node:test 冒烟测试
scripts/artex.mjs              ← 跨平台构建/测试分发脚本
```

## 隔离设计

| 维度 | 做法 |
| --- | --- |
| 包管理 | `extensions/` 不在 `pnpm-workspace.yaml` 中；ARTEX 不参与 dsh 的 install/build/lint/typecheck |
| 语言与工具链 | ARTEX 需要 Go ≥ 1.26 与 npm（仅其自身构建时）；dsh 构建路径不依赖 Go |
| 许可证 | ARTEX 为 AGPL-3.0，其 `LICENSE` 原样保留在 `extensions/artex/`；dsh 主体保持 MIT |
| 运行时 | 桥接只通过 HTTP（默认 `http://127.0.0.1:8787`）；两者可独立启停 |
| 构建产物 | `.gitignore` 已排除 `extensions/artex/bin/`、`web/.next/`、`config.json` 等 |

## 构建与运行

```sh
# 检查工具链
pnpm run artex:check

# 编译 Go 后端（输出到 extensions/artex/bin/）
pnpm run artex:build

# 运行 ARTEX Go 测试套件
pnpm run artex:test

# ARTEX Web 前端
pnpm run artex:web:install
pnpm run artex:web:build
pnpm run artex:web:dev
```

等价的 Make 目标：`make artex-build` / `artex-test` / `artex-web-install` / `artex-web-build`。

也可以用 ARTEX 自带的 Docker 方案：`cd extensions/artex && docker compose up -d`。

首次启动 ARTEX 后访问 `http://localhost:8787/setup` 完成管理员初始化；探索任务需要配置 LLM（在 ARTEX UI 的「LLM 配置」页，或 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）。

## 在 dsh agent 中使用

`@deepseek-ai/dsh-artex-bridge` 是标准 Cordis 插件（`inject: ['tools']`），与其他工具插件一样由插件加载器挂载后注册到 `ctx.tools`：

| 工具 | 作用 |
| --- | --- |
| `artex_status` | 检查 ARTEX 服务器与认证状态 |
| `artex_task_list` / `artex_task_get` | 查看渗透测试任务 |
| `artex_task_create` | 创建新的自主探索任务 |
| `artex_findings` | 读取安全发现 |
| `artex_assets` | 读取资产清单（域名/子域/IP/端口/站点） |
| `artex_activity` | 查看探索活动流 |

配置项：`baseURL`（默认 `http://127.0.0.1:8787`）、`token`/`tokenEnv`（Bearer 凭据，默认环境变量 `ARTEX_API_TOKEN`）、`timeoutMs`。

ARTEX 自带的三个 agent 技能（`extensions/artex/skills/`）采用标准 `SKILL.md` 格式，可被 dsh 的技能体系直接加载。

## 测试

```sh
# 桥接插件冒烟测试（无需任何依赖安装）
pnpm run artex:bridge:test

# ARTEX Go 全量测试
pnpm run artex:test
```

## 安全提示

ARTEX 是真实的渗透测试工具。请仅在获得明确书面授权的目标上使用，并遵守当地法律法规。参见根目录 [SAFETY.zh.md](../SAFETY.zh.md)。
