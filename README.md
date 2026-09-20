# 单张纸直线裁切试排工具

给小型印刷店用的单张纸（单开料）排样试算网页：输入纸张尺寸、刀缝（咬口/锯缝）宽度和多种成品的尺寸与数量，自动在**一张纸**内生成可上机执行的**直线裁切（guillotine）布局**，并用 SVG 标注每件成品、旋转状态与每一刀的切割线和下刀顺序；排不下的件数单独列出，同时显示已排面积占比。

- 后端：Node.js + Express（唯一依赖 `express`）
- 前端：原生 HTML / CSS / JavaScript（无构建、无前端框架、无外部服务）

## 切割规则

1. **每次切割把当前矩形区域沿一条直线一分为二**（先分掉余料条，再从成品条上切出成品，即标准 guillotine 两步切法）；
2. 每件成品允许 **90° 旋转**摆放，图中右上角带 **↻** 角标表示旋转；
3. **刀缝宽度计入废料**：切刀的缝宽必须完全落在废料条内，绝不侵占成品。若某侧余料比刀缝还窄（下不去刀），该余料判为不可用死区，不会在该方向产生切割线；
4. 排样采用 best-fit 自由矩形启发式，并尝试 6 种排序策略取面积利用率最高者；
5. 排不下的成品按规格汇总，在黄色提示区单独列出件数。

## 一条命令启动（Docker Compose）

```bash
docker compose up -d --build
```

启动后浏览器访问：

```
http://localhost:3000
```

镜像在构建阶段已执行 `npm ci`（或回退 `npm install`）装好全部依赖，容器启动时**无需联网、不依赖任何外部服务或数据库**。

停止 / 删除：

```bash
docker compose down          # 停止并删除容器
docker compose up --build    # 改代码后重建
```

## 可选配置（均有默认值，不配也能跑）

| 配置项 | 位置 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `HOST_PORT` | 环境变量 / `.env` | `3000` | 宿主机映射端口，例如 `HOST_PORT=8080 docker compose up -d` |
| `PORT` | compose `environment` | `3000` | 容器内监听端口 |

自定义端口示例：

```bash
echo "HOST_PORT=8080" > .env && docker compose up -d --build
# 访问 http://localhost:8080
```

## 不用 Docker 的本地运行方式

需要 Node.js ≥ 18。

```bash
npm install
npm start
# 访问 http://localhost:3000
```

## 页面用法

1. 填写纸张宽度、高度（单位 mm）和刀缝宽度（无刀缝可填 0）；
2. 在成品清单中添加若干行：名称、成品宽、成品高、数量（名称可留空）；
3. 点击「开始试排」。

结果区展示：

- **已排面积占比**：所有已排下成品的面积之和 ÷ 纸张面积（进度条 + 百分比）；
- **已排 / 总数**：成品件数统计；
- **切割刀数**：需要下刀的次数，红色切刀上的数字即下刀顺序；
- **SVG 图**：白框为纸张；彩色矩形为成品（左上角圆点为成品规格编号，内部标注名称、原始尺寸和件序号，右上角 ↻ 表示该件旋转 90°）；红色区域为切刀刀缝（宽度按真实刀缝比例绘制），刀上数字为下刀顺序；
- **排不下的件数**：黄色提示区按成品规格列出，需要换更大纸张 / 减小刀缝 / 减少数量后重试。

## HTTP 接口

`POST /api/layout`

```json
{
  "sheetWidth": 889,
  "sheetHeight": 1194,
  "kerf": 3,
  "products": [
    { "name": "名片", "width": 90, "height": 54, "qty": 100 },
    { "name": "宣传单", "width": 210, "height": 297, "qty": 4 }
  ]
}
```

返回（节选）：

```json
{
  "sheet": { "width": 889, "height": 1194, "area": 1061466 },
  "kerf": 3,
  "placed": [
    { "productId": "p0", "name": "名片", "pieceIndex": 1,
      "width": 90, "height": 54, "x": 0, "y": 0, "w": 90, "h": 54, "rotated": false }
  ],
  "cuts": [
    { "orientation": "vertical", "order": 1,
      "x": 90, "y": 0, "length": 54,
      "rect": { "x": 90, "y": 0, "w": 3, "h": 54 } }
  ],
  "overflow": [],
  "stats": {
    "totalCount": 104, "placedCount": 104, "unplacedCount": 0,
    "usedArea": 736164, "sheetArea": 1061466,
    "usedRatio": 0.6935, "usedPercent": 69.35,
    "cutCount": 133
  }
}
```

- `placed[].w/h` 是实际占地尺寸（旋转后与 `width/height` 互换），`x/y` 为左上角坐标（原点在纸张左上角，y 向下）；
- `cuts[].rect` 是刀缝在纸上占据的矩形；`order` 即下刀顺序；
- `overflow` 为排不下的成品汇总（含 `qty`）；参数非法时接口返回 HTTP 400 与 `{ "error": "..." }`。

另有 `GET /api/health` 健康检查。

## 项目结构

```
.
├── Dockerfile              # node:20-alpine，构建时装好依赖
├── docker-compose.yml      # 一条命令启动，映射 3000 端口
├── package.json
├── server.js               # Express 静态服务 + /api/layout
├── src/
│   └── packer.js           # guillotine 排样核心（校验、分刀、多策略择优）
└── public/
    ├── index.html          # 输入表单 + 结果区
    ├── styles.css
    └── app.js              # 调接口、渲染统计与 SVG 布局图
```

## 说明与限制

- 排样目标为**单张纸**；多件同类成品超过一张纸容量的部分不会拆单到第二张纸，而是全部进入"排不下"清单，方便门店据此决定开几开料；
- 算法为启发式（best-fit + 多排序策略），不保证数学最优，但对常见名片、传单、卡片等矩形件利用率良好；
- 成品总数量上限 10 000 件（防止请求体过大）。
