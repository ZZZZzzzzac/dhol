# 在线桌面面板整体重构 Implementation Plan

> **执行方式：** 按阶段顺序推进，用复选框跟踪；每个阶段可由同一开发者连续完成，不要求拆成代理任务。
>
> 本文件是执行计划。本次只编写计划，不实施业务变更。实际执行默认逐项推进；不要仅因上面的建议自行启动并行代理。跨仓库改动分别检查工作区和提交。

**Goal:** 解决资源标记偶尔消失和掷骰结果同步延迟高的问题，同时将在线面板改为车卡器 JSON 投递、同名全量覆盖、四角色摘要卡与完整只读卡面；新版上线验证成功后彻底删除旧电脑版和旧手机版房间，只保留新的电脑版。

**Architecture:** 新电脑版使用独立的 RoomV2DurableObject 类、ROOMS_V2 绑定和 SQLite 命名空间，仍为一个房间一个 DO，以服务端持久化状态为最终依据，采用可休眠 WebSocket 和按变化推送。角色资料与高频资源分开存储，资源修改使用小型操作、持久化去重和版本控制；车卡器按名字投递时原子替换整张角色卡。新版验证可用后删除原 RoomDurableObject 类及全部旧房间存储，前后端只保留新版协议和 JSON 原生卡面。

**Tech Stack:** TypeScript、React、Zustand、Cloudflare Workers、SQLite-backed Durable Objects、Vitest；车卡器使用既有 Next.js/React 项目与 pnpm。浏览器联调使用执行环境已有的浏览器自动化能力。

**Revision:** 2026-10-09 按完整重构标准审查。交付对象是独立的新桌面应用、领域模型、通信协议和持久化实现；旧系统只提供业务规则及故障案例参考。

---

## 重构标准与复用边界

新版在现有仓库与部署项目中建设，但业务运行链路独立。前端从新的桌面应用入口启动，后端从新的路由/会话模块进入新 DO；不向旧 AppStore 添加 slice，不继承旧 RoomState，不复用旧房间恢复流程，也不把旧组件换个 store 后直接视为完成。

| 范围 | 本轮做法 | 完成证据 |
| --- | --- | --- |
| 角色与房间模型 | 重新定义唯一的桌面模型，去掉 gm_panel/mobile_panel、host 权限及废弃功能字段 | 新模型不引用旧 types.ts 中的房间类型 |
| 状态与同步 | 新建独立 store、同步状态机、outbox 和连接客户端 | 删除旧 store/lib 后新版构建、交互仍通过 |
| DO 与持久化 | 独立类/namespace、按实体存储、事务与持久化去重 | 新 DO 不读取旧 room KV、不加载 HTML、不依赖旧类 |
| 桌面界面 | 新入口、新房间大厅、新四卡面板、新骰子/恐惧/X 卡组件 | 不依赖旧页面、旧 UI slice 和旧全局业务样式 |
| 骰子规则 | 保留经过测试的纯算法，抽离骰子专用类型 | 算法无旧房间/store/DOM 依赖，规则测试继续通过 |
| 车卡器 | 保留车卡业务，新增独立投递适配层；完整卡只参考其展示格式 | 不导入车卡器编辑 store，不改动 zoot 投递行为 |
| 通用基础 | 可复用无业务依赖的按钮、弹窗、图标、工具链和纯函数 | 每项复用均能说明输入输出和依赖，没有旧状态副作用 |
| 旧系统 | 在切换期间只作为隔离的发布过渡存在，上线后删除数据与代码 | 旧类删除成功，新版生产 bundle 不含旧业务模块 |

不要求重写已经正确的随机数算法或更换 React/Cloudflare；重点是移除造成多份状态、整房间写入和 DOM 同步的旧结构。旧代码的测试不能作为保留旧运行时的理由；保留业务断言，换成新版模型与测试夹具。

## 目标运行链路与不变量

唯一写入链路：桌面 UI → 新同步客户端/outbox → 新协议校验 → DO 命令事务 → 已确认事件/ACK → 新状态模型 → 组件选择性渲染。

- 服务端存储是已确认状态的唯一依据；客户端只维护它的镜像及独立的未确认操作，不另存可互相覆盖的“卡面状态”。
- 车卡器原 JSON 保存资料，资源表保存当前四资源；摘要及完整卡由同一个适配器组合得出。完整卡只读，不能有反向回写路径。
- 翻页、窗口开关、滚动、骰子动画都不提交业务状态，也不承担保存职责。
- 同名投递是整卡原子替换；普通操作只改必要字段。两种操作共享同一事务顺序与 generation 规则。
- receipt、实体修改及 seq 在同一事务内提交；正式骰子结果也遵守此规则。缓存故障不能使已确认数据丢失。
- roomId 标识房间实例；seq 只比较同一实例。备份恢复创建新 roomId，旧 outbox 永远不能跨实例执行。
- 客户端连接状态显式区分 disconnected、connecting、synchronizing、ready、reconnecting、expired。WebSocket 打开不等于可以修改，只有 ready 才允许新命令。
- 缺事件时申请当前快照；首版不建设永久事件溯源系统、分布式锁、CRDT 或全量事件回放服务。多客户端收敛由房间 DO 顺序提交、当前快照和 receipt 完成。
- 新版除到期 alarm 和必要业务请求外不主动周期性唤醒 DO；服务端不设置持续运行的同步 timer。

**实现取舍：** 只在 HTTP/WebSocket 输入边界做完整运行时校验，内部模块依赖已校验的类型与不变量；数据库事务保障原子性，客户端处理确实会发生的断线、重复和乱序。不要为每层都加相同校验、为理论上不可能的状态叠加回退分支，或为首版预建通用事件回放框架。新增保护逻辑应能对应本计划中的具体故障、产品约定或外部输入风险。

## 执行依赖与发布门槛

先完成阶段一至三的基线、场景和新契约，再完成阶段四至五的服务器/客户端最小闭环。在复杂卡面与车卡器接入前，用两客户端和合成角色验证“标记 → 保存 → 广播 → 刷新恢复”和“掷骰 → 正式结果 → 断线重试去重”。这两个闭环未通过，不进入完整 UI 建设。开发时优先运行改动涉及的测试；跨模块闭环、发布候选和正式上线各做一次对应的集成验证，避免每完成一个文件就重跑全套测试或重新打开浏览器。

阶段六至七完成投递与卡面，阶段八进行代表性负载下的性能验收。进入生产发布前必须完成阶段十的发布前检查，并删除候选前端中的旧业务依赖；不能将彻底解耦推迟到上线后。阶段九只负责已准备好的构建发布、正式域名冒烟及旧数据删除，清理构建也须提前准备和验证。

阶段十最后的正式环境冒烟、删除后隔离验证和七天用量观察按发布顺序执行。持续观察不阻止同一次发布流程中的旧房间清理。

## 已确定的产品约定

1. 新面板的核心功能只有角色卡、房间恐惧点、掷骰、X 卡，以及必要的加入、重连、导出备份与恢复。
2. 只开发和保留新的电脑版：每页四张摘要卡，按 2×2 排列；超过四人继续分页。取消旧手机版、旧电脑版及原计划中的手机单列专用布局；窄屏只提供使用桌面设备的提示，不切换到另一套房间或自动创建手机房间。
3. 摘要卡可修改希望、压力、生命、护甲槽。闪避、护甲值、伤害阈值、武器伤害骰、六项属性等只读。领域卡能力全文放在完整卡面。
4. 每张摘要卡有“查看完整信息”按钮。完整卡参考车卡器原版页面结构、配色与排版，包含该规则和角色适用的扩展页；完全只读。摘要卡资源变化同时反映在完整卡。
5. 同一房间内，角色名字去掉首尾空格后作为身份。内部可以有数据库 ID，但不能改成按车卡器 UUID 匹配。大小写与 Unicode 字符不额外合并；角色名为空拒绝，最长 80 个字符。
6. 同名投递覆盖全部角色资料及当前希望、压力、生命、护甲状态；不沿用旧角色中缺失的新字段。不同名字新增；改名投递后原名字角色仍保留。原有位置在同名覆盖时保持不变。
7. 覆盖只影响指定角色，不影响其他角色、房间恐惧点、骰子记录和 X 卡。
8. 全体房间成员具有相同操作权限。继续使用房间会话，不增加角色认领、GM 审批或角色所有权体系。
9. 数据有变化才提交与推送；不设置每五秒全量拉取或 DO 常驻广播定时器。掷骰和 X 卡立即发送。
10. 车卡器提供明确的“发送到在线面板”动作，不做每次输入都自动投递。投递旁说明“同名角色将全部覆盖，包括当前资源标记”。
11. 新版正式上线并通过线上冒烟测试后，在同次发布流程中彻底清除旧 `gm-panel` 与 `mobile-panel` 房间：删除服务端数据、旧会话访问能力、旧协议、旧界面与关联功能代码。没有长期兼容期，不迁移旧房间，不支持旧 HTML/角色码/旧房间备份恢复。
12. 新房间从空状态创建，角色从车卡器重新发送。只保留新版 JSON 房间备份和恢复。清理范围是 dhol 管理的旧房间数据及缓存，不删除车卡器的角色存档、zoot 数据或用户自行下载的文件。

