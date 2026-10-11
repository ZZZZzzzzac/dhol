# Room V2 验证记录

更新：2026-10-09（Asia/Hong_Kong）。本文件只记录脱敏的测试条件和汇总，不存邀请码、会话令牌或完整角色资料。

## 阶段一：旧版基线

| 项目 | 已核对内容 |
| --- | --- |
| 本地代码 | `4ac15e308ae10d4b45e2ade061e1b94a074a61db`，前端为公告页；代码状态与生产分开记录 |
| Worker | `dhol-realtime`，Wrangler 所列最新部署为 2026-10-01 02:20:16 UTC、版本 `49a3bf11-598e-475f-8c3c-ada1b3c0fcc8`；部署注释指向 `3ca27b8`，不能据此推断完整工作树或前端版本 |
| 前端部署 | 正式域名 `https://screenol.pages.dev/`，Pages 项目 `screenol`，最新 Production 部署 `27e5b092-b657-462d-9e06-bceb2df52e4a`，来源 commit `4ac15e3`；2026-10-09 HTTP 200 标题为“技术升级中｜角色卡在线追踪” |
| 测量环境 | Windows 本机、Node 22.14、Wrangler 4.92、本地 Durable Object；Chrome/Playwright 两个标签页，发起端为后台标签页、观察端为前台标签页；无公网网络延迟 |
| 测试房间 | 仅本机创建四个合成 HTML 角色；备份保存在未提交的 `tmp/phase1-synthetic-backup.dhroom`，不使用用户房间 |
| Duration 报警 | 当前无报警时间窗口、截图或具体 namespace 归属证据；待核对 Duration、WebSocket 入站消息与重连数 |

本地已得到四角色、双连接、30 次普通二元骰的运输层样本，以及四角色、双 Chrome 标签页、30 次点击到骰子历史 DOM 更新的样本。后者用 Chrome DevTools WebSocket 帧与 Playwright 观察 DOM，每次保留 `requestId`，两端 roll ID 均一致。当前正式页面为公告页；旧版 Pages 部署仍可查询，但它连接的可能是正式 Worker，不能在其上创建压力测试房间。样本不能代替真实玩家网络，也没有服务器内部排队/存储分段。后续在隔离环境下以相同房间规模重测新版。

| 本机合成样本（30 次） | P50 | P95 | 最大 | 失败 |
| --- | ---: | ---: | ---: | ---: |
| 发起连接发送至 `dice.rolled` | 1.5 ms | 1.7 ms | 1.9 ms | 0 |
| 观察连接发送至 `dice.rolled` | 1.4 ms | 1.7 ms | 1.8 ms | 0 |

两连接收到的 roll ID 全部一致。测量脚本为 `scripts/measure-legacy-baseline.mjs`，固定访问 `127.0.0.1:8787`。发送间隔约 2.6 秒，避免旧房间限速；一次更快发送的预跑在第 27 次附近收到 `RATE_LIMITED`，未计入本表。P95 仅作小样本方向性参考。由于两条连接均在同一机器上，这些毫秒数不能代表香港公网玩家体验，也无法判断 UI 延迟主要来自哪一段。

| 本机浏览器样本（30 次） | P50 | P95 | 最大 | 失败 |
| --- | ---: | ---: | ---: | ---: |
| 点击至发起端收到 WebSocket 结果 | 90 ms | 103 ms | 106 ms | 0 |
| 点击至观察端收到 WebSocket 结果 | 62 ms | 78 ms | 82 ms | 0 |
| 点击至发起端历史 DOM 更新 | 95 ms | 108 ms | 110 ms | 0 |
| 点击至观察端历史 DOM 更新 | 65 ms | 82 ms | 85 ms | 0 |
| WebSocket 接收至历史 DOM 更新（发起端） | 4 ms | 6 ms | 6 ms | 0 |
| WebSocket 接收至历史 DOM 更新（观察端） | 3 ms | 4 ms | 5 ms | 0 |

