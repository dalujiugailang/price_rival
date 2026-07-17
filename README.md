# 线上竞争追价系统

用于手机安卓回收业务的竞品追价测算、竞争力落数、历史趋势和竞争投入费率估算。系统以 `ppv` 为核心粒度，保留上传底表的原始字段，同时生成线上追价后的价格、利润、竞争力和投入费率结果。

## 功能范围

- 上传本次竞争追价表，作为当前工作台明细。
- 通过 daily price API 按 `ppv` 匹配 JD 最终报价和 BI 基准价。
- 上传补贴表，按新机系列和价格门槛动态匹配 AHS 投入与京东补贴。
- 按边际利润率底线或 `100%竞争力` 模式生成追价建议。
- 保存测算快照，并可确认当前批次为某一日期的正式竞争力落数。
- 展示历史竞争力趋势和历史快照。
- 计算本次竞争预估投入费用和两个投入费率。
- 导出包含原始字段和线上计算字段的追价表。

## 运行

安装依赖：

```bash
npm install
```

本地开发：

```bash
npm run dev
```

本地会同时启动 `3000` 端口的 Vite 页面和 `3001` 端口的 Express API。开发环境默认开启“本地验收登录”，生产环境无法使用该入口。

类型检查：

```bash
npm run lint
```

生产构建：

```bash
npm run build
```

服务端模式：

```bash
npm run build
npm start
```

服务端会托管 `dist`，并提供飞书登录、共享历史、审计日志和 `/api/daily-price/lookup` 代理。

## Docker 部署

云服务器安装 Docker 和 Docker Compose 后，在项目目录创建 `.env`：

