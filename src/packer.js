'use strict';

/**
 * 单张纸直线裁切（guillotine）排样核心算法。
 *
 * 规则：
 *  - 每次切割必须把当前的一个矩形区域沿整条直线一分为二（刀缝 k 计入废料）。
 *  - 成品允许旋转 90°。
 *  - 切刀的刀缝宽度 k 必须落在废料条内，不得侵占任何成品；
 *    若某侧余料宽度小于刀缝（放不下刀），该余料视为不可用死区，不产生该方向切割线。
 *  - 排不下的件数按成品规格汇总返回。
 *
 * 采用 best-fit 自由矩形 + 两种分法（竖分/横分）择优，并尝试多种排序策略取最优。
 */

const EPS = 1e-6;
const MAX_PIECES = 10000;

/* ------------------------------ 输入校验 ------------------------------ */

function num(v, field, { min = 0, allowZero = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`参数 ${field} 必须是数字`);
  if (n < min - EPS) throw new Error(`参数 ${field} 不能小于 ${min}`);
  if (!allowZero && n <= EPS) throw new Error(`参数 ${field} 必须大于 0`);
  return n;
}

function intNum(v, field, min = 0) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n - Math.round(n)) > EPS) {
    throw new Error(`参数 ${field} 必须是整数`);
  }
  if (n < min) throw new Error(`参数 ${field} 不能小于 ${min}`);
  return Math.round(n);
}

/**
 * 规范化并校验请求体。
 * @returns {{sheetWidth:number, sheetHeight:number, kerf:number,
 *           products:Array<{id:string,name:string,width:number,height:number,qty:number}>}}
 */
function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('请求体必须是 JSON 对象');

  const sheetWidth = num(input.sheetWidth, '纸张宽度');
  const sheetHeight = num(input.sheetHeight, '纸张高度');
  const kerf = num(input.kerf, '刀缝宽度', { min: 0, allowZero: true });

  const rawProducts = input.products;
  if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
    throw new Error('至少需要一种成品');
  }

  let total = 0;
  const products = rawProducts.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`第 ${i + 1} 种成品数据格式不正确`);
    const width = num(p.width, `成品${i + 1}宽度`);
    const height = num(p.height, `成品${i + 1}高度`);
    const qty = intNum(p.qty, `成品${i + 1}数量`, 0);
    const name = typeof p.name === 'string' && p.name.trim()
      ? p.name.trim().slice(0, 40)
      : `成品 ${i + 1}`;
    total += qty;
    return { id: `p${i}`, name, width, height, qty };
  });

  if (total > MAX_PIECES) {
    throw new Error(`成品总数量不能超过 ${MAX_PIECES} 件`);
  }

  return { sheetWidth, sheetHeight, kerf, products };
}

/* ------------------------------ 排样引擎 ------------------------------ */

/**
 * 把一件成品放入自由矩形 f，返回两种合法分法（竖分 A / 横分 B）。
 * 每种分法包含切刀几何、新生的自由矩形、评分（越大越优）。
 */