## 切换与清理边界

用户已明确要求新版上线后清除两种旧房间；这是实施阶段既定范围，不再以兼容旧房间为目标。本次仍只更新计划，尚未删除任何线上房间。

顺序固定为：新版独立存储准备 → 测试环境完整验收 → 新电脑版正式上线 → 新版线上创建、投递、标记、掷骰、重连冒烟验证 → 永久删除旧存储并移除旧实现 → 验证新版数据不受影响 → 持续观察用量。旧数据删除不等待七天用量观察结束。

使用独立类与命名空间是为了让旧存储能一次性彻底删除，避免逐个已知邀请码清理遗漏休眠房间。旧类删除不可通过回滚代码恢复；清理后所有修复与回滚只面向新版，不重新开放旧电脑版或旧手机版。

## 当前代码证据与边界

| 现象或风险 | 本地代码证据 | 本轮处理 |
| --- | --- | --- |
| 切页后角色卡持续加载 | `GmPanelBoard.tsx` 加载 effect 的旧回调被 disposed 丢弃，但 loading 标记保留；返回后跳过请求 | 固定失败场景，在新版验证翻页只改变可见角色，不新增旧 HTML 维护任务 |
| 唤醒后生命、压力回退 | `hydrateStoredGmSheetHtml()` 调用 `applyHtmlResourceTracksToSheet()`，后者从原始 HTML 重写 hp/stress | 新版只从已存 JSON 资源恢复；删除旧 HTML 恢复路径，不做旧房间迁移 |
| 重发或多人操作可能重复/丢失 | 现协议大多提交 nextValue，requestId 有 ACK 但未形成持久化业务去重 | 改成明确操作、串行提交、持久化 receipt、版本检查 |
| 旧快照可能覆盖较新状态 | `room.updated` 直接 applyRoomState，增量消息另有版本检查 | 快照与增量统一版本规则；缺口在原连接补同步 |
| 掷骰可能受重型房间处理影响 | 掷骰已经增量广播，但仍克隆房间、保存整个快照；DO 冷加载还恢复 HTML | 用测量确认占比；新路径只加载/保存所需状态 |
| 掷骰已展示但保存失败 | 当前 dice 分支 `waitForPersistence: false`，后台保存失败被记录后吞掉 | 正式结果在事务成功后确认；不能以丢失恢复能力换表面速度 |
| DO Duration 超额 | 用户已确认是 GB-s；本地已使用 acceptWebSocket | 核实生产部署及空闲条件，不重复把“改为 WebSocket”当新优化 |

以上是静态代码路径证据，不等于已经在线重现全部故障，也没有证明掷骰延迟的主要来源。实施前记录部署版本与测试基线。

## 目录与文件职责

下面 dhol 路径均位于 `D:\Dql\Desktop\dhol`，车卡器路径均位于 `D:\Dql\Desktop\MyDHcharsheet`。执行时使用各自工作目录。

| 仓库 | 新建或修改 | 职责 |
| --- | --- | --- |
| dhol | 新建 `packages/shared/src/desktop.ts`、`packages/shared/src/room-v2-model.ts`、`packages/shared/src/room-v2-validation.ts`，修改 package.json exports | 新版公开入口 `@dhgc/shared/desktop`，独立模型和运行时校验；不从旧 barrel 导入房间模型 |
| dhol | 新建 `packages/shared/src/dice-types.ts`，调整 `dice.ts` 的类型导入 | 复用纯骰子算法，切断对旧 types.ts 的依赖 |
| dhol | 新建 `packages/shared/src/character-panel.ts` | 投递 JSON 契约、名字规则、资源模型和标准摘要映射 |
| dhol | 新建 `packages/shared/src/room-v2-protocol.ts` | 操作、事件、ACK、版本、完整快照类型 |
| dhol | 新建 `apps/realtime/src/room-v2.ts`、`room-v2-http.ts`、`room-v2-session.ts`，修改 `index.ts` 入口 | DO、HTTP 路由和会话独立实现；最终 index.ts 只做入口装配与导出 |
| dhol | 修改 `apps/realtime/wrangler.toml` | 先新增新版类/绑定，再单独发布旧类删除 migration，保留迁移历史 |
| dhol | 新建 `apps/realtime/src/room-v2-storage.ts` | SQL 表、事务、去重结果、快照读取、房间删除 |
| dhol | 新建 `apps/realtime/src/room-v2-commands.ts` | 资源、恐惧、掷骰、X 卡、角色替换的事务处理 |
| dhol | 新建 `apps/realtime/src/character-ingest.ts` | JSON 请求限制、校验、投递结果和错误响应 |
| dhol | 新建 `fronted/src/desktop/sync/room-client.ts`、`room-outbox.ts` | 独立连接状态机、确认重试与持久化待确认操作 |
| dhol | 新建 `fronted/src/desktop/state/room-store.ts`、`room-sync.ts`、`ui-store.ts` | 确认数据、同步归并和本地界面状态独立负责；不接入旧 AppStore |
| dhol | 新建 `fronted/src/desktop/DesktopApp.tsx`、`DesktopLanding.tsx`、`DesktopRoom.tsx`、`desktop.css`，修改 `main.tsx` | 新桌面应用入口和导航；不依赖旧 App.tsx/pages/index.css 中的业务结构 |
| dhol | 新建 `fronted/src/desktop/components/character-panel/CharacterPanelBoard.tsx` | 四卡分页和选中角色 |
| dhol | 新建同目录 `CharacterSummaryCard.tsx`、`ResourceTrack.tsx`、`CharacterDetailDialog.tsx`、`ReadOnlyCharacterSheet.tsx`、`character-panel.css` | 摘要、资源交互、只读卡面与桌面样式 |
| dhol | 新建 `fronted/src/desktop/components/DicePanel.tsx`、`FearTracker.tsx`、`XCard.tsx`、`RoomToolbar.tsx`、`BackupDialog.tsx` | 重建核心交互，只订阅新模型；只可提取旧组件中无状态的展示函数 |
| dhol | 新建 `fronted/src/desktop/legacy-cleanup.ts` | 按旧缓存键清除历史会话，不导入旧 store 或恢复数据 |
| dhol | 新建 `scripts/check-desktop-boundaries.mjs` 和 package.json 检查命令 | 验证新客户端/服务器的传递依赖没有旧模块 |
| dhol | 新建 `docs/qa/room-v2-validation.md` | 实测版本、操作步骤、数据与延迟报告 |
| dhol | 新建 `apps/realtime/src/__tests__/legacy-room-retirement.test.ts`、`fronted/src/__tests__/legacy-session-cleanup.test.ts`、`room-v2-client.test.ts`、`room-v2-dice-ui.test.tsx` | 退役隔离、新连接及新骰子 UI 回归 |
| 车卡器 | 新建 `lib/dhol-client.ts`、`components/modals/dhol-export-modal.tsx` | 独立投递入口；不改变 zoot 功能 |
| 车卡器 | 修改 `app/page.tsx`、`components/layout/bottom-dock.tsx` | 接入发送到新电脑版的按钮；不改变车卡器自身的设备支持 |