```bash
DAILY_PRICE_LOOKUP_URL=https://daily-price.gtmdudu.xyz/api/lookup
DAILY_PRICE_TOKEN=你的 daily price token
APP_PORT=3000
APP_URL=https://你的域名
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=你的应用密钥
FEISHU_ALLOWED_DEPARTMENT_IDS=od-xxx,od-yyy
```

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://服务器IP:3000
```

如需换外部端口，只改 `.env` 里的 `APP_PORT`。容器内部固定监听 `3000`。

## 环境变量

Express server 支持以下变量：

- `PORT`: 服务端端口，默认 `3000`。
- `HOST`: 监听地址，默认 `0.0.0.0`。
- `DAILY_PRICE_LOOKUP_URL`: daily price 上游接口，默认 `https://daily-price.gtmdudu.xyz/api/lookup`。
- `DAILY_PRICE_TOKEN` / `DAILY_PRICE_API_TOKEN`: daily price API token。
- `DATABASE_PATH`: SQLite 数据库路径，Docker 内默认为 `/app/data/price-rival.sqlite`。
- `APP_URL`: 系统对外地址，用于 OAuth 回调和 Cookie 安全策略。
- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`: 飞书自建应用凭证。
- `FEISHU_REDIRECT_URI`: 飞书 OAuth 回调地址，不填时使用 `${APP_URL}/api/auth/feishu/callback`。
- `FEISHU_ALLOWED_DEPARTMENT_IDS`: 允许登录的 `open_department_id`，多个逗号分隔。
- `FEISHU_ALLOWED_OPEN_IDS`: 个人白名单，主要用于管理员例外。
- `FEISHU_ALLOWED_TENANT_KEYS`: 可选的租户二次校验。

可以放在 `.env.local` 或 `.env`。

## 数据入口

### 1. 本次竞争追价表

上传后替换当前工作台明细，并保留所有源字段。

核心字段：

- `新机系列`
- `旧机型号`
- `ppv`
- `ppv近30天报价量`
- `ppv近30天成交量`
- `jd裸机价`
- `对应新品型号ahs投入`
- `京东总补贴`
- `tm裸机价`
- `tm总补贴-人工`
- `zz裸机价`
- `zz券后价` / `转转券后价`
- `基准价`

`ppv近30天报价量` 用于竞争力加权，`ppv近30天成交量` 用于竞争投入费用估算。

### 2. daily price API

不需要上传文件。系统通过 `/api/daily-price/lookup` 按 `ppv` 匹配：

- 最终报价 -> `jd裸机价`
- BI 基准价 -> `基准价`

### 3. 补贴表

按 `新机系列` 和 JD 价格门槛匹配。命中规则后用于计算：

- 当前 AHS 投入
- 当前京东总补贴
- 追价后的 AHS 投入
- 追价后的京东总补贴

### 4. 历史竞争力

页面不再提供历史竞争力上传卡片。历史数据如需导入，直接在 Codex 对话里上传，由后续流程写入历史落数。

## 追价计算逻辑

核心代码：`src/utils/formulas.ts`

### 价格定义

- `含AHS补贴后报价 = jd裸机价 + AHS投入`
- `jd总到手价 = jd裸机价 + 京东总补贴`
- `tm总到手价 = tm裸机价 + tm总补贴-人工`
- `zz券后价` 优先读取源字段 `zz券后价` / `转转券后价`，没有时按 `zz裸机价 + zz券` 兜底。
- `追后含AHS补贴后报价 = 京东物品价-追价后 + ahs承担补贴-追价后`
- `追后jd总到手价 = 京东物品价-追价后 + 追后京东总补贴`

### 费用和利润

线性费用：

```text
(追价后京东物品价 + AHS补贴) * 4.66% + 基准价 * 2.18% + 81
```

边际利润率：

```text
1 - (京东物品价 + AHS补贴 + 线性费用) / 基准价
```

### 边际底线模式

1. 如果追前边际利润率 `<= 0`，不调整。
2. 如果 `jd裸机价 >= tm裸机价`，不调整。
3. 否则优先追到 `tm裸机价 + 2`。
4. 如果追到 `tm裸机价 + 2` 后仍满足边际底线，采用该价格。
5. 如果不满足边际底线，按补贴门槛区间反推最高达标追价。

### 100%竞争力模式

1. 如果 `tm裸机价` 缺失，不调整。
2. 如果 `jd裸机价 >= tm裸机价`，不调整。
3. 否则强制追到 `tm裸机价 + 2`。
4. 追价后补贴、线性费用、边际利润率仍会重算。

## 竞争力口径

核心代码：`src/utils/competitiveness.ts`

竞争力按 `ppv近30天报价量` 加权：

```text
竞争力 = 有竞争力 PPV 的近30天报价量 / 有效竞品 PPV 的近30天报价量
```

四个正式追后指标：

- 天猫物品价竞争力：`京东物品价-追价后 > tm裸机价`
- 天猫到手价竞争力：`追后jd总到手价 > tm总到手价`
- 转转物品价竞争力：`京东物品价-追价后 > zz裸机价`
- AHS补贴后 vs 转转到手价：`追后含AHS补贴后报价 > zz券后价`

比较符使用严格 `>`，不是 `>=`。

保存快照时可以勾选“确认为竞争力落数”。确认后：

- 当前批次成为该落数日期的正式竞争力结果。
- 同一落数日期已有的正式记录会被降级为非正式。
- 历史趋势默认使用正式落数。

## 竞争预估投入费用和费率

核心代码：`src/utils/investment.ts`

页面中的 `竞争预计投入费率测算` 面板有两个输入：

- 手机安卓近30天回收预估销售总额
- 手机安卓近30天京东换新渠道销售额

输入后不会立即刷新费率，需要点击 `计算费率`。

只统计有正向追价的 PPV：

```text
京东物品价-追价后调整金额 > 0
```

单行投入：

```text
京东物品价-追价后调整金额 * ppv近30天成交量
```

总投入：

```text
竞争预估投入费用 = 所有正向追价 PPV 的单行投入求和
```

费率：

```text
手机安卓大盘竞争投入费率 = 竞争预估投入费用 / 手机安卓近30天回收预估销售总额
手机安卓换新渠道竞争投入费率 = 竞争预估投入费用 / 手机安卓近30天京东换新渠道销售额
```

保存快照时会把最近一次点击 `计算费率` 后的输入值和结果写入历史快照。

## 历史和导出

历史快照保存在服务器 SQLite 中，其他白名单用户登录后可以查看。浏览器中的旧历史会在首次登录后幂等迁移，按批次 ID 去重，不会用旧记录覆盖较新正式落数。快照内容包括：

- 当前测算模式
- 边际利润率底线
- 当前全部追价明细
- 源字段快照
- 补贴文件信息
- 正式竞争力落数信息
- 投入费率输入和结果

服务端保留登录成功/失败/拒绝、历史迁移、快照保存、正式落数、删除及失败操作日志。删除为软删除，审计日志不随快照删除。

导出追价表会包含源字段和线上计算字段，例如：

- `线上_测算模式`
- `线上_ppv近30天成交量`
- `线上_推荐追价后京东物品价`
- `线上_调整金额`
- `线上_本次竞争调整预估投入金额`
- `线上_追后含AHS补贴后报价`
- `线上_追后京东到手价`
- `线上_追后边际利润率`
- `线上_追后天猫物品价竞争力`
- `线上_追后天猫到手价竞争力`
- `线上_追后转转物品价竞争力`
- `线上_追后AHS对转转到手竞争力`

## UI 约定

- 整体保持硬边框工业风：黑色边框、灰白底、无圆角。
- 顶部图表保持原比例，不因新增面板被拉高。
- 费率测算面板放在 `竞争追价控制台` 上方，结构与控制台一致：白底外框、灰色标题栏、黑色分隔线。
- 图表横轴可以显示短型号，但 hover tooltip 必须显示完整型号。

## 主要文件

- `src/App.tsx`: 全局状态、历史快照、上传结果整合。
- `src/components/DashboardStats.tsx`: 顶部报价空间图和 KPI 卡片。
- `src/components/InvestmentRatePanel.tsx`: 竞争预估投入费用和费率测算。
- `src/components/MainTable.tsx`: 追价控制台、保存快照、导出。
- `src/components/UploadSection.tsx`: 当前数据上传和匹配入口。
- `src/components/CompetitivenessSummary.tsx`: 竞争力走势和总结。
- `src/components/HistoryPanel.tsx`: 历史快照查看和导出。
- `src/components/AuthGate.tsx`: 飞书/本地验收登录门禁。
- `src/components/AuditLogPanel.tsx`: 服务端操作日志查看。
- `src/utils/formulas.ts`: 追价、补贴、利润、竞争判断公式。
- `src/utils/competitiveness.ts`: 竞争力加权计算。
- `src/utils/investment.ts`: 投入费用和费率计算。
- `server/index.mjs`: 认证门禁、共享历史 API、daily price 代理和静态资源服务。
- `server/auth.mjs`: 飞书 OAuth、部门白名单和 HttpOnly 会话。
- `server/database.mjs`: SQLite 建表、落数事务、迁移和审计日志。
