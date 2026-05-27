# 为何使用 LangGraph 实现多 Agent 架构

本文说明本仓库（Browser Test Agent）选用 **LangGraph** 编排「多 Agent」的原因，并与实际代码结构对应。可与 [产品架构总览](./product-architecture-overview.zh-CN.md) 一起阅读。

---

## 1. 结论摘要

**不是为了「多 Agent」这个名词**，而是要把 **对话 → 规划 → 按任务依赖调度多个专家节点 → 汇总收尾** 做成可维护的 **状态机**。LangGraph 提供：

- **共享状态**（带 reducer 的合并语义）
- **动态跳转**（`Command` + 多出口节点）
- **流式更新**（与 SSE 对接）
- **检查点**（`thread_id`、收尾读状态）

这与本项目的 `taskPlan`、`dispatcher`、多节点回环模型高度一致。

---

## 2. 本项目中的「多 Agent」实际在做什么

从图结构看，本质是：

| 节点 | 职责 |
|------|------|
| `mainAgent` | 对话、决定是否进入规划或结束 |
| `planAgent` | 产出带依赖的 `taskPlan`（`TaskPlanMain` + `subTasks`） |
| `dispatcher` | 根据「谁 pending、依赖是否满足、全局顺序」决定下一步跳到哪个节点，并发出 `agent_start` |
| `parseHtmlAgent` / `testCodeAgent` / `seoAgent` / `pagespeedAgent` / `reportAgent` | 各专家执行；执行完回到 `dispatcher`，形成 **调度环** |
| `finalSummary` | 发 `complete`、释放 Playwright 等 |

因此：**多 Agent = 图上的多个节点 + 一个中央调度器**，而不是 N 个互不通信的独立 LLM。

调度逻辑集中在 `dispatcherNode`：用 `Command({ goto, update })` 表达「下一步去哪、状态如何更新」。

```27:74:packages/server/src/agents/graph.ts
async function dispatcherNode(state: State) {
  if (flattenTaskPlan(state.taskPlan).length === 0) {
    return new Command({ goto: END })
  }

  if (allTasksFinished(state.taskPlan)) {
    return new Command({ goto: 'finalSummary' })
  }

  const exec = executablePendingTasks(state)
  if (exec.length === 0) {
    return new Command({ goto: 'finalSummary' })
  }

  const next = pickNextExecutableTask(state.taskPlan, exec)
  const assign = next.assignTo

  const goto =
    assign === 'parseHtmlAgent'
      ? 'parseHtmlAgent'
      : assign === 'testCodeAgent'
        ? 'testCodeAgent'
        : assign === 'seoAgent'
          ? 'seoAgent'
          : assign === 'pagespeedAgent'
            ? 'pagespeedAgent'
            : assign === 'reportAgent'
              ? 'reportAgent'
              : 'finalSummary'

  if (goto === 'finalSummary') {
    return new Command({ goto: 'finalSummary' })
  }

  return new Command({
    update: {
      taskPlan: markRunning(state.taskPlan, next.id),
      streamEvents: [
        {
          type: 'agent_start' as const,
          agentName: assign,
          taskId: next.id,
          timestamp: Date.now(),
        },
      ],
    },
    goto,
  })
}
```

这种 **环 + 条件分支** 若全部用手写 `while` + `switch` 也能实现，但路由、状态合并、可观测事件容易散落各处，节点越多越难维护。

---

## 3. 选用 LangGraph 的具体原因

### 3.1 单一真相源：`BrowserTestState` + reducer

`pageDSL`、`taskPlan`、`agentOutputs`、`streamEvents`、`reports` 需要在多个节点间 **累积、合并**（例如 `agentOutputs` 浅合并、`streamEvents` 拼接）。LangGraph 的 `Annotation` + `reducer` 明确描述「每次节点返回的 partial 如何并进总状态」，避免手写全局可变对象到处修改。

