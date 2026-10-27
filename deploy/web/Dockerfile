# syntax=docker/dockerfile:1
# web 镜像：构建前端产物，用非 root 的 Nginx 托管。构建上下文为仓库根目录。
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspaces --include-workspace-root --no-audit --no-fund
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build -w apps/web

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