浏览器脚本 `scripts/measure-legacy-browser-batch.js` 每次采集 10 次，连续运行三批；每次间隔约 2.6 秒。以上耗时在同一个 Playwright 驱动进程使用 `Date.now()` 记录点击起点、CDP 帧回调及 DOM 条件满足时刻，避免相减不同机器的绝对时间。它包含自动化调度开销，DOM 更新不是屏幕实际扫描输出；发起端与观察端的前后台状态不同，也不能据差值推断服务器发给一方更慢。

| 场景 | requestId（脱敏样本） | 服务端处理 ms | 存储 ms | 发起端 DOM ms | 观察端 DOM ms | 重连 | 失败 |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| 本机四角色二元骰 | `lsLf…MXe2` | 未测 | 未测 | 110 | 85 | 否 | 否 |
| 本机四角色二元骰 | `v7R6…qq1g` | 未测 | 未测 | 96 | 82 | 否 | 否 |
| 本机四角色二元骰 | `6vyf…JHs` | 未测 | 未测 | 106 | 75 | 否 | 否 |

旧版 `waitForPersistence: false` 使广播先于保存完成，当前没有把“收到结果”当成“已持久化”的证据。生产服务端的排队/存储分段和 Cloudflare Duration 报警归属仍待获取；浏览器端本地样本显示 DOM 更新占比小，但不能证明线上延迟的主要来源。

### 本地旧 Worker 临时埋点

在隔离 Worker 中短暂用 `performance.now()` 测量旧版 `dice.roll` 路径，记录 `requestId` 后撤回全部旧代码埋点。另一组四合成角色、30 次普通二元骰样本如下；采样精度约 1 ms，低于 1 ms 的步骤显示为 0，不代表零耗时。

| 服务端分段（30 次） | P50 | P95 | 最大 |
| --- | ---: | ---: | ---: |
| 已解析请求至 `mustLoad()` 完成 | 0 ms | 1 ms | 1 ms |
| `mustLoad()` 后的整房间预拷贝 | 0 ms | 1 ms | 1 ms |
| 掷骰算法 | 0 ms | 0 ms | 1 ms |
| 提交时捕获待保存整房间快照 | 0 ms | 1 ms | 1 ms |
| 广播事件 | 0 ms | 1 ms | 1 ms |
| 快照保存 Promise 完成（自捕获结束起） | 19 ms | 20 ms | 20 ms |

这组样本的 WebSocket 发起端接收 P50/P95 为 1.5/1.9 ms，观察端为 1.4/1.9 ms；30 个 roll ID 一致、无失败。保存完成时间晚于广播是旧代码 `waitForPersistence: false` 的执行顺序，不能把 19 ms 保存耗时加到客户端看到结果的耗时上。客户端浏览器样本和此服务端埋点样本是两次独立运行，`requestId` 不共享；目前只能比较分布，不能逐条跨两次运行相减。

| 场景 | requestId | 加载 ms | 预拷贝 ms | 掷骰 ms | 捕获 ms | 广播 ms | 保存 ms | 失败 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 本机合成房间 | `roll-0` | 0 | 0 | 0 | 1 | 0 | 2 | 否 |
| 本机合成房间 | `roll-1` | 0 | 0 | 0 | 0 | 0 | 19 | 否 |
| 本机合成房间 | `roll-29` | 0 | 0 | 0 | 0 | 0 | 3 | 否 |

本机数据显示旧版小房间的 UI 历史 DOM 更新通常在收到结果后数毫秒完成；它没有解释真实玩家反馈的高延迟。公网往返、远端 DO 冷启动和 Cloudflare Duration 需要正式报警窗口及隔离测试环境数据才能判断。

### 采集方式

