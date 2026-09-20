'use strict';

const rowsEl = document.getElementById('productRows');
const errorBox = document.getElementById('errorBox');
const svgWrap = document.getElementById('svgWrap');

const PALETTE = [
  { fill: '#dbeafe', stroke: '#1d4ed8' },
  { fill: '#dcfce7', stroke: '#15803d' },
  { fill: '#fef3c7', stroke: '#b45309' },
  { fill: '#fce7f3', stroke: '#be185d' },
  { fill: '#ede9fe', stroke: '#6d28d9' },
  { fill: '#cffafe', stroke: '#0e7490' },
  { fill: '#ffedd5', stroke: '#c2410c' },
  { fill: '#fee2e2', stroke: '#b91c1c' },
  { fill: '#d1fae5', stroke: '#047857' },
  { fill: '#e0e7ff', stroke: '#4338ca' },
];

/* ---------------- 成品行管理 ---------------- */

function addProductRow({ name = '', width = '', height = '', qty = '' } = {}) {
  const row = document.createElement('div');
  row.className = 'product-row';
  row.innerHTML = `
    <input class="name-input" type="text" maxlength="40" placeholder="成品名称" />
    <input type="number" min="0.01" step="1" placeholder="宽 mm" />
    <input type="number" min="0.01" step="1" placeholder="高 mm" />
    <input type="number" min="0" step="1" placeholder="数量" />
    <button type="button" class="btn-danger" title="删除">✕</button>
  `;
  const [nameI, wI, hI, qI] = row.querySelectorAll('input');
  nameI.value = name;
  wI.value = width;
  hI.value = height;
  qI.value = qty;
  row.querySelector('.btn-danger').addEventListener('click', () => row.remove());
  rowsEl.appendChild(row);
}

document.getElementById('addProduct').addEventListener('click', () => addProductRow());
document.getElementById('clearBtn').addEventListener('click', () => {
  rowsEl.innerHTML = '';
  addProductRow();
});

// 预置示例：大度全开机 889×1194，名片 + 宣传单
addProductRow({ name: '名片', width: 90, height: 54, qty: 100 });
addProductRow({ name: '宣传单 A4', width: 210, height: 297, qty: 4 });

/* ---------------- 提交 ---------------- */

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

document.getElementById('runBtn').addEventListener('click', async () => {
  clearError();

  const payload = {
    sheetWidth: Number(document.getElementById('sheetWidth').value),
    sheetHeight: Number(document.getElementById('sheetHeight').value),
    kerf: Number(document.getElementById('kerf').value),
    products: [...rowsEl.querySelectorAll('.product-row')].map((row) => {
      const [name, w, h, qty] = row.querySelectorAll('input');
      return { name: name.value.trim(), width: Number(w.value), height: Number(h.value), qty: Number(qty.value) };
    }),
  };

  let data;
  try {
    const resp = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '排样失败');
  } catch (err) {
    showError(err.message);
    return;
  }

  renderStats(data);
  renderOverflow(data);
  renderLegend(data);
  renderSvg(data);
});

/* ---------------- 统计 ---------------- */

const fmt = (n) => Math.round(n).toLocaleString('zh-CN');

function renderStats(data) {
  const { stats } = data;
  document.getElementById('statRatio').textContent = `${stats.usedPercent.toFixed(1)}%`;
  document.getElementById('progressBar').style.width = `${Math.min(100, stats.usedPercent)}%`;
  document.getElementById('statPlaced').textContent = `${stats.placedCount} / ${stats.totalCount} 件`;
  document.getElementById('statCuts').textContent = `${stats.cutCount} 刀`;
  document.getElementById('statArea').textContent =
    `${fmt(stats.usedArea)} / ${fmt(stats.sheetArea)} mm²`;
}