只读卡面参考源文件为车卡器的 `components/character-sheet.tsx`、`character-sheet-page-two.tsx`、`character-sheet-page-ranger-companion.tsx`、`character-sheet-page-iknis.tsx`、`character-sheet-page-rhodes-relationships.tsx`、`character-sheet-page-adventure-notes.tsx`、`character-sheet-page-card-print.tsx` 及 `components/layout/character-sheet-pages.ts`。这些组件依赖车卡器状态，不能直接跨仓库 import 后假定它们只读；在 dhol 抽取展示结构并以 props 驱动。

## 统一数据与同步契约

投递接口继续使用六位房间码，不能复制 zoot 的八位校验。新版统一使用 `/api/v2/rooms` API 和 `/rooms/v2/:inviteCode` 页面路径；创建、加入、WebSocket、角色读取、导出及管理接口均走新版命名空间，不回退查询旧 namespace。版本化路径和会话 audience 防止旧链接或旧 token 因邀请码碰巧相同而进入新房间。

```http
POST /api/v2/rooms/ABC123/characters
Content-Type: application/json
Idempotency-Key: <本次发送生成的随机ID，网络重试沿用>

{
  "schemaVersion": 1,
  "sheet": {
    "ruleSetId": "daggerheart",
    "name": "阿岚",
    "hope": 3,
    "hp": [false, false, false, false, false, false],
    "stress": [true, false, false, false, false, false],
    "armorBoxes": [false, false, false],
    "cards": []
  }
}
```

示例只列关键字段，实际发送规则模块 `prepareForExport(sheetData)` 返回的完整 SheetData。规则支持 `daggerheart`、`rhodes-island`，不抛弃自定义卡、扩展页和尚未识别的字段。摘要字段来自统一适配器，缺失只读数值显示“—”，不编造 0。

核心契约如下；骰子请求和结果字段可以保持原语义，但先提取到独立 `dice-types.ts`，不能导入旧房间 types.ts 形成隐性依赖。新 RoomModel 仅包含房间身份/有效期、平等成员、角色摘要/资源、恐惧、骰子、X 卡和 seq；不出现 gm_panel、mobile_panel、drawing_board、countdowns、host_player_id 或旧审批配置。

```ts
type TrackResource = 'hp' | 'stress' | 'armor';
type CharacterResources = {
  hope: number;
  hopeMax: number;
  hp: boolean[];
  stress: boolean[];
  armor: boolean[];
};
type CharacterIdentity = {
  name: string;
  generation: number; // 仅在整卡替换时增加，普通资源修改不增加
};
type MutationEnvelope = {
  requestId: string;
  protocolVersion: 2;
};
type ResourceCommand = MutationEnvelope & CharacterIdentity & (
  | { type: 'character.adjustHope'; delta: 1 | -1 }
  | { type: 'character.setMark'; resource: TrackResource; index: number; marked: boolean }
);
type FearCommand = MutationEnvelope & {
  type: 'room.adjustFear';
  delta: 1 | -1;
};
type MutationAck = {
  type: 'operation.ack';
  requestId: string;
  seq: number;
};
type SyncRequest = {
  type: 'room.sync';
  protocolVersion: 2;
  afterSeq: number;
  pendingRequestIds: string[]; // 服务端只查询当前已验证会话的 receipt
};
type MutationError = {
  type: 'operation.error';
  requestId: string;
  code: 'INVALID_COMMAND' | 'CHARACTER_REPLACED' | 'REQUEST_ID_REUSED'
    | 'PERSISTENCE_FAILED' | 'ROOM_EXPIRED';
  message: string;
};
```

轨道发送“第几个格子设为什么值”，不发送整条旧数组；多人改不同格子应同时保留。同一格子相反操作按服务端提交顺序决定。希望/恐惧按钮发送增减量。世代 generation 防止同名覆盖后，旧卡未确认操作污染新卡。

希望始终限制在 0 至 hopeMax，恐惧沿用当前房间上限；格子索引必须在轨道长度内。到达上下限的增减及重复设置同值属于无状态变化操作：仍保存 receipt 并返回当前 seq，但不增加 seq、不广播资源事件。新的角色 generation 使用该次投递提交后的房间 seq，因此删除后重建同名角色也不会复用旧 generation。

事件统一具有 `seq`、`requestId` 和 `type`，包括 `character.replaced`、`character.resourcesChanged`、`character.deleted`、`room.fearChanged`、`dice.rolled`、`dice.historyCleared`、`xcard.changed`。角色资源事件带名字、generation 和四项当前资源，不携带整卡 JSON。角色替换事件带名字与 generation，客户端获取对应版本资料；获取完成前显示更新中，旧版本响应不得覆盖新版本。

快照带最新 `seq` 和所有摘要/资源/骰子/X 卡状态；完整角色 JSON 按需获取并按 `(name, generation)` 缓存。握手返回 `protocolVersion: 2`，新会话签入并校验 `aud: 'dhol-room-v2'`。旧协议请求不能操作新版；旧入口只返回退役说明或不存在，不提供读取、迁移、重建旧房间的能力。

## 阶段一 固定故障和延迟基线

**目标：** 把两项问题变成可重复的验收场景，后续优化与基线在相同环境比较。

**文件：** 新建 `docs/qa/room-v2-validation.md`、`apps/realtime/src/room-v2-metrics.ts`；新版客户端测量接入 `fronted/src/desktop/sync/room-client.ts`。旧系统只在隔离测试环境临时记录基线，临时埋点不进入新版依赖链，也不作为单独的旧版修补发布。

- [ ] 记录本地 commit、前后端实际部署版本、测试地区、网络、浏览器、房间大小和是否后台标签页。生产版本与本地不同必须分开记载。
- [ ] 导出用于复现的测试房间备份；现有用户房间不做压力测试，不在报告中写入会话 token、邀请码或完整角色内容。
- [ ] 以四角色普通骰池为基线，记录请求接收、存储提交、广播、浏览器收到和界面更新的耗时；八角色或打开完整卡只在用户场景涉及或初测出现明显差异时补测。
- [ ] 每次掷骰使用 requestId 关联日志。服务器只用本机单调时钟算服务器各段时间，客户端只用自己的时钟算收到至绘制时间；不能直接相减两台机器的 Date.now。
- [ ] 用一次双客户端浏览器会话采集约 30 次结果，报告 P50/P95、最大值和失败数；样本较少时将 P95 标为方向性参考。真实玩家环境补记各自本地往返延迟，不冒充已测跨设备单向延迟。
- [ ] 用可重复的旧版复现或代码证据记录两个故障：切页后的 HTML 加载状态，以及 DO 重建后的 hp/stress 恢复；不为旧版单独搭建长期测试环境。
- [ ] 核对 Cloudflare 当前报警所属 Worker/namespace，记录 Duration、连接类型、入站消息与重连情况。不要将旧计划中的历史用量当成本次基线。

**记录格式：** 每条记录至少包含场景、部署 commit、requestId、服务器处理毫秒、服务器存储毫秒、发起端显示毫秒、观察端显示毫秒、是否重连、是否失败；报告只保存汇总和脱敏样本。

**验收：** 能初步判断延迟主要落在网络、排队、存储还是渲染；两个数据故障有可复查的触发条件或代码证据。若实际无法重现，不宣称根因已在线验证。

## 阶段二 将数据消失场景转为新版回归约束

**文件：** 新建 `fronted/src/__tests__/room-v2-sync.test.ts`、`apps/realtime/src/__tests__/room-v2-recovery.test.ts` 的测试夹具与场景；在阶段四、五实现后补齐断言并运行。旧文件仅用于复现与行为对照，最终随旧功能清除，不安排单独维护旧版页面。