1. 在隔离环境用合成角色创建四角色房间并导出备份。记录服务端及前端部署版本。
2. 两个浏览器会话加入同一房间，确认 WebSocket 已连接；每次请求使用独立 `requestId`。
3. 服务端用单调时钟记录收到请求、开始提交、事务成功、广播完成，`room-v2-metrics.ts` 汇总服务器段耗时。客户端各自用本机单调时钟记录点击、收到结果与完成绘制。不同机器的绝对时间戳不能直接相减。
4. 普通骰池约 30 次，分别记录发起端和观察端点击到正式结果显示耗时；统计 P50/P95、最大值与失败数。P95 仅作小样本方向性参考。记录空闲唤醒的首掷并单列，不混进热路径分布。
5. 样本表只保留随机 `requestId`、各段毫秒数、是否重连与是否失败。报告中只保存汇总及少量脱敏样本。

| requestId | 服务端排队 ms | 存储 ms | 广播 ms | 发起端显示 ms | 观察端显示 ms | 重连 | 失败 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 待测 | — | — | — | — | — | — | — |

### 旧版故障代码证据

- `fronted/src/components/gm-panel/GmPanelBoard.tsx` 约 119–163 行：可见卡片开始请求时设置 `loading: true`，切页清理只设置 `disposed = true`。请求完成后回调因 `disposed` 直接返回；再次进入时 `cached?.loading` 阻止新请求。这能解释持续加载，尚未证明线上出现频率。
- 原 `apps/realtime/src/index.ts`（现隔离到 `legacy-room.ts`）约 1431–1437、1505–1532 行：DO 读出旧房间后调用 `hydrateStoredGmSheetHtml()`；当 HTML 需要补载时，用 `applyHtmlResourceTracksToSheet()` 把源 HTML 的资源写回 `parsed_sheet`，随后重新编译 HTML。这给 hp/stress 回退提供了可复查路径；需在旧版隔离实例确认触发条件。
- 同文件 `commit()` 约 1355–1375 行：旧掷骰可走 `waitForPersistence: false`，广播发生在保存完成前。该路径只说明存在“已显示但未保存”的可能，尚无线上失败率数据。

## 阶段二：新版回归场景

`apps/realtime/src/__tests__/room-v2-recovery.test.ts` 和 `fronted/src/__tests__/room-v2-sync.test.ts` 的阶段四、五用例现已改为可执行断言。完整卡组件的实际加载与视觉行为仍留待阶段七验证。

| 场景 | 合格条件 | 归属 |
| --- | --- | --- |
| 标记后立即翻页 | 确认数据和待确认操作不随卡片卸载消失 | 客户端同步 |
| 初次 JSON 资源为零，标记后重建 DO | 读取持久化资源，不能从原 JSON 重新初始化 | 服务端恢复 |
| 先 seq 12，再旧快照 11 | 同房间不回退；切换 `roomId` 重置比较 | 客户端同步 |
| 提交成功、ACK 丢失并刷新 | 用原 `requestId` receipt 识别，执行一次 | 服务端恢复和客户端同步 |
| 完整卡请求慢于切页/同名覆盖 | 取消后可重试，旧 generation 响应不能覆盖新卡或卡住 loading | 详情组件 |

## 阶段三：契约夹具

`packages/shared/src/__tests__/fixtures/` 内两份合成 JSON 覆盖两个规则、四资源、六属性、阈值、武器、自定义卡、伙伴与规则扩展页。共享入口为 `@dhgc/shared/desktop`；房间模型、投递校验、摘要映射、协议和纯骰子类型均从该入口取得。夹具不包含用户角色资料。

车卡器仓库 `D:\Dql\Desktop\MyDHcharsheet\tests\fixtures\dhol\` 有同一组 JSON，并用 `prepareForExport()` 的测试核对两个规则的资源与扩展字段。

## 测试入口

阶段七本地候选已由 `main.tsx` 直接装配新版桌面应用；历史 `/preview` 入口记录仅适用于阶段五、六部署。2026-10-10 为用户线上自测制作的 Pages 构建仍设置了 `VITE_ENABLE_PREVIEW=true`，并在 Pages 根中间件对 `/preview` 使用 `PREVIEW_PASSWORD` 口令保护；口令只存在 Cloudflare Secret 和测试者手中，不提交仓库。正式域名是否切换到阶段七候选属于后续发布步骤，本地入口变化不代表已经部署。

2026-10-09 本地浏览器检查：`http://localhost:5173/` 显示“当前项目技术升级中”；`http://localhost:5173/preview` 显示房间创建与加入界面。该检查没有创建房间或访问生产用户数据。