```98:132:packages/server/src/agents/state.ts
export const BrowserTestState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  userInput: Annotation<string>(),
  pageUrl: Annotation<string>(),
  runnerSessionId: Annotation<string>(),
  usePlaywrightBrowser: Annotation<boolean>(),
  playwrightHeadless: Annotation<boolean>(),
  playwrightSlowMoMs: Annotation<number>(),
  taskPlan: Annotation<TaskPlanMain[]>(),
  nextAgent: Annotation<string>(),
  pageDSL: Annotation<PageDSL | null>(),
  agentOutputs: Annotation<Record<string, AgentOutput>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  parallelResults: Annotation<{ taskId: string; agentName: AgentName; output: AgentOutput }[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  streamEvents: Annotation<StreamEvent[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  reports: Annotation<Record<string, string>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
})
```

**多 Agent 本质是「多步写同一份黑板状态」**；用图框架比「各 agent 各持一份拷贝再手动 merge」更不容易出错。

### 3.2 动态控制流：`Command` 与多出口节点

`dispatcher` 在运行时根据 `taskPlan` 决定 `goto` 到哪个 agent；节点上声明 `ends: [...]` 列出合法后继。这是典型的 **workflow / 状态机**，`Command` 适合表达「下一步不固定」的流程，比冗长的 if-else 链更清晰。

### 3.3 与 HTTP 层对接：流式 `stream` + `streamMode: 'updates'`

控制器中对图执行 `stream`，按 chunk 提取 `streamEvents` 再通过 SSE 推到扩展端——**每一步的状态更新**与**可观测事件**天然对齐。若不用图库，也需要自研一套「每步产出事件列表」的协议；LangGraph 把步与状态更新绑在一起，减少自研编排层的表面积。

### 3.4 检查点：`MemorySaver` + `thread_id`

图使用 `MemorySaver` 编译，请求携带 `thread_id`。流结束后可通过 `getState` 读取最终态（例如取得 `runnerSessionId` 做会话释放）。多步、多节点、存在异常路径时，**具备 checkpoint 语义**有利于收尾与调试。

### 3.5 与 LangChain 生态一致

项目中的 LLM 调用、`BaseMessage` 等已基于 LangChain；用 LangGraph 编排，节点内延续同一套习惯，迁移与团队心智成本较低。

---

## 4. 若不用 LangGraph

完全可以自研：**一个 `Orchestrator` + `while (!done)` + `switch`**。代价包括：

- 自行实现 partial state merge、事件收集、与 SSE 的协议对齐；
- `dispatcher` 与各 agent 的边界容易混在一起；
- 后续若增加人机中断、重试、更复杂分支，手写脚本的 refactor 成本往往更高。

因此选型更接近：**业务形态已是「状态机 + 共享黑板」**，LangGraph 是 **对口实现**，而不是为了贴「多 Agent」标签。

---

## 5. 边界说明

若产品永远只有 **固定的线性三步**（例如只做解析 → 测试 → 报告），引入 LangGraph 会显得偏重。

本项目的特点是：

- **计划由 LLM 生成**（`dependencies`、`canParallel`、多种 `assignTo`），执行顺序 **运行时才能确定**；
- 需要 **流式观测**、**合并状态**、**checkpoint 辅助收尾**。

在这些前提下，使用 LangGraph 比纯手写 Nest 内状态机 **更划算**。若仅追求功能等价，也可改为手写编排；本仓库选择 LangGraph 主要是为了 **reducer 状态语义、`Command` 动态路由、流式与 checkpoint、与 LangChain 一致** 的工程收益。

---

## 6. 相关代码与文档

| 资源 | 说明 |
|------|------|
| `packages/server/src/agents/graph.ts` | 图定义、`dispatcher`、节点边 |
| `packages/server/src/agents/state.ts` | `BrowserTestState`、任务与事件类型 |
| `packages/server/src/agents/graph-helpers.ts` | 可执行任务、依赖、flatten 等 |
| [product-architecture-overview.zh-CN.md](./product-architecture-overview.zh-CN.md) | 产品功能与整体架构 |
