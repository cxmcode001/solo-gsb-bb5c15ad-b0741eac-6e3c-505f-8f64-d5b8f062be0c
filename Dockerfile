# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# 先拷贝依赖清单并安装（利用构建缓存），启动时无需再联网装依赖
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# 拷贝应用代码
COPY server.js ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "server.js"]