检查结果：共享测试 38/38、实时服务测试 46 项通过（2 项阶段四待实现）、前端测试 13 项通过（6 项阶段五/七待实现）、两仓库 TypeScript 检查通过，dhol 构建通过。变更的前端文件定向 ESLint 通过。仓库全量前端 lint 有 27 条旧组件问题（26 error、1 warning，主要为旧界面 effect 同步 setState）；新版入口文件没有新增 lint 问题。阶段四、五、七的 `todo` 不能算已通过回归。

## 阶段四、五：本地闭环记录（2026-10-09）

新版 Worker 入口现只装配路由并导出两个 DO 类；旧实现暂存 `legacy-room.ts`，新路由、会话、SQLite 存储和命令模块均独立。`ROOMS_V2` 使用新增 SQLite migration；此记录只涉及本地 Wrangler，尚未发布到生产。

本地 Wrangler `4.92.0`，Node `22.14.0`，地址为 `127.0.0.1:8791`。`scripts/room-v2-smoke.mjs` 使用两个真实 WebSocket 和合成角色验证不同生命格并发、恐惧并发、正式骰子一致、同 ID 投递与掷骰去重、50 条骰子历史裁剪后旧 receipt 仍有效、同名替换后旧 generation 拒绝。`scripts/room-v2-client-smoke.mjs` 用实际 `RoomSync` 连接两个客户端，验证保存广播、骰子、刷新恢复，以及刻意丢失 ACK/事件后断线重连用原 requestId 的 receipt 消除待确认操作。两项脚本均通过；这不是浏览器视觉验收。

`scripts/room-v2-restart-check.mjs setup` 在本地写入生命/压力标记后，停止并重启 Wrangler，再执行 `check`：新实例读回原资源、seq 和 receipt。临时测试 token 只放在 `tmp/` 并已由检查脚本删除。相关定向测试：实时服务 8/8、前端同步与 outbox 10/10；完整套件为共享 38/38、实时服务 53/53、前端 22/22。`npm run build` 与新版前端文件定向 ESLint 均通过。持久化失败后的队列继续执行由命令测试注入故障验证；云端故障与正式域名延迟尚未测量。

浏览器检查使用 Playwright CLI 打开本地 Vite `/preview` 并连接本地 Wrangler：创建新版房间后显示“已连接 · 已保存”，点击恐惧 `+` 与 d20 后看到正式状态和骰子记录；投递合成角色后在线出现摘要资源按钮，标记首个生命格、刷新页面，已确认标记仍在。页面控制台无错误或警告。该入口只用于阶段五闭环，不代表阶段七的卡面与适配布局已经验收。

断线复测时主动停止本地 Wrangler：浏览器改为“正在连接”，修改按钮禁用；重启 Wrangler 后同一页面恢复“已连接 · 已保存”。停服期间控制台出现预期的连接拒绝，恢复后没有 `Illegal invocation`。此复测发现并修正了浏览器计时器脱离调用上下文的问题。

## 线上受保护测试入口（2026-10-10）

用户要求在 `screenol.pages.dev` 继续显示升级公告的同时进行线上自测，因此提前部署阶段四、五的最小闭环；这不是阶段九正式上线，也没有删除旧房间存储。Worker `dhol-realtime` 版本 `857c554e-7a9c-4bea-9acc-2d8fc3ae955f` 新增 `ROOMS_V2`，原 `ROOMS` 保留。Pages 项目 `screenol` 的测试部署为 `6ea0a8dd.screenol.pages.dev`，正式域名仍为 `screenol.pages.dev`。生产设置了独立的 `SESSION_SECRET` 和 Pages `PREVIEW_PASSWORD`，只记录密钥名称，不记录值。Worker 仅接受 `https://screenol.pages.dev` 的浏览器 Origin。

