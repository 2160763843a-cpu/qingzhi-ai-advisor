# 青智家 AI 顾问

面向青岛智慧家电消费场景的 AI 客服与营销转化平台（赛题演示）。

## 作品简介

本地混合 NLU 引擎驱动：对话咨询 → 需求识别 → 可解释推荐 → 对比决策 → 合规线索沉淀 → 运营数据分析。所有结论可追溯至用户槽位与商品结构化字段，不含通用大模型调用。

## 技术架构

* 前端：Vue 3 + TypeScript + Vite + Element Plus + Vue Router
* 引擎：本地规则 + 字符 2/3-gram kNN 统计分类（混合 NLU）
* 后端：Express（Node.js 22+），生产构建静态托管
* 存储：浏览器 localStorage（会话 / 对比 / 线索 / 分析事件 / 审计）
* 图表：轻量 CSS 条形图（无外部图表库）

## 获取源码

本仓库直接公开源码目录，不需要先下载压缩包才能查看代码。可从下面的入口直接浏览：

* [页面与应用入口](frontend/src/)：Vue 页面、路由与状态管理。
* [对话与推荐引擎](frontend/src/engine/)：意图识别、条件提取、追问、推荐、预算与安全处理。
* [模拟商品与评测数据](data/)：商品、FAQ 和模拟测试集。
* [测试与检查脚本](scripts/)：业务回归、布局、运行时与部署一致性检查。
* [开发与能力审计说明](docs/)：阶段审计与能力边界记录。
* [服务端入口](server.mjs)与[安装及构建配置](package.json)。

若需在本地运行，可使用 GitHub 的 `Code → Download ZIP` 下载并解压，或使用仓库页面提供的 HTTPS 地址克隆。以下命令均在项目根目录（包含 `package.json` 的目录）执行。

仓库不提交依赖安装目录、构建产物、运行日志或私人凭据；首次运行需要先安装依赖并完成构建。

## 环境要求

* Node.js ≥ 22（需支持 TS 类型剥离）
* npm ≥ 10

## 安装与启动

```bash
npm ci               # 按锁文件安装依赖
npm run build        # 生产构建（Vite → dist/）
npm start            # 前台启动服务，默认端口 3000
```

启动后访问 http://localhost:3000 。以上命令适用于安装了相应 Node.js 与 npm 的 Windows、macOS 或 Linux 环境。

如需使用原项目的后台启动与健康检查脚本，可在 Linux、macOS 或 Windows 的 Git Bash／WSL 中执行 `bash start.sh`。脚本需要 Bash 和 curl；`stop.sh` 同样需要兼容的 Shell 环境。

## 停止

使用 `npm start` 前台运行时，在该终端按 `Ctrl+C` 停止。通过后台脚本启动的服务，在同一类 Shell 环境中执行：

```bash
bash stop.sh
```

## 测试

```bash
node scripts/validate-data.mjs          # 数据校验
node scripts/run-intent-eval.mjs         # 意图评测
node scripts/run-context-tests.mjs       # 上下文回归
node scripts/test-dialogue-states.mjs    # 状态机
node scripts/test-round10-fixes.mjs      # 偏好/预算
node scripts/test-compare.mjs            # 对比引擎
node scripts/test-compare-reactive.mjs   # 响应式 Store
node scripts/test-leads.mjs              # 线索沉淀
node scripts/test-dashboard.mjs          # 看板指标
node scripts/test-dashboard-dom.mjs      # 看板 DOM 渲染
node scripts/test-release-blockers.mjs   # 发布阻断收口
node scripts/test-runtime-smoke.mjs      # 运行时冒烟
node scripts/test-safety.mjs             # 安全拦截
node scripts/test-kb.mjs                 # 知识库
node scripts/test-holdout.mjs            # 自由表达留出
node scripts/run-recommend-eval.mjs      # 推荐评测
node scripts/test-empty-results.mjs      # 无结果
node scripts/test-weights.mjs            # 权重
node scripts/test-budget-semantics.mjs   # 预算语义
node scripts/test-budget-comparators.mjs # 预算比较符
node scripts/audit-layout.mjs            # 布局审计
node scripts/scan-visible-artifacts.mjs  # 异常值扫描
node scripts/check-deployed-build.mjs    # 部署一致性
```

## 能力边界

* **运行时 NLU**：本地混合 NLU（规则 + 统计），不是通用大模型；无外部 API 调用
* **商品与经营数据**：全部为模拟数据，不代表真实业务成果
* **数据存储**：仅保存在当前浏览器 localStorage，不会提交给任何真实企业
* **角色切换**：演示权限（消费者视角 / 运营视角），不是真实登录鉴权
* **联系方式**：仅使用模拟号码；默认脱敏显示；用户可随时撤回或删除

## 在线体验

https://3000-7600686dcbef017a.code.cosmoplat.cn

## 许可证

本项目原创源码采用 MIT 许可证，详见仓库根目录的 LICENSE 文件。第三方依赖遵循各自的许可证。
