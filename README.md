<p align="center"><img src="app/src-tauri/icons/128x128.png" alt="Feed Me Token 图标" width="96" height="96" /></p>

# Feed Me Token

**把 Codex 用掉的 token，喂给桌面上的贪吃小女孩。**

Feed Me Token 是一款正在开发的桌面挂机小游戏。它读取本机 Codex 新增的 token 用量，让 token 从左侧管道进入生产机并变成能量棒。能量棒在主角旁堆积，角色从堆里取棒吃下后伸手发射短射线，击败显示器头机器人，获得金币和经验，再用金币提升攻击力。

> **项目状态：MVP 原型。** Windows 皮肤版已编译并生成安装包，原生窗口交互仍待验收；macOS 运行与打包需真机验证。当前提供两套原创占位像素图集，正式像素精灵尚未完成。仓库暂未发布可下载的 Release。

## 当前玩法

1. 首次启动时为已有 Codex 日志建立基线，游戏计数从 **0** 开始，不兑换历史用量。
2. 之后每 60 秒读取一次本地记录，也可以手动刷新。每新增 **1,000 个 `total_tokens`** 兑换一根能量棒，不足部分结转。新增 token 会触发管道输入与机器出棒动画；已兑换能量棒堆在机器和主角之间，库存以控制栏数字为准。
3. 机器人从右侧走入，前 20 波默认一击倒下；下一只随即入场。角色从堆里取棒、吃下，再自动攻击，击败敌人获得金币和经验；经验自动升级，金币可购买攻击力。
4. 没有能量棒时角色待机。进度保存在本机，重启后继续；重复刷新不会为同一批用量重复发奖。

窗口支持拖动、置顶切换、最小化、退出、托盘显示与隐藏、静音切换。拖动战斗场景可移动窗口；下方状态面板可查看 Codex 连接状态、启用后的 token、最近刷新时间，并在“薄荷机房”和“蜜桃终端”两套占位皮肤间切换。皮肤选择会保存，不改变玩法数值。

## 本地运行

需要 Node.js、Rust，以及 [Tauri 2 对应平台的系统依赖](https://v2.tauri.app/start/prerequisites/)。Windows 运行环境需要 WebView2。

```sh
cd app
npm ci
npm run tauri dev
```

只看画面与模拟战斗，可以运行浏览器预览：

```sh
cd app
npm ci
npm run dev
```

浏览器预览初始有独立的 5 根模拟能量棒；点击刷新按钮会模拟新增 2,500 token，方便查看生产动画，**不读取或修改 Codex 数据**。构建与测试命令：

```sh
cd app
npm run build
cd src-tauri
cargo test
```

Windows 安装包可在 Windows 开发机上用 `cd app && npm run tauri build -- --bundles nsis` 构建。macOS 包需要在 Mac 上构建和验证。

玩法数值、生产与战斗节奏、浏览器预览参数统一写在 [`app/game-config.json`](app/game-config.json)。美术资源另由皮肤清单与透明 PNG 图集配置；替换方法见[皮肤资源说明](docs/皮肤资源说明.md)。修改后运行 `cd app && npm run check:config`，再重新构建应用；玩法字段含义和旧存档影响见[配置说明](docs/配置说明.md)。

## 数据与隐私

- MVP 只支持 **Codex**。Rust 模块只读扫描 `CODEX_HOME`（如已设置）或默认的 `~/.codex` 下的 `sessions`、`archived_sessions` 日志。
- 只提取 `token_count` 事件中的用量数值与时间，不将提示词或对话正文传给前端；应用不上传用量数据。
- 游戏存档位于系统的应用数据目录。运行时无需安装 ccusage，也无需连接网络；[ccusage](https://github.com/ccusage/ccusage) 仅作为本地用量读取方案的参考。

## 技术与文档

桌面外壳使用 **Tauri 2**，本地日志读取与存档使用 **Rust**，界面和战斗画面使用 **TypeScript + PixiJS**。

| 路径 | 内容 |
| --- | --- |
| [`app/`](app/) | 应用源码、依赖锁文件及运行说明 |
| [`docs/Feed-Me-Token-MVP-实施文档.md`](docs/Feed-Me-Token-MVP-实施文档.md) | MVP 规则、技术方案、验收标准与当前验证结果 |
| [`docs/开发记录.md`](docs/开发记录.md) | 决策变更、实现状态、验证结果与后续遗留事项 |
| [`docs/配置说明.md`](docs/配置说明.md) | 玩法数值配置项、单位、校验规则与存档影响 |
| [`docs/皮肤资源说明.md`](docs/皮肤资源说明.md) | 内置皮肤目录、图集格式、替换步骤与存档回退 |
| [`docs/Feed-Me-Token-MVP-设计草案.md`](docs/Feed-Me-Token-MVP-设计草案.md) | 产品范围与玩法设计过程 |
| [`docs/Feed-Me-Token-角色美术设定.md`](docs/Feed-Me-Token-角色美术设定.md) | 主角、机器人与动作的原创美术方向 |

## 下一步

- 在真实 Mac 上验证 Codex 读取、透明窗口、托盘和发行包。
- 完成主角与机器人正式像素精灵，并检查 Windows 原生窗口的完整交互与不同壁纸下的可读性。
- 在 MVP 稳定后研究 **Cursor** 与 **WorkBuddy** 的真实 token 数据来源，再分别接入。
