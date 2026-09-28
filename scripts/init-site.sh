#!/usr/bin/env bash
set -euo pipefail
usage() { echo "用法: $0 --site-dir <目录> --project-root <代码目录> --port <本地端口> [--name <实例名>] [--image <镜像>]"; }
SITE_DIR=""; PROJECT_ROOT=""; PORT=""; NAME=""; IMAGE="docker.example.invalid/super-helper:latest"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site-dir) SITE_DIR="$2"; shift 2;;
    --project-root) PROJECT_ROOT="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --image) IMAGE="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "错误: 未知参数 $1" >&2; usage >&2; exit 1;;
  esac
done
[[ -n "$SITE_DIR" && -n "$PROJECT_ROOT" && -n "$PORT" ]] || { usage >&2; exit 1; }
[[ -d "$PROJECT_ROOT" ]] || { echo "错误: 代码目录不存在: $PROJECT_ROOT" >&2; exit 1; }
[[ ! -e "$SITE_DIR" ]] || { echo "错误: 部署目录已存在: $SITE_DIR" >&2; exit 1; }
NAME="${NAME:-$(basename "$SITE_DIR")}"; mkdir -p "$SITE_DIR"/{data,knowledge,claude-home}
cp "$(cd "$(dirname "$0")/../docker" && pwd)/compose.yml" "$SITE_DIR/compose.yml"
cat > "$SITE_DIR/.env" <<EOF
SUPER_HELPER_IMAGE=$IMAGE
CONTAINER_NAME=super-helper-$NAME
EXPOSE_PORT=$PORT
PROJECT_ROOT=$PROJECT_ROOT
ANTHROPIC_API_KEY_FILE=/etc/super-helper/secrets/$NAME-anthropic-api-key
ANTHROPIC_BASE_URL=
TZ=Asia/Shanghai
EOF
cat > "$SITE_DIR/data/config.json" <<EOF
{
  "server": { "host": "0.0.0.0", "port": 4317, "bindMode": "lan" },
  "storage": { "rootDir": "/data/super-helper", "isolateByWorkspace": true },
  "knowledge": { "rootDir": "/data/knowledge", "isolateByWorkspace": true },
  "workspaces": [{ "id": "$NAME", "name": "$NAME", "rootPath": "/workspace/project", "mcpToolIds": [] }]
}
EOF
echo "已初始化部署目录: $SITE_DIR"
