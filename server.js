'use strict';

const path = require('path');
const express = require('express');
const { solve } = require('./src/packer');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/layout
 * body: { sheetWidth, sheetHeight, kerf, products: [{ name, width, height, qty }] }
 * 返回排样结果（见 src/packer.js）。
 */
app.post('/api/layout', (req, res) => {
  try {
    const result = solve(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`单张纸裁切试排服务已启动: http://localhost:${PORT}`);
});
