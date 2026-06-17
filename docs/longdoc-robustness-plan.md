# 长文档健壮性改造计划（longdoc-robustness）

> 目标：长文档生成**结构性不出错**——编号不漂移、内容不丢/不重、标题不误升、**出错必告知**。
> 核心原则：**能确定性保证的，就不交给 AI 在分块里自觉遵守。**
> 分支：`longdoc-robustness`；还原点：tag `backup-pre-longdoc`（提交 `1268957`）。

---

## 0. 关键发现（已核实，决定了优先级）

- 服务端**已写了**逐块清洗：`truncateAtRepetitionLoop`（砍重复循环）、`repairUnclosedTags`（补未闭合标签）、`reinjectMissingPlaceholders`（补图片占位），作用于 `cleanChunk → fullRestoredText`（`backend/src/routes/generate.ts:1458,1463,1470,1504`）。
- **但发给前端的是清洗前的原始 delta**（`generate.ts:1285`），`fullRestoredText` 从不发送（`1508` 只发进度，`1560` 直接 `{done}`）；前端最终 HTML = `fullText += data.delta`（`frontend/services/backendApiService.ts:111`）。→ **所有清洗对用户不可见（死代码）。**
- `buildIntegrityReport`/`countStructure` **零调用方**（`generate.ts` 仅 `import { IntegrityIssue }` 类型）；`integrityReport` 事件从不发送。→ **完整性检测从未运行。**
- 前端**已备接收口**：`data.text` 全量替换（`backendApiService.ts:116`）、`data.integrityReport` 捕获（`:92`）。→ 发出去即生效，纯后端改动。

---

## 1. 四条不变量（原则）

1. **AI 不拥有任何编号/ID**：标题号、图/表号、`__IMG_N__` ID 由确定性代码在合并后按「最终层级 + 所选方案」重算盖章。
2. **合并后的整篇才是真相**：所有修复 + 校验跑在合并文本上，且**这份权威文本必须送达前端**。
3. **排版只打标签、不重写正文**（远期目标，P2 块管线）。
4. **返回前确定性校验完整性，并以校验为闸**。

---

## 2. 本次范围

**P0（本次实现）**：① 发送权威文本+报告 ② 堵静默丢块 ③ 确定性后处理（降级+重编号+图表号+图片校验）④ 完整性放行闸。
**P1/P2（后续，仅列计划）**：结构安全切分、断块恢复+续写护栏、源头确定（FIGURE_DATA/title 角色）、块管线/长上下文单遍。

---

## P0-1 发送权威合并文本 + 完整性报告

- **文件**：`generate.ts`（chunk loop 之后、`{done}`〔:1560〕之前）；`integrity.ts`（已存在，启用）。
- **改动**：
  1. 循环**前**：`inputCounts = countStructure(contentForChunking)`（切分前、去图占位后的内容）。
  2. 循环**后**（在 P0-3 后处理**之后**）：`outputCounts = countStructure(finalText)`。
  3. `report = buildIntegrityReport(inputCounts, outputCounts, integrityIssues)`。
  4. `res.write({ integrityReport: report })` → `res.write({ text: finalText })` → `{done}`。
- **保证**：确定性——所有服务端修复 + 报告真正到达用户。
- **测试/验证**：端到端确认前端 `data.text` 全量替换生效、`capturedReport` 非空。
- **风险**：末尾再发一次全文使字节翻倍 + 一次视觉"snap" → 仅末尾发一次，可接受。

## P0-2 堵住静默丢整块

- **文件**：`generate.ts:1134-1169`（skip / early_stop）。
- **改动**：
  - **删除** `consecutiveCoveredSkips >= 2` 的 `break` → 改 skip-and-continue（永不放弃尾部）。
  - 收紧 skip 条件：必须**正文长程逐字重叠**（`calcTailHeadOverlap` 走正文，coverage ≥ 0.78 over 整块归一化长度）**且**标题匹配；删掉"仅标题相似（fingerprint）就跳"的分支（或要求 fingerprint **AND** body overlap）。
  - 每次 skip `push` 一条可见 issue（`type:'chunk_skipped', severity:'info'`）。
- **保证**：确定性——"放弃后半篇""标题撞名丢整章"不可能。残留重复由 P0-1 接通的 `truncateAtRepetitionLoop` + 流式护栏兜底（可见可恢复，优于静默丢失）。
- **测试**：构造两块标题撞名（概述/小结/附录）但正文不同 → 两块都保留。

## P0-3 确定性后处理（新模块 `backend/src/utils/postProcess.ts`）