公开根路径 HTTP 200、标题仍为“技术升级中｜角色卡在线追踪”；匿名访问 `/preview` 返回 401，正确口令返回 200。测试页未在首页链接，HTML 含 `noindex,nofollow`。测试页直接连接 `dhol-realtime.gooole-dql.workers.dev`，避免浏览器在 Pages 代理 WebSocket 握手时混入 Basic 认证。页面认证仅保护 UI 入口；静态资产和 Worker API 并非私有网络资源，不应以地址不公开代替房间令牌权限。

以合成角色运行 `ROOM_V2_BASE=https://screenol.pages.dev` 的 `room-v2-smoke.mjs`，两条线上 WebSocket、投递、并发标记、骰子、receipt 去重、历史裁剪及同名替换均通过（最终 seq 59、角色 1、骰子历史 50）。Playwright 在受保护入口创建线上合成房间，看到“已连接 · 已保存”；恐惧 +1 和 d20 成功，刷新后重新连接并恢复同一状态。浏览器最终一次加载没有控制台错误。线上合成房间按默认三天过期；未导入用户数据。

## 阶段七：完整桌面应用本地验收（2026-10-10）

本地 Vite `8.0.13` 连接本地 Wrangler `4.92.0`，使用五张合成 Daggerheart 角色卡。Playwright CLI 在 Chromium、1440×900、100% 缩放下检查：首页创建/加入/恢复入口、四卡两列两行布局、第五人本地分页、摘要字段顺序、四资源键盘按钮、独立骰子面板和完整卡弹窗；页面无横向溢出。720×900 下只显示桌面设备提示，不降级成手机房间或单列角色面板。

完整卡按角色 generation 请求原 JSON，显示当前资源、自定义领域卡正文、冒险笔记及可展开的未知结构字段；组件没有输入框或 `contenteditable`，可执行图片协议会被拒绝。测试时发现 React StrictMode 探测挂载会触发原生 dialog 的清理关闭事件，已移除把程序性关闭误当用户关闭的监听，并在同一次会话复验弹窗正常。

新版 JSON 备份经实际本地 API 执行“创建源房间 → 投递角色 → 导出 → `/api/v2/rooms/restore` 恢复”。恢复结果产生不同 `roomId` 和邀请码，房间名、角色数量、希望及已标记生命格保持一致；会话与 outbox 因新 `roomId` 隔离。该流程只使用合成数据。

检查结果：前端 26/26、实时服务 63/63；前端生产构建和实时服务 TypeScript 检查通过，新 `fronted/src/desktop` 与本阶段测试的定向 ESLint 通过。全仓库前端 lint 仍有 29 条旧界面 error 和 4 条 warning 的既有基线；阶段七目录没有新增问题。

## 阶段八：掷骰链路与架构独立性（2026-10-10）

状态为 **DONE_WITH_PERFORMANCE_CONCERNS**：本地实现、故障回归、压力契约、候选构建、传递依赖检查和香港独立环境实测均已完成。独立环境没有占用正式 `screenol` / `dhol-realtime` 的入口或 `ROOMS` namespace，也没有删除旧 Durable Object、namespace 或数据。两端正式结果一致且无失败，但公网 P95 与 70 秒空闲首掷高于阶段目标，因此不能标记为性能达标。

| 阶段八延迟样本 | P50 | P95 | 失败 | 说明 |
| --- | ---: | ---: | ---: | --- |
| 香港稳定网络，50 次普通骰池 | 发起端 356 ms；观察端 357 ms | 两端 1420 ms | 0 | 点击到正式 `dice.rolled`；50/50 roll ID 一致 |
| 香港稳定网络，20 组双客户端操作 | 发起端 402 ms；观察端 404 ms | 两端 1637 ms | 0 | 取同一轮前 20 组；20/20 roll ID 一致 |
| 70 秒空闲后第一掷 | 发起端 1624 ms；观察端 1642 ms | 单次，不计算 P95 | 0 | 只能称空闲唤醒候选，未用平台指标证明实例已休眠 |
| 网络基线 / 应用增加耗时 | 352 ms | 2546 ms | 0 | 同一浏览器 10 次跨域 OPTIONS；基线抖动大，应用 P50 约高 4–5 ms，不能用 P95 相减归因 |