- [ ] 固定“标记后立即切到另一页再返回”的交互场景，要求页切换只改变可见角色，数据与待确认队列不属于卡片组件生命周期。
- [ ] 固定“JSON 初次投递时 hp/stress 为 0，房间标记后重建 DO”的恢复场景，要求读到保存后的资源，不用最初投递 JSON 重新初始化。
- [ ] 固定“先收到 seq 12，再收到旧完整状态 11”的乱序场景，要求资源与骰子不回退。切换房间时单独重置版本，不跨房间比较。
- [ ] 固定“保存已成功但 ACK 丢失，刷新后恢复”的场景，要求原操作被识别而不丢失或执行第二次。
- [ ] 固定“完整资料请求慢于切页或同名覆盖”的场景，要求返回页面可重试，旧版本响应不能覆盖新资料或锁死 loading。
- [ ] 将每个场景放在最接近故障发生处的一项新版测试中，阶段四、五、七完成相应实现时再运行；最终验收不重复造同义测试。新增实现完成前不报告回归通过，也不为通过测试保留生产旧 HTML 路径。

**后续阶段完成后的运行：**

```powershell
Set-Location D:\Dql\Desktop\dhol
npm --workspace apps/realtime test -- src/__tests__/room-v2-recovery.test.ts
npm --workspace fronted test -- src/__tests__/room-v2-sync.test.ts src/__tests__/character-panel.test.tsx
npm run realtime:typecheck
```

**预期：** 每个故障场景由新版测试覆盖。UI 用例若需要 DOM 测试依赖，仅为 fronted 增加 `@testing-library/react`、`@testing-library/user-event`、`jsdom`，更新其 lockfile，不替换现有测试工具链。

## 阶段三 定义 JSON 模型和同名全量覆盖

**文件：** 新建 `packages/shared/src/desktop.ts`、`room-v2-model.ts`、`room-v2-validation.ts`、`character-panel.ts`、`room-v2-protocol.ts`、`dice-types.ts`、`__tests__/character-panel.test.ts`、`__tests__/room-v2-protocol.test.ts`；修改 package.json exports 和纯骰子模块的类型导入。旧 types/protocol 不追加新版分支。

- [ ] 建立两个规则的最小完整夹具，包含四种资源、六属性、阈值、武器、自定义领域卡、伙伴/特殊角色页和空可选字段。使用合成资料，不纳入用户角色隐私。
- [ ] 名字匹配严格采用下面函数；房间 ID 是数据库组合唯一键的一部分，不允许跨房间覆盖。

```ts
export function characterNameKey(name: string): string {
  const key = name.trim();
  if (!key || [...key].length > 80) throw new Error('INVALID_CHARACTER_NAME');
  return key;
}
```

- [ ] 固定名字行为的测试。

```ts
import { describe, expect, it } from 'vitest';
import { characterNameKey } from '../character-panel';

describe('character identity', () => {
  it('trims only the edges', () => {
    expect(characterNameKey(' 阿岚 ')).toBe('阿岚');
    expect(characterNameKey('A B')).toBe('A B');
  });
  it('does not merge different case or different names', () => {
    expect(characterNameKey('Aran')).not.toBe(characterNameKey('aran'));
  });
  it('rejects an empty name', () => {
    expect(() => characterNameKey('   ')).toThrow('INVALID_CHARACTER_NAME');
  });
});
```

- [ ] 适配器映射 `hope/hopeMax`、`hp`、`stress`、`armorBoxes`，保留布尔轨道逐格语义。摘要从原字段派生；不在车卡器、服务器和前端各写一份属性计算规则。
- [ ] 完整原 JSON 保存未知字段；新投递完全替换原 JSON，再从新 JSON 初始化资源，禁止 `{...oldSheet, ...newSheet}` 造成旧可选字段残留。
- [ ] 固定覆盖测试：同名卡希望从 5 覆盖为 1、压力归零、新 JSON 删除的武器消失、角色数不增加、位置不变化；不同名字新增。
- [ ] 定义完整 JSON 上限 512 KiB、请求总上限 544 KiB，以及轨道长度/数值的规则校验。超限明确拒绝，不静默截断领域卡、扩展页或资源。图片超限由车卡器在用户可见提示下压缩后重发。
- [ ] 在服务端入口校验协议版本、规则、名字、资源范围和 JSON 结构；每类无效输入保留一项代表性测试，不在各层重复写同一套防御性校验。服务端不可只依赖 TypeScript 类型断言。

```powershell
npm --workspace packages/shared test -- src/__tests__/character-panel.test.ts src/__tests__/room-v2-protocol.test.ts
```

**验收：** 输入输出模型在两个项目中有同一套 JSON 合同夹具；按名字覆盖和四种资源含义没有分歧。

## 阶段四 实现可靠且轻量的 DO 提交路径

**文件：** 新建 `apps/realtime/src/room-v2.ts`、`room-v2-storage.ts`、`room-v2-commands.ts`、`__tests__/room-v2-commands.test.ts`、`__tests__/room-v2-recovery.test.ts`；修改 `apps/realtime/wrangler.toml`、DO 入口、会话与房间过期清理。

- [x] 新建路由与会话模块，RoomV2DurableObject 不从旧 index.ts 导入实现。最终 Worker 入口只做路由装配与类导出；业务实现不得再次堆回一个巨大 index.ts。
- [x] 新版独立实现同邀请码的创建冲突检测、有效期、加入、会话 audience 校验、房间人数限制和公共错误映射。只复用经过审查的纯校验/加密函数，不通过调用旧 create/join/load 方法完成新业务。

- [x] 新增 `RoomV2DurableObject` 和 `ROOMS_V2` 绑定，使用全新的 SQLite namespace。保留已应用的 v1 migration 历史；先追加创建新版类的 migration，阶段九再追加删除旧类的 migration。不要把新类写成旧类 alias 或 rename，否则新旧数据仍是同一存储。
- [x] 在新类中实现房间创建、加入、身份校验、连接、导出和到期删除，不依赖旧 `room` KV 键、旧类或其恢复方法。初始化用一次 `blockConcurrencyWhile` 建表与读取新版房间元信息，不把每条消息都包进它。
- [x] 新房间元信息独立存储：room_id、room_name、invite_code、created_at、expires_at、players 以及协议版本均从新版 namespace 读取。客户端会话、缓存与 outbox 使用新版前缀及 room_id 隔离。
- [x] 按以下存储边界建表。一个 DO 内只有一个房间，SQL 不需要额外跨房间共享。

```sql
CREATE TABLE IF NOT EXISTS panel_v2_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  room_json TEXT NOT NULL,
  seq INTEGER NOT NULL,
  fear INTEGER NOT NULL,
  xcard_json TEXT
);
CREATE TABLE IF NOT EXISTS panel_v2_characters (
  name TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  position INTEGER NOT NULL,
  source_json TEXT NOT NULL,
  summary_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS panel_v2_resources (
  name TEXT PRIMARY KEY,
  resources_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS panel_v2_dice (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  record_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS panel_v2_receipts (
  actor TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  seq INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (actor, request_id)
);
```

- [x] 每个命令流程固定为：解析/鉴权/计算规范载荷摘要 → 进入串行命令队列 → 查 receipt → 校验角色 generation → 计算新状态 → 一个短 SQL 事务写状态、seq、receipt → 事务成功后更新缓存并按 seq 广播 → 返回 ACK。
- [x] 队列只对当前有实际命令时工作，无常驻计时器；错误不能断掉后续队列。事务内不做 fetch、图像处理或其他网络调用。
- [x] 同一 `(actor, requestId)` 和相同 payload 返回原结果，不重复扣资源、掷骰或广播；同 ID 不同载荷返回 REQUEST_ID_REUSED。receipt 保留至房间删除，不能因为骰子历史只保留 50 条就一起清除去重记录。
- [x] 单次资源操作只读写对应资源、元信息和 receipt；掷骰只写骰子记录、元信息和 receipt，不加载角色原 JSON、HTML、图片，不保存整房间对象。
- [x] 数据库写入失败返回 PERSISTENCE_FAILED，不推进内存 seq，不广播已成功结果。不再使用整房间旧副本回滚，避免一次失败覆盖后续成功操作。
- [x] 卡片全量替换与资源修改走同一提交序列；替换将 generation 设为该次提交后的新房间 seq。删除后重建同名卡仍使用新的 seq，不能从 1 重新开始。旧 generation 操作返回 CHARACTER_REPLACED，客户端取消该旧卡待确认状态后同步新卡。
- [x] 首次连接/补同步读取摘要与资源快照。新的完整卡读取端点按名字 URL 编码和 generation 获取资料；已被替换的版本返回版本不匹配和最新 generation。
- [x] v2 ACK 必须在持久化成功后给出。SQLite 和 WebSocket 输出门的实际行为使用 Workers 本地运行环境验证，不用假存储测试证明云端持久性。
- [x] 在新类实现过期清理，取消 alarm、关闭连接并用 `storage.deleteAll()` 清除新版房间全部存储；验证删除 v2 SQL 与 receipt。此单房间到期清理与阶段九删除整个旧 namespace 是两项不同操作。导出备份不包含会话 token、去重缓存或本地待确认操作。

