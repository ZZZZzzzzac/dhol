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

旧版 `waitForPersistence: false` 使广播先于保存完成，当前没有把“收到结果”当成“已持久化”的证据。服务器内部排队/存储分段和 Cloudflare Duration 报警归属仍待获取；浏览器端本地样本显示 DOM 更新占比小，但不能证明线上延迟的主要来源。

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
- `apps/realtime/src/index.ts` 约 1431–1437、1505–1532 行：DO 读出旧房间后调用 `hydrateStoredGmSheetHtml()`；当 HTML 需要补载时，用 `applyHtmlResourceTracksToSheet()` 把源 HTML 的资源写回 `parsed_sheet`，随后重新编译 HTML。这给 hp/stress 回退提供了可复查路径；需在旧版隔离实例确认触发条件。
- 同文件 `commit()` 约 1355–1375 行：旧掷骰可走 `waitForPersistence: false`，广播发生在保存完成前。该路径只说明存在“已显示但未保存”的可能，尚无线上失败率数据。

## 阶段二：新版回归场景

`apps/realtime/src/__tests__/room-v2-recovery.test.ts` 和 `fronted/src/__tests__/room-v2-sync.test.ts` 已列出对应 `it.todo`。阶段四、五的存储及同步实现加入后，将这些项目改为可执行断言；阶段七的详情组件加入后验证慢请求与替换。当前不能报告这些回归已通过。

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

本地 Vite 开发服务器的 `/preview` 展示可操作的房间应用，根路径继续展示公告。在 Pages 的专用测试构建中设置构建环境变量 `VITE_ENABLE_PREVIEW=true` 后，`/preview` 同样可进入；正式构建未设置该变量时不会开放此路由。现阶段它连接旧版 UI；阶段五接入新的 `DesktopApp` 时更换 `fronted/src/preview/PreviewApp.tsx`，不要将旧业务模块接入新版应用。该路径只是测试开关，不承担身份认证；要限制测试人员访问，应在 Pages/Cloudflare Access 层配置访问规则。

2026-10-09 本地浏览器检查：`http://localhost:5173/` 显示“当前项目技术升级中”；`http://localhost:5173/preview` 显示房间创建与加入界面。该检查没有创建房间或访问生产用户数据。

检查结果：共享测试 38/38、实时服务测试 46 项通过（2 项阶段四待实现）、前端测试 13 项通过（6 项阶段五/七待实现）、两仓库 TypeScript 检查通过，dhol 构建通过。变更的前端文件定向 ESLint 通过。仓库全量前端 lint 有 27 条旧组件问题（26 error、1 warning，主要为旧界面 effect 同步 setState）；新版入口文件没有新增 lint 问题。阶段四、五、七的 `todo` 不能算已通过回归。