独立 Worker 为 `dhol-room-v2-stage8`，固定地址 `https://dhol-room-v2-stage8.gooole-dql.workers.dev`。源码上传版本为 `e68a5af8-7e02-495c-9645-d6c69718b2bd`，设置独立 `SESSION_SECRET` 后当前部署版本为 `90918640-7697-4073-a5c8-3aaa85f58b80`。它使用单独的 `ROOMS_V2` SQLite Durable Object 绑定，不配置旧 `ROOMS`。独立 Pages 项目为 `dhol-room-v2-stage8-ui`，固定地址 `https://dhol-room-v2-stage8-ui.pages.dev`，部署 `ede14e78-213b-4573-b641-3d398a071afb`。账号成功创建两者，没有遇到项目或 namespace 空位限制。

测量在 2026-10-11 的香港网络、Windows 本机、Chromium / Playwright CLI 下进行。脚本 `scripts/measure-room-v2-stage8-browser.js` 建立两个隔离浏览器 context，CDP 记录 WebSocket 帧，MutationObserver 记录历史 DOM 更新。50 次样本的 DOM P50/P95 为发起端 356/1419 ms、观察端 356/1419 ms，几乎与帧接收同时，未显示浏览器渲染是主要占比，因此没有打开 profiler。两端最大接收差为 295 ms；全部 50 次 roll ID 一致。目标 P50 ≤300 ms、P95 ≤800 ms 未达到，空闲首掷目标 ≤1500 ms 也以约 124–142 ms 超出。P95 只代表本次小样本，网络基线自身存在 2.546 s 离群值。

同一独立 Worker 的 API smoke 得到最终 `seq=59`、角色 1、骰子历史 50；实际 `RoomSync` 双客户端 smoke 也通过保存广播、标记与掷骰。测试只使用合成房间；邀请码、会话令牌和 secret 不写入报告。测试环境暂时保留供阶段九前复验，未切换正式流量。

命令层 fake storage 压力测试同时发起 50 次普通掷骰与 10 次约 200 KiB 合成角色替换，并另将 20 个正式事件分别按结构化克隆和 JSON 往返形成两份消费者视图核对；这两份视图不是两个真实客户端。全部正式 roll ID、结果和 fake 持久化记录一致。普通 `1d20` 事件断言不超过 2 KiB；最大允许骰池按实际 JSON 字节记录并保留每个结果，不截断来迎合体积目标。可控时钟精确断言服务端 `preQueueMs`（入口授权/解析）、`queueMs`、`hashMs`、`computeMs`、`storageMs`（仅事务）、`broadcastMs` 和 `serverTotalMs`；日志不含角色资料、邀请码或会话令牌。排队测量覆盖角色替换造成的串行等待，没有改变已确认的“事务成功后广播”顺序。

独立 workerd 集成套件使用 `@cloudflare/vitest-pool-workers@0.12.21` 在真实 Workers 运行时中建立 SQLite-backed `ROOMS_V2`，通过两条 WebSocket 验证同一正式 roll ID/结果，并直接查询 seq、receipt 与骰子记录。另在 `runInDurableObject` 中让真实 SQLite 事务写入中途抛错，确认 seq 与骰子行一并回滚。该套件是两条真实 workerd WebSocket，但不是浏览器或香港公网延迟测试。仓库仍使用 Vitest 3.2.6，因此选择官方兼容线的最后一个 0.12.x 版本；迁移到要求 Vitest 4 的新版插件留给独立工具链升级，未在本阶段扩大范围。

