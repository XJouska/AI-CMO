#!/usr/bin/env bash
# AI-CMO v2 恢复 / 恢复演练。
#
# 演练（默认，不影响线上）：把备份恢复到同一数据库实例中的临时库 aicmo_restore_check，校验表与数据行数后删除。
#   BACKUP_KEY_FILE=/root/.aicmo-backup.key deploy/restore.sh /var/backups/aicmo-v2/aicmo-20261028T030000Z.tar.enc
#
# 正式恢复（会覆盖线上数据库与数据卷！先停止 api / worker）：
#   RESTORE_MODE=production BACKUP_KEY_FILE=... deploy/restore.sh <备份文件>
set -euo pipefail

FILE="${1:?用法：restore.sh <备份文件 .tar.enc>}"
PROJECT="${COMPOSE_PROJECT:-aicmo-v2}"
KEY_FILE="${BACKUP_KEY_FILE:?请设置 BACKUP_KEY_FILE}"
MODE="${RESTORE_MODE:-drill}"
DB="${PROJECT}-db-1"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
umask 077

echo "▶ 解密并校验"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$WORK/bundle.tar" -pass "file:$KEY_FILE"
if [ -f "$FILE.sha256" ]; then
  [ "$(sha256sum "$WORK/bundle.tar" | awk '{print $1}')" = "$(cat "$FILE.sha256")" ] || { echo "校验和不一致" >&2; exit 1; }
fi
tar -C "$WORK" -xf "$WORK/bundle.tar"

psql_db() { docker exec -i "$DB" sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"$1\" -tA"; }

if [ "$MODE" = "drill" ]; then
  TARGET="aicmo_restore_check"
  echo "▶ 恢复演练：恢复到临时库 $TARGET"
  echo "DROP DATABASE IF EXISTS $TARGET WITH (FORCE); CREATE DATABASE $TARGET;" | psql_db postgres >/dev/null
  docker exec -i "$DB" sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $TARGET --no-owner --no-privileges" <"$WORK/db.dump"
  VERSION="$(echo 'SELECT version_num FROM alembic_version' | psql_db "$TARGET")"
  TABLES="$(echo "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" | psql_db "$TARGET")"
  echo "  迁移版本：$VERSION，表数量：$TABLES"
  # 核心表必须存在（缺表说明备份不完整或迁移版本不对）
  for table in companies users company_profiles site_versions; do
    COUNT="$(echo "SELECT count(*) FROM $table" | psql_db "$TARGET")" || { echo "✗ 演练失败：缺少表 $table" >&2; exit 1; }
    echo "  $table：$COUNT 行"
  done
  # 计划 05–07 的表（旧版本备份中可能没有）
  for table in leads audit_logs subscriptions; do
    if [ "$(echo "SELECT to_regclass('public.$table') IS NOT NULL" | psql_db "$TARGET")" = "t" ]; then
      echo "  $table：$(echo "SELECT count(*) FROM $table" | psql_db "$TARGET") 行"
    else
      echo "  $table：（该备份的迁移版本中不存在）"
    fi
  done
  for archive in storage sites; do
    echo "  $archive.tar.gz：$(tar -tzf "$WORK/$archive.tar.gz" | wc -l) 个文件"
  done
  [ -n "$VERSION" ] && [ "$TABLES" -gt 10 ] || { echo "✗ 演练失败：恢复后的数据库不完整" >&2; exit 1; }
  echo "DROP DATABASE $TARGET WITH (FORCE);" | psql_db postgres >/dev/null
  echo "✓ 恢复演练通过"
  exit 0
fi

[ "$MODE" = "production" ] || { echo "未知的 RESTORE_MODE：$MODE" >&2; exit 1; }
read -r -p "将覆盖 $PROJECT 的线上数据库和数据卷，输入 RESTORE 确认：" answer
[ "$answer" = "RESTORE" ] || { echo "已取消"; exit 1; }
echo "▶ 恢复数据库"
docker exec -i "$DB" sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' <"$WORK/db.dump"
for volume in storage sites; do
  echo "▶ 恢复数据卷 $volume"
  docker run --rm -v "${PROJECT}_${volume}:/data" -v "$WORK:/in:ro" alpine:3.20 \
    sh -c "find /data -mindepth 1 -delete && tar -C /data -xzf /in/${volume}.tar.gz"
done
echo "✓ 恢复完成，请启动 api / worker 并检查 /health"