**必测矩阵：**

| 输入 | 应有结果 |
| --- | --- |
| 两人同时标记 hp 第 1/第 2 格 | 两格都保存 |
| 恐惧 3，两人分别 +1 | 最终 5 |
| 同一格相反操作 | 按服务端提交顺序收敛 |
| 同操作重发 3 次 | 只执行一次，返回同一 seq/结果 |
| 骰子已提交但 ACK 丢失，重建 DO 后重发 | 返回原掷骰，不生成新随机数 |
| 保存失败后接着成功操作 | 失败不污染成功状态 |
| 全量覆盖后旧卡重试 | 明确拒绝，不改新卡 |
| 删除角色再新增同名角色后旧卡重试 | 新 generation 不复用，旧操作拒绝 |
| 旧骰子记录被 50 条上限移除后重试旧操作 | 不重复掷骰 |

```powershell
npm --workspace apps/realtime test -- src/__tests__/room-v2-commands.test.ts src/__tests__/room-v2-recovery.test.ts
npm run realtime:typecheck
```

**验收：** 标记、掷骰、覆盖均有持久化确认；正常操作不读写完整角色资料；模拟新 DO 实例恢复后的数据与成功 ACK 对应。

## 阶段五 重建客户端状态与同步闭环

**文件：** 新建 `fronted/src/desktop/sync/room-client.ts`、`room-outbox.ts`、`desktop/state/room-store.ts`、`room-sync.ts`、`ui-store.ts`；新建 `fronted/src/__tests__/room-v2-sync.test.ts`、`room-outbox.test.ts`、`room-v2-client.test.ts`。不向原 `useStore.ts`、`uiSlice.ts`、`storeTypes.ts` 增加新版代码。

- [x] room-store 只保存已确认的新 RoomModel；ui-store 只保存本地页码、弹窗、选中对象和提示。room-sync 协调 outbox、事件顺序与可见投影；room-client 只负责连接生命周期、收发和超时，不直接操作 React 组件。
- [x] 为上述模块提供独立构造/销毁方法，在测试中注入 socket、存储和时钟。连接不使用旧模块级全局 activeConnection；切换房间会销毁上一个实例，延迟回调必须核对 roomId 和实例标识。
- [x] 状态拆成服务端已确认状态、待确认操作和只在本机的 UI 状态。当前页、详情窗口、滚动位置不广播、不存 DO。
- [x] 操作先写本地 outbox，再显示乐观资源标记并发出。outbox 以房间与会话身份隔离，页面刷新后仍能找回 requestId；浏览器存储失败必须显示错误，不能假装已进入可靠队列。
- [x] UI 显示“保存中 / 已保存 / 保存失败”；成功广播可按 requestId 确认已应用操作。ACK 先到时只记录操作已持久化与 ack.seq，必须等对应事件已应用或快照 seq 至少达到 ack.seq 后，才同时移除 outbox 与乐观投影；不能先清 pending 再等待状态导致闪回。乱序 ACK 不得重复应用乐观增量。
- [x] 当前可见状态始终由“确认状态 + 尚未应用的待确认操作”派生，避免收到旧值后闪回，或 ACK 到达后重复 +1。
- [x] 同房间快照 seq 小于当前值时忽略，重复事件忽略；发现版本缺口时请求当前快照，期间记住收到的最高 seq，快照仍落后则再请求一次。首版不实现额外的事件缓冲和重放队列，也不为版本缺口重建 WebSocket。
- [x] 短时断网后重新握手，先获取权威快照，再用原 requestId 查询/重试原会话操作。不明确失败或成功的掷骰不能新建 requestId 自动再掷一次。
- [x] 快照同步同时携带本会话待确认 requestId 查询列表；服务端在与快照一致的读取点返回已提交 receipt。先消除快照已经包含的 pending，再计算乐观投影，避免重连时希望/恐惧暂时多加一次。对未提交命令才沿用原 ID 重试；拒绝的旧 generation 不重试。
- [x] 已离线时禁用新增资源和掷骰操作，展示离线原因；断线前已经提交或待确认的操作保留。恢复连接前不允许用户误以为按钮已同步成功。
- [x] 同名替换 generation 改变时，清除旧完整卡缓存及旧世代乐观投影；显示“角色已重新投递，旧卡未确认修改未应用”，不自动把旧操作改成新 generation。
- [x] pending 操作的浏览器端确认超时可以触发查询/原 ID 重试，禁止在 DO 建常驻 timer。标签页重新可见时做一次状态核对，不每五秒唤醒服务器。
- [x] 角色组件按名字订阅对应摘要/资源；骰子面板仅订阅骰子及连接状态。掷骰不应让四张卡及完整卡重新渲染。

**验收用例：** 连点希望十次后 ACK/广播交错；操作发出后立即刷新；切页期间收到资源事件；先接收新快照后收到旧响应；同名覆盖时旧详情请求返回；断网后刷新并重试；切换两个房间不能混入另一房间队列。

```powershell
npm --workspace fronted test -- src/__tests__/room-v2-sync.test.ts src/__tests__/room-outbox.test.ts
npm --workspace fronted test -- src/__tests__/room-v2-client.test.ts
```

**进入完整 UI 前的门槛：** 在一次双客户端集成会话中完成角色资源修改、正式骰子广播、刷新恢复和断线重试；保存失败、丢 ACK 及 DO 重建由服务端/客户端定向测试覆盖。核心链路此时就应工作；后续卡面只消费已验证的接口，不反向决定存储或通信格式。

## 阶段六 接通车卡器直接投递

**文件：** dhol 新建 `apps/realtime/src/character-ingest.ts` 和 `__tests__/character-ingest.test.ts`，修改入口与 README；车卡器新建 `lib/dhol-client.ts`、`components/modals/dhol-export-modal.tsx`、`tests/unit/dhol-client.test.ts`、`tests/unit/dhol-export-modal.test.tsx`，修改 `app/page.tsx`、`components/layout/bottom-dock.tsx`。

- [x] 增加六位房间码投递端点，房间码作为现有共享房间访问凭据。浏览器来源白名单包含车卡器实际域名；CORS 仅用于浏览器跨域许可，不把它当作身份认证。沿用加入房间等价的限速与有效期检查，不引入用户账号。
- [x] JSON 校验在变更前完成；同名替换在一个事务内完成。HTTP 重试沿用 Idempotency-Key；同一个发送动作的网络重试不能再次覆盖投递之后的资源标记。
- [x] 定义成功响应 `{ok:true, action:'created'|'updated', name, generation, seq}`；错误码包括 ROOM_NOT_FOUND、ROOM_EXPIRED、INVALID_CHARACTER、UNSUPPORTED_SCHEMA、PAYLOAD_TOO_LARGE、RATE_LIMITED、PERSISTENCE_FAILED。
- [x] 弹窗提供房间码、角色名、发送按钮和结果。只保存上次成功的房间码及配置地址；本轮发送中禁止重复点击，网络失败保留表单和原幂等 ID 以便重试。
- [x] 调用当前规则的 `prepareForExport(sheetData)`，发送完整 JSON。对手动再次点击发送的新动作使用新 ID，保证同名再投递仍按约定全覆盖。
- [x] zoot 入口和现有八位码不改，dhol 独立使用六位码。车卡器新入口仅发送到新电脑版房间，不再提供发送到旧电脑版或旧手机版的目的地；车卡器自身原有移动端能力不在此次清理范围内。
- [x] 覆盖前不额外增加强制确认弹窗；按钮旁永久说明覆盖全部资料和资源。成功后展示“已新增/已覆盖：角色名”。
- [x] 在同一次车卡器到面板的联调中抽查两个规则及一张自定义领域卡，确认关键字段与只读结果一致。