WebSocket 消息外层用一条 SQL `json_extract` / `json_each` 查询取得 room ID、邀请码、到期时间和指定 player ID 的成员资格，在 JavaScript 中不读取或 `JSON.parse` 完整 `room_json`；命令层再读取 receipt、单行 seq/fear/x-card 和到期时间。热路径不读取角色 source JSON、不生成快照、不恢复 HTML，也不编译界面。会话仍同时验证签名 token 的有效期、room ID、邀请码、成员资格和房间到期时间，没有以优化为由弱化授权。掷骰仍唯一由服务端 `crypto.getRandomValues` 和共享纯函数生成；前端待确认状态只显示“掷骰中…”。正式事件直接更新本机 confirmed store 并清除 outbox，不重新获取全房间；该过程从两次 UI 通知收敛为一次。8 秒 confirmation timer 仅在事件/ACK 缺失时请求同步，不延后正式结果或历史写入，也不是五秒动画窗口。

阶段四、五既有 ACK 丢失、持久化失败、断线重试与快照补洞测试继续复用，没有新增同义故障注入。阶段八新增的失败证据为：后端新测试最初 3/3 因热路径仍调用完整 `meta()` 失败；同步测试最初发现单个正式骰子事件产生 2 次 UI 通知而失败。改为最小到期字段读取和合并通知后均通过。

`scripts/check-desktop-boundaries.mjs` 从 `main.tsx`、`DesktopApp.tsx`、`RoomV2DurableObject` 所在模块、`room-v2-http.ts`、`character-ingest.ts` 和 `@dhgc/shared/desktop` 六个入口出发，调用 TypeScript 模块解析器处理相对路径、`@` 别名、package exports、barrel、字面量动态 import 与 require 后遍历传递依赖。受保护图中的计算型 dynamic import 或 require 会直接失败。到达旧 App/pages/store、旧房间类型、旧实时客户端、HTML 解析、移动角色码、`legacy-room.ts` 或旧共享 `types.ts` / `protocol.ts` / `utils.ts` 也会失败；另检查候选前端不存在旧实现文件。本次正常入口遍历 36 个模块通过。负向夹具通过 barrel、字面量动态 import 连接四个旧后端/共享模块，并以计算型 import 与 require 验证拒绝逻辑；根 `check:desktop-boundaries` 同时运行正向图和负向自测。Worker `index.ts` 暂留的 `RoomDurableObject` 导出和旧 fallback 只服务现有部署生命周期；上述新版入口图均未到达旧类。最终移除旧导出和独立环境部署属于需要明确测试目标的后续清理，不在本阶段越权执行。

候选前端已删除旧 `App`、pages、store、lib、preview、components、types、utils、旧测试、旧静态资源和旧全局样式。依赖只保留 React、React DOM、Zustand 及构建/测试工具；移除 Radix、React Flow、Tailwind、Framer Motion、Lucide、nanoid、clsx、CVA 和平台专用可选包。生产 CSS 从删除前的 83.66 kB 降为 12.96 kB，候选仍可独立构建。

允许复用清单及依据：

- 骰子纯函数与类型：`dice.ts` / `dice-types.ts` 无 UI、存储或旧房间依赖，由 `@dhgc/shared/desktop` 明确导出。
- 通用 JSON 角色摘要、校验和 Room V2 协议：仅依赖共享 JSON 模型与纯校验，不导出 HTML 或旧房间类型。
- 通用 UI 运行时：React、React DOM；状态容器仅使用 `zustand/vanilla`，传递依赖图未到达旧 store。
- 加密工具：运行时原生 Web Crypto（随机数、UUID、SHA-256、会话签名）；不引入旧客户端或第三方加密包。

验证结果：阶段八后端定向 12/12、workerd 集成 2/2、前端定向 8/8；完整套件为实时服务 75/75、前端 16/16、共享 38/38。传递依赖正向检查及 3 项负向/入口/脚本自测通过；前端 lint、生产构建与 Worker TypeScript 检查通过。由于没有公网数据，没有打开浏览器 profiler，也没有声称满足 P50 ≤ 300 ms、P95 ≤ 800 ms 或冷启动 P95 ≤ 1500 ms。