function placementsFor(f, item, kerf) {
  const result = [];

  for (const rotated of [false, true]) {
    const w = rotated ? item.height : item.width;
    const h = rotated ? item.width : item.height;
    if (w > f.w + EPS || h > f.h + EPS) continue;

    const rw = f.w - w; // 右侧余料宽度
    const rb = f.h - h; // 底部余料高度

    // 方案 A：先竖切一刀（x = f.x + w），分出成品所在左条；再横切左条分出成品
    // 方案 B：先横切一刀（y = f.y + h），分出成品所在顶条；再竖切顶条分出成品
    const vFit = rw <= EPS || rw + EPS >= kerf; // 竖刀的刀缝能否落在右余料里
    const hFit = rb <= EPS || rb + EPS >= kerf; // 横刀的刀缝能否落在底余料里

    const base = {
      rotated,
      w,
      h,
      rect: { x: f.x, y: f.y, w, h },
      rw,
      rb,
    };

    // 方案 A：竖切可行（成品右边界必须完整露出刀缝空间）
    if (vFit) {
      const cuts = [];
      const frees = [];
      let score = 0;

      if (rw > EPS) {
        // 整条竖刀：x 位于 [f.x+w, f.x+w+kerf]，刀缝完全在右废料条内
        cuts.push({
          orientation: 'vertical',
          x: f.x + w,
          y: f.y,
          length: f.h,
          rect: { x: f.x + w, y: f.y, w: kerf, h: f.h },
        });
        frees.push({ x: f.x + w + kerf, y: f.y, w: rw - kerf, h: f.h });
      }
      if (rb > EPS && hFit) {
        // 第二刀只在左条内横切（右条已独立），刀缝落在底部废料内
        cuts.push({
          orientation: 'horizontal',
          x: f.x,
          y: f.y + h,
          length: w,
          rect: { x: f.x, y: f.y + h, w, h: kerf },
        });
        frees.push({ x: f.x, y: f.y + h + kerf, w, h: rb - kerf });
        score += w * Math.max(0, rb - kerf);
      } else if (rb > EPS) {
        // 底条窄于刀缝：死区，不分出（保持为已划分区域的一部分，不可再利用）
      }
      if (rw > EPS) score += Math.max(0, rw - kerf) * f.h;

      result.push({ ...base, mode: 'A', cuts, frees, score });
    }

    // 方案 B：横切可行
    if (hFit) {
      const cuts = [];
      const frees = [];
      let score = 0;

      if (rb > EPS) {
        cuts.push({
          orientation: 'horizontal',
          x: f.x,
          y: f.y + h,
          length: f.w,
          rect: { x: f.x, y: f.y + h, w: f.w, h: kerf },
        });
        frees.push({ x: f.x, y: f.y + h + kerf, w: f.w, h: rb - kerf });
      }
      if (rw > EPS && vFit) {
        // 第二刀只在顶条内竖切
        cuts.push({
          orientation: 'vertical',
          x: f.x + w,
          y: f.y,
          length: h,
          rect: { x: f.x + w, y: f.y, w: kerf, h },
        });
        frees.push({ x: f.x + w + kerf, y: f.y, w: rw - kerf, h });
        score += h * Math.max(0, rw - kerf);
      } else if (rw > EPS) {
        // 右条窄于刀缝：死区
      }
      if (rb > EPS) score += f.w * Math.max(0, rb - kerf);

      result.push({ ...base, mode: 'B', cuts, frees, score });
    }
  }

  return result;
}

/**
 * 按给定的展开件列表执行一次排样。
 * @returns {{placed:Array, cuts:Array, usedArea:number, placedCount:number, unplacedItems:Array}}
 */
function runPacking(items, sheetWidth, sheetHeight, kerf) {
  const freeRects = [{ x: 0, y: 0, w: sheetWidth, h: sheetHeight }];
  const placed = [];
  const cuts = [];
  const unplacedItems = [];
  let usedArea = 0;

  for (const item of items) {
    let best = null;
    let bestFi = -1;

    for (let fi = 0; fi < freeRects.length; fi++) {
      const f = freeRects[fi];
      for (const p of placementsFor(f, item, kerf)) {
        // best-fit：浪费面积最小；其次切后可利用余料评分最高；
        // 再其次不旋转优先、靠左上角优先，保证结果稳定
        const waste = f.w * f.h - p.w * p.h;
        const key = [
          waste,
          -p.score,
          p.rotated ? 1 : 0,
          f.x + f.y,
          f.x,
        ];
        if (!best || compareKey(key, best._key) < 0) {
          best = p;
          best._key = key;
          bestFi = fi;
        }
      }
    }

    if (!best) {
      unplacedItems.push(item);
      continue;
    }

    freeRects.splice(bestFi, 1);
    for (const r of best.frees) {
      if (r.w > EPS && r.h > EPS) freeRects.push(r);
    }

    const order0 = cuts.length;
    best.cuts.forEach((c, i) => {
      cuts.push({ ...c, order: order0 + i + 1 });
    });

    placed.push({
      uid: item.uid,
      productId: item.productId,
      name: item.name,
      pieceIndex: item.index,
      width: item.width,
      height: item.height,
      x: best.rect.x,
      y: best.rect.y,
      w: best.w,
      h: best.h,
      rotated: best.rotated,
    });
    usedArea += item.width * item.height;
  }

  return { placed, cuts, usedArea, placedCount: placed.length, unplacedItems };
}