```powershell
Set-Location D:\Dql\Desktop\dhol
npm --workspace apps/realtime test -- src/__tests__/character-ingest.test.ts
Set-Location D:\Dql\Desktop\MyDHcharsheet
pnpm test:run tests/unit/dhol-client.test.ts tests/unit/dhol-export-modal.test.tsx
```

**预期：** 错误不修改原卡，成功只覆盖同名卡；zoot 回归和车卡器构建在发布候选的完整检查中执行一次。

## 阶段七 构建完整的新桌面应用

**文件：** 新建 `fronted/src/desktop/DesktopApp.tsx`、`DesktopLanding.tsx`、`DesktopRoom.tsx`、`desktop.css`、`desktop/components/character-panel/` 中前述六个文件，以及 `DicePanel.tsx`、`FearTracker.tsx`、`XCard.tsx`、`RoomToolbar.tsx`、`BackupDialog.tsx`；新增 `fronted/src/__tests__/character-panel.test.tsx`、`read-only-character-sheet.test.tsx`、`room-v2-dice-ui.test.tsx`；`main.tsx` 最终只装配新 DesktopApp。

- [x] 从新建/加入房间到桌面面板、离开房间、重连、过期和新版备份恢复，完整使用新入口与状态。空房间、加载、失败、断线和角色覆盖中的状态一并设计，不把旧首页/顶栏作为临时壳保留。
- [x] 建立独立桌面样式与明确的组件输入输出。参考车卡器的视觉语言，但不复制旧 dhol 全局 CSS 和旧组件副作用；通用无状态 UI 可经依赖审查后复用。
- [x] 摘要卡固定顺序：身份 → 四资源 → 闪避/护甲值/阈值 → 六属性 → 武器伤害 → 查看完整信息按钮。生命与压力明确“已标记”，希望明确“当前值”，护甲槽与护甲值分开标注。
- [x] 四卡布局使用 CSS Grid 两列两行；四角色摘要在 1440×900、100% 缩放下无需横向滚动，按钮与字体不靠整体缩放压小。超过四角色只切本地页，不重新导入角色。不实现手机单列布局；过窄视口展示桌面使用提示。
- [x] 希望用加减按钮；生命/压力/护甲按格标记，支持键盘和可见焦点，不能只靠颜色区分选中。连接未就绪时禁用修改。
- [x] 标记写入全局状态，组件卸载不负责保存。快切页、打开详情、关闭详情都不能清空 outbox 或确认状态。
- [x] 完整卡用角色 JSON 和当前 resources 派生一个只读视图。普通卡、第二页、领域卡、自定义卡、伙伴及适用扩展页按车卡器页面条件展示；在一次视觉验收中对照代表性页面截图，不导入它的编辑器 store。
- [x] 完整卡中没有可编辑输入、contenteditable 或修改事件；保留滚动、分页、展开、复制文字和关闭按钮。不能仅用透明遮罩/禁用鼠标伪装只读，键盘也不能修改。
- [x] 完整卡按需加载，首次打开显示加载状态，失败有重试按钮；读取只读卡不触发持久化写入或房间业务版本增长。
- [x] 领域卡长文、自定义装备、空头像、长名字和缺失字段均有稳定显示；图片只接受安全显示来源，不能执行 JSON 中的 HTML/脚本。
- [x] 每张卡组件使用稳定名字键及 generation 处理覆盖；分页顺序稳定。删除角色有明确操作入口和常规防误触确认，不能靠改名实现删除。

```powershell
Set-Location D:\Dql\Desktop\dhol
npm --workspace fronted test -- src/__tests__/character-panel.test.tsx src/__tests__/read-only-character-sheet.test.tsx
npm run fronted:build
```

**视觉和交互验收：** 在同一次浏览器会话中检查四人摘要、五人分页、窄屏桌面提示、四种资源修改、完整版只读、域卡正文完整、车卡器同名再发送时卡面及资源同时替换；没有手机房间入口。发布候选若未改动这些界面，只抽查关键路径，不再逐项截图。

## 阶段八 验证新版掷骰链路与架构独立性

**文件：** 测量与优化 `apps/realtime/src/room-v2-commands.ts`、`fronted/src/desktop/components/DicePanel.tsx`、`desktop/state/room-sync.ts`；新建 `apps/realtime/src/__tests__/room-v2-dice.test.ts`、`scripts/check-desktop-boundaries.mjs` 和 QA 报告。掷骰基本实现已在阶段四/五完成，本阶段在完整 UI 与真实角色负载下验证。

- [x] 保留服务器统一生成随机结果、现有公式/优势劣势/希望恐惧骰规则；客户端只显示“掷骰中”，不生成一个可能与最终结果不同的临时数字。
- [x] 请求进入 DO 后只执行校验、去重、掷骰、小事务和小事件广播，不等 HTML 恢复、角色 JSON 序列化、图片或界面动画。
- [x] 热路径读取最小房间元信息与骰子历史，不恢复整份角色资料；冷启动同样不能编译所有 HTML。正常单次掷骰事件目标不超过 2 KiB，大骰池按实际内容记录体积，不强行截断结果。
- [x] 同一请求成功后发起人与观察者收到同一 roll ID 和结果；本机 UI 不通过重新获取全房间等待结果。没有人为五秒窗口，没有用于“等动画结束”而延后入历史的计时器。
- [x] 大型角色投递的解析、校验放在事务之前，事务只替换必要行；压力用例同时投递角色和掷骰，测命令排队时间。不能为提速跨过已确认的持久化顺序。
- [x] 在阶段一相同环境用约 50 次普通掷骰和 20 组双客户端操作比较 P50/P95、保存时间、显示时间和失败数。只有数据显示渲染占比明显时才打开浏览器 profiler 定位重渲染；P95 仅作为该样本下的参考。
- [x] 复用阶段四、五的定向测试检查 ACK 丢失、保存失败和断线重试；广播缺口由快照同步测试覆盖，不再单独为性能阶段重复造一套故障注入。

```powershell
npm --workspace apps/realtime test -- src/__tests__/room-v2-dice.test.ts
npm --workspace fronted test -- src/__tests__/room-v2-dice-ui.test.tsx src/__tests__/room-v2-sync.test.ts
node scripts/check-desktop-boundaries.mjs
```

- [x] 依赖边界脚本从 DesktopApp、RoomV2DurableObject 和 `@dhgc/shared/desktop` 出发，使用 TypeScript 模块解析解析别名与 barrel 的传递依赖；任一路径到达旧 store、旧页面、旧房间类型、旧实时客户端、HTML 解析或移动角色码即失败。不能只搜索组件文件中的直接 import。
- [x] 在候选前端中删除旧 App/pages/store/lib 实现与相关旧 UI，再运行前端构建及核心联调，证明新版能独立运行。只剩旧代码但“目前不调用”不能作为最终完成状态。
- [x] 新后端所有业务从新模块入口验证。正式旧类删除之前暂时保留的旧类导出仅供部署生命周期使用，不得被新路由/DO 调用；准备好移除该导出的最终清理构建，并在独立测试环境部署验证。
- [x] 记录允许复用的骰子纯函数、通用 UI 和加密工具清单；所有模块给出依赖依据。删除无用包、旧样式和旧脚本后再跑构建，确认没有间接依赖掩盖缺失。