### 阶段八规格复审修正

补充的 TDD 红灯记录：WebSocket 热路径测试最初因调用 `db.meta()` 抛出“complete meta must stay cold”；到达顺序测试因可控 hash 未进入串行队列而得到空的 hash 顺序；边界负向自测最初错误返回正常入口通过，未报告四个旧模块。修正后，hash 在命令调用时立即占据队列位置，再于事务前完成；并发大、小 payload 不会因 SHA-256 完成先后交换提交顺序。可控时钟确认后续命令 `queueMs > 0`，记录器确认每个 seq 均严格执行 `save dice → advance seq → save receipt → publish`，最终骰子、receipt 和 seq 一致。

香港独立环境与真实双浏览器延迟随后已按本节上方记录完成；复审修正本身仍没有改动正式环境，也没有新增延迟达标声明。

### 阶段八代码质量复审修正

本轮红灯首先精确复现三类问题：空值/非法日期未被当作过期，六段可控时钟期望只得到旧的三段指标，边界自测没有发现计算型依赖且无法列出六个生产入口。修正后，WebSocket 入口在反序列化、授权与解析之前记录收到时间；命令串行队列在入队、出队、hash 完成、事务开始、事务提交和广播完成各留一个边界，`storageMs` 不再包含 hash、掷骰或事件构造。`isExpired` 统一把缺失、null、非法日期和已到期时间判为过期，SQLite session access 类型显式反映 JSON 字段可空。

workerd 集成套件与命令层 fake storage 套件分开执行、分开解释；前者提供真实 SQLite、两条 WebSocket 和事务回滚证据，后者保留快速、确定性的时钟、排队和保存后广播顺序断言。其后的香港独立环境部署与浏览器样本如本节上方记录；可靠性通过，但不据此声称公网 P50/P95 目标达标。

## 阶段九：发布候选的旧房间退役（2026-10-11）

本工作树已将运行时房间链路收敛到 `/api/v2/rooms` 和 `ROOMS_V2`。旧 `/api/rooms` 本身、任意子路径及 WebSocket 升级尝试都在 Worker 入口直接返回无状态 HTTP 410 JSON，代码为 `LEGACY_ROOMS_RETIRED`，不查询或创建 Durable Object。其他未知 API 仍返回 404。旧后端实现、socket/session 模块、旧共享房间模型与协议、HTML/重放/绘图/倒计时/移动角色码表面及其专用测试已从候选源码删除；纯骰子规则与 Room V2 桌面公开 API 保留。

`wrangler.toml` 保留原有 `v1` 和 `v2-json-desktop` 迁移，只追加 `v3-retire-legacy-rooms`，其 `deleted_classes=["RoomDurableObject"]`。这意味着将来真正部署该 Worker 迁移时，Cloudflare 会删除旧 Durable Object 类及其存储；本次只制作候选配置，**没有执行部署，也没有在云端执行删除**。

入口边界保持不变：`/` 始终显示“当前项目技术升级中”；只有精确 `/preview` 或 `/preview/` 且处于开发模式或 `VITE_ENABLE_PREVIEW=true` 时才加载 Room V2 桌面。Pages 的 Basic Auth 中间件未放宽。旧 `/room/...` 或 `/rooms/...` 前端地址显示“旧版房间已下线，请创建新房间”，不转移旧会话。一次性浏览器清理只删除明确列出的旧 key/前缀，以持久版本 marker 保证幂等；不调用 `localStorage.clear()`，并保留 `dhol:desktop:v2:*`、preview 状态、角色构建器存档和其他同源数据。

发布候选的最终人工后续是：先在线上受保护的 `/preview` 完成验证；验证通过后，**只移除维护入口 gate**，使 Room V2 应用可从 `/` 访问。不应在该后续中恢复任何旧房间运行时。