- **调用点**：`generate.ts` 循环后、verify 前，作用于 `fullRestoredText`。
- **实现注意**：后端无 DOM → 用稳健的标题正则按出现顺序遍历（`<hN ...>…</hN>`）；全部**幂等**。
- **有序子步骤**：
  - **(a) enforceSingleTitleAndDemote**：保留**第一个** `class="doc-title"` 的 `<h1>`；其后任何 `doc-title` 或裸 `<h1>` → 降级为 `<h2>`（去 `doc-title` class）。根治"中部标题被提成大标题"。
  - **(b) renumberHeadings**：维护 `counters[1..6]`（内容层级从 `<h2>` 起算为第 1 级）。逐标题：剥离已有前缀（复用 `prompts.ts` 的 strip 规则：中文序号 `一、`、`第N章/节`、阿拉伯小数 `1.1.1`、`(1)`/`（1）`），按 `styleConfig.headingNumbering` 重新盖章：
    | scheme | h2 | h3 | h4 | h5 |
    |---|---|---|---|---|
    | decimal / decimal-nested | `1.` | `1.1` | `1.1.1` | `1.1.1.1` |
    | chinese-hierarchical | `一、` | `（一）` | `1.` | `(1)` |
    | chapter | `第一章` | `第一节` | `一、` | — |
    | none | （不加号） | | | |
    进入更高层级时**重置更低层级**计数；`doc-title` 不编号。
    `.docx`（`preComputedHeadings` 非空）：层级+号**优先用** `preComputedHeadings`，按**剥离后文本**双向匹配（修 `generate.ts:1183` 用未剥离 key 的问题）；匹配不上的（AI 新增标题）回退层级栈。
  - **(c) renumberCaptions**：遍历 `figure-caption`/`table-caption`，重排 `图N`/`表N`（`chapter-relative` 时按当前 `<h2>` 章号 → `图{章}-{序}`）。
  - **(d) reconcileImages**：校验每个全局 `__IMG_N__` 恰好出现一次；缺失的报 issue（**按源位置补回**依赖 P1 的偏移记录，P0 先"校验+报告"）。
- **保证**：确定性（**号**）：连续、合规、唯一标题、图表号正确，且是「最终层级+方案」的纯函数。尽力而为（**层级**）：`.docx` 纠正，粘贴文本按 `<hN>` 栈。
- **测试**：`postProcess.test.ts`（vitest）——乱号 + 中部第二个 doc-title + 撞号 → 连续正确、单标题；5 种 scheme 各一例；**幂等**（跑两次结果一致）。
- **风险**：剥前缀误伤"正文标题本身以 3.5 开头" → 只剥**识别得出的方案 token**；交叉引用（"见图3"）不改写，失配仅报 info。

## P0-4 完整性放行闸

- **文件**：`generate.ts`（report 算完后）；`integrity.ts`（加 tripwire）。
- **改动**：
  - `integrity.ts` 增 tripwire：重复/跳号章节、`>1` doc-title → 加 issue。
  - 若 `charRetentionPct < 阈值`（~90%，可配）**或**有 critical（`loop_truncated`/`stream_hallucination`/`early_stop`）→ `report.truncated=true` + `review` 标记。
  - 复用 `clientClosed` 不计费路径（`generate.ts:1539-1542`）：明显残缺**不扣额度**。
  - 前端：确认有展示位（信任层已删 → 补一个轻提示"内容可能不完整，请复核/重生成"）。
- **保证**：确定性（检测）——出错必告知。

---

## 3. 验证策略（每项做完即验）

- 后端 `tsc` 0 错；新增 vitest（postProcess 5 scheme + 幂等；integrity tripwire）。
- 前端 `tsc` 仅 3 个既有基线错（docxGenerator ×2 + sanitizeHtml.test），新增 0。
- **端到端**：构造 **≥1.2 万字、6 章多级**长文档（粘贴一份 + .docx 一份），跑 deepseek →
  章节号连续无重复、无丢章、单标题、前端收到 `data.text` 替换 + 完整性报告；
  再跑短文档（单块）确认**无回归**。

## 4. 顺序与提交

逐项一个 commit（P0-1 → P0-2 → P0-3 → P0-4），每项过 tsc/test 再下一项；全绿后再议合回 `main`。

## 5. 撤回

- 整条不要：`git checkout main && git branch -D longdoc-robustness`
- 回滚到备份：`git reset --hard backup-pre-longdoc`

---

## 附：P1 / P2（后续，本次不做）

- **P1**：结构安全切分（`chunking.ts:117` 硬切退到标签/实体/代理对/公式分隔符外；表格/列表按 `</tr>`/`</li>` 行切）；断块恢复 + 续写循环也加流式护栏；mid-tag 截断剥半标签；chunk 标 `[startHeadingIdx,endHeadingIdx]` 索引。
- **P2**：源头确定（docxParser 产 FIGURE_DATA 清单 + `role:'title'`，并修其忽略 Word numId/restart 的计数器）；长上下文模型**默认单遍**（无接缝即无接缝错误）；**块管线（Strategy 7）**——正文切原子块带稳定 ID，AI 只回 `{id,role,level}`，系统逐字重组 → 正文丢失/篡改构造上不可能。
