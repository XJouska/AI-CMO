#!/usr/bin/env bash
# AI-CMO v2 每日备份：数据库（pg_dump 自定义格式）+ 上传文件与官网产物（数据卷 tar），AES-256 加密后保存。
#
# 用法（宿主机，cron 每日执行）：
#   BACKUP_DIR=/var/backups/aicmo BACKUP_KEY_FILE=/root/.aicmo-backup.key deploy/backup.sh
# 环境变量：
#   BACKUP_DIR        备份目录（默认 /var/backups/aicmo-v2）
#   BACKUP_KEY_FILE   加密密钥文件（必需；首次生成：openssl rand -base64 48 > 文件 && chmod 600 文件）
#   BACKUP_KEEP_DAYS  保留天数（默认 14）
#   COMPOSE_PROJECT   compose 项目名（默认 aicmo-v2）
# 密钥文件务必另行离线保存：丢失后备份无法解密。
set -euo pipefail

PROJECT="${COMPOSE_PROJECT:-aicmo-v2}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/aicmo-v2}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
KEY_FILE="${BACKUP_KEY_FILE:?请设置 BACKUP_KEY_FILE（加密密钥文件）}"
[ -s "$KEY_FILE" ] || { echo "密钥文件不存在或为空：$KEY_FILE" >&2; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
umask 077
mkdir -p "$BACKUP_DIR"

DB="${PROJECT}-db-1"
echo "▶ 导出数据库（$DB）"
docker exec "$DB" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' >"$WORK/db.dump"
[ -s "$WORK/db.dump" ] || { echo "数据库导出为空" >&2; exit 1; }

echo "▶ 打包数据卷（storage / sites）"
for volume in storage sites; do
  docker run --rm -v "${PROJECT}_${volume}:/data:ro" -v "$WORK:/out" alpine:3.20 \
    tar -C /data -czf "/out/${volume}.tar.gz" . 
done

echo "▶ 加密"
tar -C "$WORK" -cf "$WORK/bundle.tar" db.dump storage.tar.gz sites.tar.gz
sha256sum "$WORK/bundle.tar" | awk '{print $1}' >"$WORK/bundle.sha256"
OUT="$BACKUP_DIR/aicmo-${STAMP}.tar.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$WORK/bundle.tar" -out "$OUT" -pass "file:$KEY_FILE"
cp "$WORK/bundle.sha256" "$OUT.sha256"

echo "▶ 清理 $KEEP_DAYS 天前的备份"
find "$BACKUP_DIR" -name 'aicmo-*.tar.enc*' -mtime "+$KEEP_DAYS" -delete

echo "✓ 备份完成：$OUT（$(du -h "$OUT" | cut -f1)）"
