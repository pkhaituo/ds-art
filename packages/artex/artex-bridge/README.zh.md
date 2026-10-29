# @deepseek-ai/dsh-artex-bridge

将 [ARTEX](https://github.com/RuoJi6/ARTEX)（AI 自主渗透测试系统，完整源码内置于仓库 `extensions/artex/`，AGPL-3.0）的能力接入 DeepSeek Harness 的桥接插件。

插件通过 ARTEX Go 后端的 REST API 注册 7 个模型可调用工具，ARTEX 模块与 Harness 构建完全隔离：不需要 Go 工具链参与 pnpm 构建，两者只通过一个 HTTP base URL 交互。

## 工具

| 工具 | 说明 | ARTEX API |
| --- | --- | --- |
| `artex_status` | 检查服务器可达性、初始化与认证状态 | `GET /api/auth/status` |
| `artex_task_list` | 列出渗透测试任务 | `GET /api/tasks` |
| `artex_task_get` | 查看任务详情（范围、目标、状态） | `GET /api/tasks/{id}` |
| `artex_task_create` | 创建新的自主探索任务 | `POST /api/tasks` |
| `artex_findings` | 列出安全发现 | `GET /api/exploration/findings` |
| `artex_assets` | 列出资产（域名/子域/IP/端口/站点） | `GET /api/assets` |
| `artex_activity` | 查看探索活动流（agent 步骤、工具调用） | `GET /api/exploration/activity` |

除 `artex_task_create` 外全部只读。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `baseURL` | `http://127.0.0.1:8787` | ARTEX 服务器地址 |
| `token` | — | 明文 Bearer token（建议改用 `tokenEnv`） |
| `tokenEnv` | `ARTEX_API_TOKEN` | 从环境变量读取 Bearer token |
| `timeoutMs` | `30000` | 单请求超时 |

ARTEX 首次启动需在其 Web UI 的 `/setup` 完成管理员初始化；认证开启后，在 `ARTEX_API_TOKEN` 环境变量中提供凭据。

## 运行 ARTEX 服务端

见 `extensions/artex/README.md` 与仓库根 `docs/integrations/artex.md`。快速路径：

```sh
# 构建 Go 服务端（需要 Go >= 1.26）
pnpm run artex:build

# 或全套 Docker
cd extensions/artex && docker compose up -d
```

## 测试

冒烟测试基于 Node 内置 test runner，可直接从源码运行：

```sh
node --test --experimental-strip-types tests/artex-client.smoke.ts
```

## 许可

本插件为 MIT 许可（DeepSeek Harness 主体）。被桥接的 `extensions/artex/` 目录保留其原始 AGPL-3.0 许可，见 `extensions/artex/LICENSE`。
