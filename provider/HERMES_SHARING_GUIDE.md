# 给朋友的安装指南：让 Hermes 用上 ChatGPT 网页版

> 一句话：这个工具让 **Hermes Agent** 可以直接调用你登录的 **ChatGPT 网页版**（GPT-5.x），
> **不需要 OpenAI API key，不花 API 钱**——用的就是你的 ChatGPT 账号。
> 适配器在本地起一个 OpenAI 兼容服务（127.0.0.1:8765），Hermes 把它当自定义模型。

---

## 1. 这是什么

```
Hermes Agent
   ↓ (OpenAI 兼容 /v1)
本地适配器  http://127.0.0.1:8765/v1
   ↓ (Playwright / CDP)
专用 Chrome（你登录过的 ChatGPT 账号）
   ↓
chatgpt.com 网页版
```

**安全边界**（设计如此，请放心）：
- 不提取你的 Cookie / Token / 密码
- 不绕过 ChatGPT 的 CAPTCHA / 限流 / 安全验证
- 只在本地运行（127.0.0.1），不对外网开放
- 遇到登录失效、限流、人机验证，会停止并明确报错，绝不硬闯

---

## 2. 前置条件（Windows）

| 项目 | 要求 |
|---|---|
| 系统 | Windows 10 / 11 |
| Node.js | ≥ 20（建议 24，下载：https://nodejs.org） |
| Chrome | 已安装（系统自带即可） |
| Hermes | 已安装并能正常使用（v0.20+，`hermes --version` 确认） |
| ChatGPT 账号 | 有一个能登录 chatgpt.com 的账号 |

---

## 3. 安装适配器

```powershell
# 1) 解压本包到任意目录（如 D:\chatgpt-web-provider）
# 2) 打开终端进入目录
cd D:\chatgpt-web-provider

# 3) 安装依赖（注意：必须带 --include=dev，否则缺少编译工具）
npm install --include=dev

# 4) 验证（可选但推荐）
npm run build          # 应无报错
npm run test           # 应显示 76 passed
```

---

## 4. 首次登录（只需一次）

双击运行 `start-adapter.bat`，或者手动执行：

```powershell
# 启动专用 Chrome（登录态保存在 C:\Hermes\chatgpt-web-profile）
"C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=9233 `
  --user-data-dir="C:\Hermes\chatgpt-web-profile" `
  --no-first-run --no-default-browser-check "https://chatgpt.com"
```

在弹出的 Chrome 窗口里**登录 ChatGPT 一次**。之后登录态一直保存在这个专用 profile 里（和你的日常 Chrome 互不干扰）。

接着启动适配器：

```powershell
# 在项目目录里
$env:CHROME_LAUNCH_AT_STARTUP="false"
$env:CHROME_CDP_PORT="9233"
$env:ADAPTER_PORT="8765"
.\node_modules\.bin\tsx.cmd src\index.ts
```

看到 `listening on http://127.0.0.1:8765` 就成功了。验证：

```powershell
curl http://127.0.0.1:8765/health
# 期望: {"status":"ok","browser_connected":true,...,"auth_state":"authenticated",...}
```

---

## 5. 配置 Hermes

编辑你的 Hermes profile 配置文件（一般位于
`C:\Users\<你的用户名>\AppData\Local\hermes\profiles\<profile名>\config.yaml`，
桌面版里也可通过设置界面操作，但直接改文件最稳）。

**改前先备份**：复制一份 config.yaml。

在 `custom_providers:` 列表里**追加**一项（保持原有项不动）：

```yaml
custom_providers:
  # ...你原有的 provider 不动...
  - name: chatgpt-web
    base_url: http://127.0.0.1:8765/v1
    key_env: CHATGPT_WEB_API_KEY
    model: chatgpt-web
    context_length: 32768
    discover_models: false
    models:
      - chatgpt-web
```

（可选，推荐）把它加进 fallback 链——**主模型（如 deepseek/GLM）限流或报错时自动切换**：

```yaml
fallback_providers:
  - provider: custom
    model: chatgpt-web
    base_url: http://127.0.0.1:8765/v1
```

然后在 profile 的 `.env` 文件末尾加一行（占位密钥即可，适配器不强制校验）：

```
CHATGPT_WEB_API_KEY=local-adapter-secret
```

---

## 6. 验证 Hermes

```powershell
# 查看 fallback 链是否识别
hermes fallback list
# 应看到: 1. chatgpt-web (via custom) [http://127.0.0.1:8765/v1]

# 手动指定 chatgpt-web 跑一句（注意 -z 是全局参数，放在 chat 前面）
hermes -z "只回复两个字：联通" chat -m chatgpt-web --provider custom
# 期望回复: 联通
```

看到回复就成功了 🎉

日常用法：
- **手动**：`hermes -z "问题" chat -m chatgpt-web --provider custom`，或对话中 `/model chatgpt-web`
- **自动**：主模型失败时 fallback 自动顶上（如果你配了 fallback_providers）
- **切回**：`/model <你原来的模型>` 或重启 Hermes

---

## 7. 日常使用（随 Hermes 守护）

Hermes 有原生 cron 调度器——可以加一个"看门狗"任务，让 adapter 跟着 Hermes 活着：

1. 把包里的 `watchdog-adapter.py` 复制到
   `C:\Users\<你的用户名>\AppData\Local\hermes\scripts\`
2. 在 Hermes 里执行（或直接编辑 cron 配置）：

```
/cron 添加任务：
  名称: chatgpt-web watchdog
  频率: every 5m
  类型: 脚本（no-agent）
  脚本: watchdog-adapter.py
```

效果：Hermes 运行时每 5 分钟检查一次 adapter，没跑就自动拉起（Chrome + 适配器）；
一切正常时完全静默。Hermes 不运行，看门狗也不跑——这就是"随 Hermes 自启"。

（如果嫌麻烦，每天开机双击 `start-adapter.bat` 也一样。）

---

## 8. 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| `503 BROWSER_UNAVAILABLE` | Chrome 没启动或端口被占 | 运行 `start-adapter.bat`；确认 9233 端口空闲 |
| `auth_state: not_checked / unknown` | 专用 Chrome 没登录 | 打开专用 Chrome 登录 chatgpt.com 一次 |
| 回复很慢（10-30 秒） | ChatGPT 网页生成本来就要这么久 | 正常，不是卡死 |
| 每次请求都开新对话 | Hermes 每次 `-z` 是新会话 | 正常设计；连续对话用同一会话 |
| `hermes fallback list` 看不到 | config.yaml 没保存/没重启 | 检查 YAML 缩进、重启 Hermes |
| 卡在生成中很久 | 页面状态异常 | 重启适配器（Ctrl+C 再启动） |

---

## 9. 一句话总结

> 跑 `start-adapter.bat`（登录一次）→ 改 config.yaml 加 `chatgpt-web` provider →
> `hermes -z "你好" chat -m chatgpt-web --provider custom` 直接可用，零 API 费用。

---

## 技术备注（给好奇的朋友）

- 适配器 = TypeScript + Fastify + Playwright，SQLite 持久化（`data/bridge.db`）
- 自带：恰好一次提交（不重复发消息）、崩溃恢复、ChatGPT UI 变化自适应（语义定位 + 自愈规则）、流式输出、工具调用协议
- Hermes 集成已在本机实弹验证：流式 + 工具 + fallback 全链路可用
- 完整规格与状态：`IMPLEMENTATION_STATUS.md`；故障手册：`RUNBOOK.md`
