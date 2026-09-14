#!/usr/bin/env bash
set -euo pipefail
SITE_DIR="${1:-}"
[[ -n "$SITE_DIR" ]] || { echo "用法: $0 <部署目录>" >&2; exit 1; }
[[ -f "$SITE_DIR/compose.yml" && -f "$SITE_DIR/.env" && -f "$SITE_DIR/config.json" ]] || { echo "错误: 部署目录缺少 compose.yml、.env 或 config.json" >&2; exit 1; }
for dir in data knowledge claude-home; do
  [[ -d "$SITE_DIR/$dir" ]] || { echo "错误: 缺少目录 $SITE_DIR/$dir" >&2; exit 1; }
done
project_root="$(sed -n 's/^PROJECT_ROOT=//p' "$SITE_DIR/.env" | head -1)"
secret_file="$(sed -n 's/^ANTHROPIC_API_KEY_FILE=//p' "$SITE_DIR/.env" | head -1)"
[[ -n "$project_root" && -d "$project_root" ]] || { echo "错误: PROJECT_ROOT 不存在或未配置" >&2; exit 1; }
[[ -n "$secret_file" && -f "$secret_file" ]] || { echo "错误: Secret 文件不存在或未配置" >&2; exit 1; }
(cd "$SITE_DIR" && docker compose config >/dev/null)
echo "部署检查通过: $SITE_DIR"
