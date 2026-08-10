# chatgpt.com UI 侦察报告（2026-08-11，CDP 9233 实测）

账号：Peter Qi Plus（ChatGPT Plus）。UI 为 2026-08 新版（Radix UI 组件体系）。

## 1. 模型选择器（智能选择器）

新版无传统模型下拉，而是"智能选择器"（intelligence picker）：

- **触发**：点击 composer 内的思考强度按钮（`text=高/中/低`，无 testid，位于输入框右侧）
- **菜单容器**：`[data-testid="composer-intelligence-picker-content"]`（`role=menu`，Radix）
- **菜单内容**（实测文本）：
  ```
  高，第 3 项，共 3 项。使用左右箭头键调整能力。
  高级 / 更快 / 更智能        ← 能力三档（滑块）
  模型  GPT-5.6 Sol           ← 模型项（Radix submenu：data-has-submenu, aria-haspopup=menu, id=radix-xxx）
  思考强度  高                ← 思考强度项（也是 submenu）
  ```
- **能力滑块视图**：`[data-testid="composer-model-picker-slider-simple-view"]`（简单视图）/ `[data-testid="composer-model-picker-slider-advanced-view"]`（高级视图，含"模型 + 思考强度"）
- **模型项**：`[role="menuitem"]` hasText `/^模型/`，Radix submenu（`data-has-submenu=""`，初始 `data-state="closed"`）
- **子菜单触发**：hover（Radix onPointerEnter）。⚠️ playwright `locator.hover()` 会被 `#thread-bottom-container` 拦截（pointer-events interception）→ **必须用 `page.mouse.move(x, y)` 真实移动**（先取模型项 boundingBox 中心坐标）
- **当前模型**：GPT-5.6 Sol（Plus 账号可见。其他模型需打开子菜单确认，未成功打开——交给实现时实测）
- 关闭：Escape

## 2. Deep Research（深度研究）

- **入口**：`[data-testid="composer-plus-btn"]`（composer 左侧"+"）→ 菜单（role=menu）→ `[role="menuitem"]` hasText `/^更多$/` → 子菜单 → `[role="menuitemradio"]` hasText `/^深度研究$/`
- **触发后 composer 状态**（实测）：出现 `[data-testid="composer-footer-actions"]`，footer 显示"深度研究 / 应用 / 站点"（可配置应用/站点范围）——**粘性模式**（Escape 不能关闭，需再点模式按钮或发送后恢复）
- **注意**："更多"子菜单还包含：创建任务、Adobe、Apple Music、Base44、Build iOS Apps 等 GPTs（`role=menuitemradio`）——同类入口可复用
- **进行中/完成检测**：未实测（不能真跑深度研究）。实现时轮询：composer 模式标记消失 + 新 assistant 消息出现（复用 conversation.ts 的 MESSAGE_SELECTORS + 消息配对机制）。深度研究回复可能很长/折叠

## 3. 图片生成（创建图片）

- **入口**：`[data-testid="composer-plus-btn"]` → 菜单 → `[role="menuitemradio"]` hasText `/^创建图片$/`
- **触发后 composer 状态**（实测）：footer 显示"图片 / 自动"（+ `composer-footer-actions`）——粘性模式
- **生成中/完成检测**：未实测。实现时轮询图片 artifact（`img` 节点 / artifact 卡片），图片 URL 可能 `blob:` 或 `https://files.oaiusercontent.com/...`；注意 DALL·E 生成图片通常有网格/缩略图容器
- 发送方式：模式激活后 composer 输入 prompt → 发送按钮（`[data-testid="send-button"]`）——复用现有 composer/submit 逻辑

## 4. 其他可用能力（未来扩展）

- Plan mode（`+`菜单 menuitemradio）——代码规划模式
- 网页搜索（`+`菜单 menuitemradio）
- 创建任务（`更多`子菜单）
- 顶部 `[role="radio"]`："聊天" / "工作" 两个视图标签（工作视图含任务等）

## 5. 关键坑（实现必读）

1. **Radix submenu**：hover 触发，`locator.hover()` 会被 composer 容器拦截 → 用 `page.mouse.move(box.x + box.width/2, box.y + box.height/2)` 后等 500-800ms
2. **粘性模式**：深度研究/图片模式激活后 Escape 不关闭 → 恢复方式需实现时确认（可能点 footer 模式按钮切换回默认，或再点一次同菜单项取消）
3. **菜单项定位**：全部无 data-testid，用 `role=menuitem / menuitemradio` + hasText（精确正则，避免误匹配侧边栏）
4. **新标签页侦察**：adapter 运行时操作的是它自己的页面；测试交互建议用新页面，避免干扰（实现时的 live 测试例外——adapter 自己操作就是操作它的页面）
5. 发送按钮在模式激活后仍为 `[data-testid="send-button"]`
6. 截图存档：docs/ui-recon-screenshots/（40-deep-research-mode.png、41-image-mode.png、43-model-hover.png 等）

## 侦察脚本（可复用）

- scripts/recon-fast.mjs（静态 DOM 特征）
- scripts/recon-interact.mjs（点按钮 dump 菜单）
- scripts/recon-deep.mjs / recon-more.mjs（深挖菜单）
- scripts/recon-trigger.mjs（模式触发状态）
- scripts/recon-hover.mjs（hover 子菜单测试）