function compareKey(a, b) {
  for (let i = 0; i < a.length; i++) {
    const tol = i < 2 ? EPS : 0; // 面积类浮点分量用容差，其余为整数
    if (a[i] < b[i] - tol) return -1;
    if (a[i] > b[i] + tol) return 1;
  }
  return 0;
}

/* ------------------------------ 多策略择优 ------------------------------ */

function expand(products) {
  const items = [];
  let seq = 0;
  products.forEach((p) => {
    for (let i = 0; i < p.qty; i++) {
      items.push({
        uid: seq,
        productId: p.id,
        name: p.name,
        width: p.width,
        height: p.height,
        index: i + 1,
      });
      seq++;
    }
  });
  return items;
}

const STRATEGIES = [
  // 面积降序（大件优先）
  (it) => -(it.width * it.height),
  // 长边降序
  (it) => -Math.max(it.width, it.height),
  // 短边降序
  (it) => -Math.min(it.width, it.height),
  // 宽边降序、再高边
  (it) => [-it.width, -it.height],
  // 高边降序、再宽边
  (it) => [-it.height, -it.width],
  // 周长降序
  (it) => -(it.width + it.height),
];

/**
 * 主入口：计算排样方案。
 */
function solve(rawInput) {
  const { sheetWidth, sheetHeight, kerf, products } = validate(rawInput);
  const items = expand(products);
  const sheetArea = sheetWidth * sheetHeight;

  let bestRun = null;

  if (items.length > 0) {
    for (const keyFn of STRATEGIES) {
      const ordered = items
        .map((it, i) => ({ it, i, k: keyFn(it) }))
        .sort((a, b) => {
          const ka = Array.isArray(a.k) ? a.k : [a.k];
          const kb = Array.isArray(b.k) ? b.k : [b.k];
          for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
            const d = (ka[i] ?? 0) - (kb[i] ?? 0);
            if (d !== 0) return d;
          }
          return a.i - b.i;
        })
        .map((r) => r.it);

      const run = runPacking(ordered, sheetWidth, sheetHeight, kerf);
      if (
        !bestRun ||
        run.usedArea > bestRun.usedArea + EPS ||
        (Math.abs(run.usedArea - bestRun.usedArea) <= EPS &&
          run.placedCount > bestRun.placedCount)
      ) {
        bestRun = run;
      }
    }
  } else {
    bestRun = { placed: [], cuts: [], usedArea: 0, placedCount: 0, unplacedItems: [] };
  }

  // 未排下的件按成品规格汇总
  const missingMap = new Map();
  for (const it of bestRun.unplacedItems) {
    const key = it.productId;
    if (!missingMap.has(key)) {
      const p = products.find((pp) => pp.id === key);
      missingMap.set(key, {
        productId: key,
        name: it.name,
        width: p.width,
        height: p.height,
        qty: 0,
      });
    }
    missingMap.get(key).qty += 1;
  }

  const totalCount = items.length;
  const usedRatio = sheetArea > 0 ? bestRun.usedArea / sheetArea : 0;

  return {
    sheet: { width: sheetWidth, height: sheetHeight, area: sheetArea },
    kerf,
    products: products.map((p, i) => ({
      id: p.id,
      name: p.name,
      width: p.width,
      height: p.height,
      qty: p.qty,
      label: `${p.name} ${Math.round(p.width * 10) / 10}×${Math.round(p.height * 10) / 10}`,
      index: i + 1,
    })),
    placed: bestRun.placed,
    cuts: bestRun.cuts,
    overflow: [...missingMap.values()],
    stats: {
      totalCount,
      placedCount: bestRun.placedCount,
      unplacedCount: totalCount - bestRun.placedCount,
      usedArea: bestRun.usedArea,
      sheetArea,
      usedRatio,
      usedPercent: usedRatio * 100,
      cutCount: bestRun.cuts.length,
    },
  };
}

module.exports = { solve, validate };