**目标而非事先承诺：** 在香港测试环境、稳定网络、已连接且同步完成、普通骰池下，点击到发起者及在线观察者显示正式结果 P50 ≤300 ms、P95 ≤800 ms；休眠后第一掷单独报告，P95 目标 ≤1500 ms。若网络往返本身已经超过目标，必须分别报告网络基线和应用增加的耗时，不能宣称达标。

## 阶段九 新版上线后彻底退役两种旧房间

**文件：** 发布已验证的 `fronted/src/desktop/` 应用，删除旧 App/pages/store/lib 与旧业务组件；修改新版共享公开入口、`apps/realtime/src/index.ts`、`apps/realtime/wrangler.toml` 和 README；新建退役测试 `apps/realtime/src/__tests__/legacy-room-retirement.test.ts`、`fronted/src/__tests__/legacy-session-cleanup.test.ts`。这些代码清理在阶段八提前准备和构建验证，本阶段执行发布及存储退役。

### 9A 准备新版独立存储与正式上线

- [ ] 核对生产 Worker、账号、环境及 namespace ID，确认原 `RoomDurableObject` 下是本项目旧电脑版和旧手机版，不含新版或其他应用数据；检查外部 Worker 是否引用原 namespace，先解除这些本项目旧引用。清理目标只列 dhol 的实际旧 namespace，不对整个账号执行批量删除。
- [ ] 保留历史 `v1` migration，追加以下新版绑定和创建记录。tag 必须与线上迁移历史核对，不可重用已经用于其他变更的 tag。

```toml
[[durable_objects.bindings]]
name = "ROOMS_V2"
class_name = "RoomV2DurableObject"

[[migrations]]
tag = "v2-json-desktop"
new_sqlite_classes = ["RoomV2DurableObject"]
```

- [ ] 先部署新版服务端，再部署新电脑版前端与车卡器投递入口。先发布的版本暂不附带删除旧类的 migration；不能在新版验证前提前删除旧数据。
- [ ] 新建页只有“创建房间”，不再选择电脑版/手机版。所有新创建、加入、管理、投递和 WebSocket 统一进入 `/api/v2/rooms` 及 `ROOMS_V2`。新房间缺失时返回不存在，不尝试从原 namespace 查找或迁移。
- [ ] 用正式域名完成新版冒烟：创建 → 两客户端加入 → JSON 投递 → 四资源标记 → 掷骰一致 → 刷新/重连恢复 → 新版导出恢复。记录新版 room_id 和状态摘要，作为删除旧存储之后的对照。

### 9B 删除所有旧房间数据

- [ ] 新版线上冒烟全部通过后，立即进入清理发布。关闭旧创建、加入、更新、HTML 获取、角色码导入、导出及旧管理路由；旧 `/api/rooms` 系列返回 HTTP 410 与 `LEGACY_ROOMS_RETIRED`。它只是无状态退役响应，不读取旧数据、不创建 DO，也不提供迁移功能。
- [ ] 删除原 `ROOMS` binding、代码中的 `RoomDurableObject` 类及导出/引用，然后在迁移历史末尾追加下面的删除记录，部署清理版本。`RoomV2DurableObject` 和 `ROOMS_V2` 必须保留。

```toml
[[migrations]]
tag = "v3-retire-legacy-rooms"
deleted_classes = ["RoomDurableObject"]
```

- [ ] 使用旧类删除 migration 删除该类的全部 DO 与存储，包含活跃/休眠的旧电脑版和手机版、HTML 键、资源、骰子历史、画板/笔记/倒计时及其他旧房间状态。不能只删除已知邀请码的几个房间，也不能只删绑定/前端入口而保留云端存储。
- [ ] 不新增旧数据迁移或归档任务。若实际部署存在额外的旧房间专用 D1/R2 等存储或服务器端备份，先按绑定与数据归属列明，再删除 dhol 旧房间拥有的数据；不能删除共享库中其他项目的数据。当前本地配置的 D1 仅为未启用示例，不能把它当作线上已存在资源。
- [ ] 验证旧 namespace 已退役、旧活动连接关闭且无法恢复业务，旧 alarm 不再触发旧房间工作；通过配置/平台状态验证全局清理，并抽测旧电脑版和手机版邀请码。邀请码抽测不能替代 namespace 删除成功证据。
- [ ] 重新读取 9A 的新版测试房间，逐项比对角色、资源、骰子、X 卡和过期时间；继续新增一次标记和掷骰，验证新版 namespace 完整可写。

Cloudflare 的 class delete migration 会删除该类所有实例及其存储，适合本次“两个旧版全部清除”的范围。已有 Worker 可继续使用 `migrations`；本轮不额外迁移到另一套配置机制。参考：[官方旧式 migration 文档](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/)。

### 9C 发布已验证的清理构建并验证缓存退役

- [ ] 确认候选构建已删除旧电脑版 `fronted/src/components/gm-panel/`、旧手机版 `fronted/src/components/mobile-panel/`、`fronted/src/utils/gmPanelHtml.ts`、旧 App/pages/store 与旧 `lib/realtime.ts`。新版恐惧控件使用已建好的 FearTracker，不再临时从旧目录接入。
- [ ] 删除废弃的画板、笔记本、战斗面板、倒计时 UI、store action、协议与后端处理；移除仅这些功能使用的依赖。旧 FloatingDicePanel/FloatingXCard 随旧系统删除，新版使用独立 DicePanel/XCard，只保留已通过审查的纯规则和无状态展示函数。
- [ ] 删除 `packages/shared/src/mobile-panel-code.ts`、旧 HTML 解析/编译/资源回放、旧导入格式与迁移逻辑。相关旧测试夹具与专属测试一并清除；数据可靠性、骰子和连接测试改用新版夹具保留，不以删测试代替新版验证。
- [ ] 删除旧 RoomType、RoomState 和 AppStore，不保留 `Legacy | V2` 联合类型或格式自适应转换层。新版仅一个桌面房间模型；创建请求传入旧类型明确拒绝，不偷偷转换为新房间。
- [ ] 新版仅接受带新 schema 的 JSON 房间备份；旧 HTML、移动角色码及旧房间备份均拒绝，并提示从车卡器重新投递。保留新版 JSON 备份中的完整资料、当前资源、排序、恐惧、骰子和 X 卡。
- [ ] 浏览器首次加载新版时按明确旧键名/前缀删除本站旧会话、旧房间缓存和旧待发送队列；使用持久化清理版本标记避免重复执行。不调用 `localStorage.clear()`，不误删新版数据、车卡器存档或其他应用数据。离线浏览器无法远程立即清缓存，其旧凭据在服务端即时失效，重新访问时再清本地缓存。
- [ ] 旧前端 URL 展示“旧版房间已下线，请创建新房间”，不会自动带旧 token、旧房间内容或旧队列进入新版。新版客户端识别退役状态后停止重连；仍运行缓存旧 JS 的浏览器可能继续按旧策略重试，服务端固定拒绝且不访问 DO，不能假定浏览器 WebSocket API 会把握手 HTTP 410 暴露给旧脚本。刷新到新版后清理旧会话并提供新建入口。
- [ ] 移除旧手机版独立入口、旧电脑版 HTML 入口及手机单列面板；生产 bundle 不包含两套旧房间组件。历史 Git 记录、计划中引用和已应用 migration 名字可以保留，它们不构成运行时兼容层。

**发布候选验证：** 退役相关测试与构建并入阶段十 10A 的完整检查，只执行一次；此处额外核对旧模块引用。生产删除后另按 9B 验证 namespace 和新版数据。

```powershell
Set-Location D:\Dql\Desktop\dhol
rg -n 'gm-panel|mobile-panel|gmPanelHtml|decodeMobilePanelCharacterCode|env\.ROOMS\b|class RoomDurableObject' apps/realtime/src fronted/src packages/shared/src
```

**预期：** 测试和构建通过；搜索命中仅允许明确的拒绝旧格式测试/退役识别，不允许活跃路由、组件依赖或状态恢复逻辑。最终旧电脑版和手机版均无法创建、加入、恢复；旧 namespace 删除完成，新版测试房间前后状态一致。

## 阶段十 最终验收清单与上线观察

### 10A 发布前验收