function renderOverflow(data) {
  const box = document.getElementById('overflowBox');
  if (!data.overflow.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const total = data.overflow.reduce((s, p) => s + p.qty, 0);
  box.hidden = false;
  box.innerHTML = `<strong>⚠ 有 ${total} 件排不下：</strong>
    <ul>${data.overflow
      .map((p) => `<li>${escapeHtml(p.name)}（${p.width}×${p.height} mm）：<strong>${p.qty}</strong> 件</li>`)
      .join('')}</ul>
    可尝试加大纸张、缩小刀缝或减少该成品数量。`;
}

const PRODUCT_INDEX = {};

function renderLegend(data) {
  const legend = document.getElementById('legend');
  legend.querySelectorAll('.product-chip').forEach((n) => n.remove());
  data.products.forEach((p, i) => {
    PRODUCT_INDEX[p.id] = p.index;
    const c = PALETTE[i % PALETTE.length];
    const chip = document.createElement('span');
    chip.className = 'product-chip';
    chip.innerHTML =
      `<i class="swatch" style="background:${c.fill};border:1px solid ${c.stroke}"></i>` +
      `${p.index}. ${escapeHtml(p.label)} × ${p.qty}`;
    legend.appendChild(chip);
  });
  legend.hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ---------------- SVG 渲染 ---------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderSvg(data) {
  svgWrap.innerHTML = '';
  const W = data.sheet.width;
  const H = data.sheet.height;
  const kerf = data.kerf;
  const pad = Math.max(40, Math.min(W, H) * 0.08);

  // 显示缩放：按毫米 1:1 建模，再整体缩放到屏幕
  const scale = Math.min(1000 / (W + 2 * pad), 1000 / (H + 2 * pad), 1.6);

  const svg = svgEl('svg', {
    viewBox: `${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`,
    width: (W + 2 * pad) * scale,
    height: (H + 2 * pad) * scale,
    role: 'img',
  });

  const frameStroke = Math.min(Math.max(Math.min(W, H) / 500, 0.8), 3);
  const itemStrokeW = Math.min(Math.max(Math.min(W, H) / 1200, 0.4), 1.4);
  const labelFs = Math.min(Math.max(Math.min(W, H) * 0.028, 4), 11);
  const badgeR = Math.min(Math.max(labelFs * 0.95, 2.6), 6);

  // 纸张
  svg.appendChild(svgEl('rect', {
    x: 0, y: 0, width: W, height: H,
    fill: '#ffffff', stroke: '#1f2933', 'stroke-width': frameStroke,
  }));

  // 成品
  for (const p of data.placed) {
    const c = PALETTE[(PRODUCT_INDEX[p.productId] - 1) % PALETTE.length];
    const g = svgEl('g');
    g.appendChild(svgEl('rect', {
      x: p.x, y: p.y, width: p.w, height: p.h,
      fill: c.fill, stroke: c.stroke, 'stroke-width': itemStrokeW,
    }));

    const fs = Math.min(Math.max(Math.min(p.w, p.h) * 0.2, 1.8), 8);
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;

    if (p.w > fs * 3.2 && p.h > fs * 2.0) {
      const dims = `${trimNum(p.width)}×${trimNum(p.height)}`;
      const allLines = [p.name, dims, `#${p.pieceIndex}`];
      // 按高度决定能放下几行（行高 1.25fs），优先保留名称
      const maxLines = Math.min(3, Math.max(1, Math.floor((p.h + fs * 0.5) / (fs * 1.25))));
      const fit = maxLines === 3 ? allLines : allLines.slice(0, maxLines);
      fit.forEach((t, i) => {
        g.appendChild(svgEl('text', {
          x: cx,
          y: cy + (i - (fit.length - 1) / 2) * fs * 1.25 + fs * 0.35,
          'text-anchor': 'middle',
          'font-size': i === 0 ? fs : fs * 0.82,
          fill: '#1f2933',
          'font-family': 'inherit',
        }, t));
      });
    }

    // 左上角：成品编号圆点
    const nr = Math.max(fs * 0.75, 1.6);
    g.appendChild(svgEl('circle', {
      cx: p.x + nr * 1.3, cy: p.y + nr * 1.3, r: nr,
      fill: c.stroke, opacity: 0.9,
    }));
    g.appendChild(svgEl('text', {
      x: p.x + nr * 1.3, y: p.y + nr * 1.3 + nr * 0.42,
      'text-anchor': 'middle', 'font-size': nr * 1.15,
      fill: '#fff', 'font-family': 'inherit',
    }, String(PRODUCT_INDEX[p.productId] ?? '')));

    // 右上角：旋转标记
    if (p.rotated) {
      g.appendChild(svgEl('circle', {
        cx: p.x + p.w - nr * 1.3, cy: p.y + nr * 1.3, r: nr * 1.25,
        fill: '#fff', stroke: '#2563eb', 'stroke-width': itemStrokeW,
      }));
      g.appendChild(svgEl('text', {
        x: p.x + p.w - nr * 1.3, y: p.y + nr * 1.3 + nr * 0.55,
        'text-anchor': 'middle', 'font-size': nr * 1.35,
        fill: '#2563eb', 'font-family': 'inherit',
      }, '↻'));
    }

    svg.appendChild(g);
  }

  // 切割线（红色，按数组顺序即下刀顺序；数字标号在刀过多时省略）
  const showOrder = data.cuts.length <= 120;
  data.cuts.forEach((cut) => {
    if (kerf > 0) {
      svg.appendChild(svgEl('rect', {
        x: cut.rect.x, y: cut.rect.y,
        width: Math.max(cut.rect.w, 0.05), height: Math.max(cut.rect.h, 0.05),
        fill: 'rgba(220,38,38,0.65)', stroke: '#991b1b', 'stroke-width': 0.3,
      }));
    } else {
      const line = cut.orientation === 'vertical'
        ? svgEl('line', { x1: cut.x, y1: cut.y, x2: cut.x, y2: cut.y + cut.length })
        : svgEl('line', { x1: cut.x, y1: cut.y, x2: cut.x + cut.length, y2: cut.y });
      line.setAttribute('stroke', '#dc2626');
      line.setAttribute('stroke-width', 0.8);
      svg.appendChild(line);
    }

    if (showOrder && cut.length >= badgeR * 1.2) {
      const mx = cut.orientation === 'vertical' ? cut.x + kerf / 2 : cut.x + cut.length / 2;
      const my = cut.orientation === 'vertical' ? cut.y + cut.length / 2 : cut.y + kerf / 2;
      svg.appendChild(svgEl('circle', {
        cx: mx, cy: my, r: badgeR, fill: '#fff', stroke: '#b91c1c', 'stroke-width': 0.5,
      }));
      svg.appendChild(svgEl('text', {
        x: mx, y: my + badgeR * 0.38, 'text-anchor': 'middle',
        'font-size': badgeR * 1.05, fill: '#b91c1c', 'font-weight': '700', 'font-family': 'inherit',
      }, String(cut.order)));
    }
  });

  // 纸张尺寸标注
  svg.appendChild(svgEl('text', {
    x: W / 2, y: -pad * 0.35, 'text-anchor': 'middle',
    'font-size': labelFs, fill: '#334155', 'font-family': 'inherit',
  }, `${trimNum(W)} mm`));
  const vLabel = svgEl('text', {
    x: -pad * 0.4, y: H / 2, 'text-anchor': 'middle',
    'font-size': labelFs, fill: '#334155', 'font-family': 'inherit',
    transform: `rotate(-90 ${-pad * 0.4} ${H / 2})`,
  }, `${trimNum(H)} mm`);
  svg.appendChild(vLabel);

  if (data.placed.length === 0) {
    svg.appendChild(svgEl('text', {
      x: W / 2, y: H / 2, 'text-anchor': 'middle',
      'font-size': labelFs * 1.4, fill: '#b91c1c', 'font-family': 'inherit',
    }, '没有任何成品能排入这张纸'));
  }

  svgWrap.appendChild(svg);
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