本节发布前检查必须在阶段九正式上线前完成；退役数据相关用例先在独立测试 namespace 演练，生产实际删除结果在 10B 再验证。阶段内已通过的定向用例不逐项重跑；发布候选统一执行下列完整命令和一轮人工联调。

- [ ] 在测试环境完成以下数据可靠性矩阵，所有“已保存”的操作必须在刷新、新客户端加入及 DO 重建后仍存在。

| 场景 | 最低覆盖与合格条件 |
| --- | --- |
| 标记和翻页 | 跨页标记约 20 次，刷新后已确认标记零丢失；其余由同步单测覆盖 |
| 快速点击 | 单角色连续调整约 10 次，确认后最终结果与操作一致 |
| 并发修改 | 两客户端约 20 组独立格/增减操作，无整数组覆盖丢失 |
| 刷新恢复 | 点击后立即刷新、成功 ACK 后刷新各覆盖；待确认可恢复或明确失败 |
| 休眠/重建 | 空闲唤醒和新 DO 实例读同存储，资源及骰子记录一致 |
| 故障注入 | 复用阶段四、五定向测试覆盖保存失败、ACK 丢失、消息重复、旧快照和版本缺口；人工联调只抽查刷新与重连 |
| 全覆盖 | 同名重发后所有资料与四资源换新，旧世代操作明确拒绝 |
| 完整卡只读 | 鼠标、键盘不能改值，复制/翻页/滚动正常 |
| X 卡 | 在线客户端立即收到，重连快照可恢复当前状态 |
| 旧房间清理 | 两种旧房间与其 namespace 已删除，旧链接/token/格式不能访问新版 |
| 清理隔离 | 旧数据删除前后，新电脑版既有标记和骰子一致且可继续操作 |
| 唯一入口 | 只可创建新电脑版，旧手机版、旧电脑版与手机单列布局均不存在 |
| 架构独立性 | 新前端、DO、共享入口的传递依赖不包含旧状态/协议/HTML 模块 |
| 删除旧模块后构建 | 清除旧 App/store/pages/业务组件后，新版仍能构建并完成双客户端闭环 |
| 骰子规则复用 | 抽离的纯算法测试仍通过，算法没有间接导入旧 RoomState |

- [ ] 执行完整必要检查，不将新增测试通过当作整个仓库通过。

```powershell
Set-Location D:\Dql\Desktop\dhol
npm --workspace packages/shared test
npm --workspace apps/realtime test
npm --workspace fronted test
node scripts/check-desktop-boundaries.mjs
npm run build
npm run fronted:lint
Set-Location D:\Dql\Desktop\MyDHcharsheet
pnpm test:run tests/unit/dhol-client.test.ts tests/unit/dhol-export-modal.test.tsx tests/unit/zoot-client.test.ts tests/unit/zoot-export-modal.test.tsx
pnpm build:local
```

- [ ] 有历史 lint 失败时记录原有基线，要求变更文件没有新增失败；构建、类型与相关测试失败不能跳过。
- [ ] 新建模块及重写模块 lint/typecheck 必须干净；“历史失败”豁免不能覆盖新版代码，不可因旧目录已删除而继续绕过对应检查。
- [ ] 两个仓库各自分阶段提交。每个阶段先审阅 `git diff`、只暂存该阶段实际文件，再使用本阶段目的为 commit 标题；不执行 `git add .` 混入原有 `docs/plans/` 未跟踪资料。

### 10B 正式上线与清理后验收

- [ ] 在独立测试房间用两个连接空闲观察约 30 分钟，不反复查询房间接口以免污染空闲实验。排除到期 alarm 和重连事件后，查看 Duration 是否仍随连接时长持续增长，并检查周期性业务消息；若指标不清楚，再延长观察而非预设多轮浏览器实验。
- [ ] 所有测试环境可靠性与延迟检查先于阶段九生产清理；阶段十的上线后检查不替代删除前的新版冒烟。发布时记录前后端、新旧 namespace 与 migration 版本；备份只针对新版测试/正式房间，不新增旧房间归档。部署前读取 wrangler 技能并核对配置、域名和绑定，计划阶段不修改生产配置。
- [ ] 按阶段九完成“新版上线 → 冒烟通过 → 清除旧房间 → 验证新版不受影响”，随后观察至少两次完整跑团及连续七天用量趋势。比较每房间活跃小时的 GB-s，不能只看全账号绝对值；七天观察不是保留旧版的兼容期。
- [ ] 清理前若新版冒烟失败，先修复新版，不能把删除旧数据提前作为排错手段。清理后回滚只使用支持 RoomV2DurableObject 和已应用迁移历史的新版兼容构建，不回滚到旧手机版/电脑版，不重建旧类，不宣称代码回滚能恢复已删除的数据。新版故障可临时暂停创建并修复，已保存的新版房间数据继续保留。

## 完成定义

- 新桌面应用、新模型、新协议、新同步状态机和新 DO 可以脱离旧业务模块独立构建运行；没有向旧 AppStore 叠加新 slice、继承旧 RoomState 或用适配层持续调用旧业务的方法。
- 数据可靠性矩阵全部通过；任何未保存修改有明确状态，不以页面上暂时显示过视为已保存。
- 掷骰延迟有同环境前后测量，达到目标或明确指出尚未解决的限制；不以本地动画替代服务器结果伪造速度。
- 新电脑版的 JSON 同名全覆盖、2×2 摘要、完整只读卡、恐惧点、X 卡及新版备份完整可用。
- 空闲房间符合休眠条件，实际指标不再显示连接一直占用计算时间；不能承诺全账号永不超额。
- 旧电脑版和旧手机版房间及服务端数据已全部清除；两套旧 UI、业务协议、恢复逻辑和旧格式导入均已移除，只保留无状态下线说明和历史 migration 记录。
- 新旧 namespace 删除隔离验证通过，新版数据不受清理影响；项目只保留新电脑版，没有手机单列专用版本。

## 依据

- 本仓库当前实现：`apps/realtime/src/index.ts`、`fronted/src/components/gm-panel/GmPanelBoard.tsx`、`fronted/src/utils/gmPanelHtml.ts`、`fronted/src/store/useStore.ts`、`packages/shared/src/utils.ts`。
- 车卡器投递参考：`D:\Dql\Desktop\MyDHcharsheet\lib\zoot-client.ts`、`components\modals\zoot-export-modal.tsx`；zoot 接收参考：`D:\Dql\Desktop\zoot\worker\routes\characters.ts`。
- [Cloudflare DO 生命周期](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)：定时器、未完成 I/O 等影响休眠。
- [Cloudflare WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)：保持连接而允许空闲休眠。
- [Cloudflare DO 计费](https://developers.cloudflare.com/durable-objects/platform/pricing/)：Duration 与请求、存储是不同维度。实施时再次核对平台文档。
- [Cloudflare class migrations](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/)：新增独立类以及永久删除旧类全部实例/存储；本轮只记录计划，不执行删除 migration。

## 计划自检

- [x] 2026-10-09 重构复审已修正旧 store 挂接、旧骰子组件改造、旧共享类型复用与上线后才解耦的安排。
- [x] 新版入口、状态、连接、领域模型和 UI 均有独立文件边界；复用限于经验证的纯算法及无状态基础组件。
- [x] 核心标记/掷骰闭环先于复杂 UI，删除旧依赖后的构建和联调是发布前硬门槛。
- [x] 用户指定的名字标识、全部覆盖、只读完整版、四资源标记和 2×2 布局均有对应阶段。
- [x] 数据丢失与骰子延迟分别有故障注入、测量方式和完成标准。
- [x] 六位 dhol 房间码未误用 zoot 八位规则。
- [x] 断线去重、同名覆盖时旧操作、旧快照回退、持久化失败均有明确处理。
- [x] 旧电脑版和手机版彻底退役、新版独立存储、先上线后清理及仅新版回滚均已列明。
- [x] 取消旧房间保留/迁移与手机单列布局，保留新版备份，不清除车卡器或 zoot 的数据。
- [x] 本轮只有计划文档变更，没有运行业务测试、修改业务代码或部署。
