#!/usr/bin/env bash
set -euo pipefail
usage() { echo "用法: $0 --source <源部署目录> --target <目标部署目录> --project-root <代码目录> --port <本地端口> [--name <实例名>] [--image <镜像>]"; }
SOURCE=""; TARGET=""; PROJECT_ROOT=""; PORT=""; NAME=""; IMAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2;;
    --target) TARGET="$2"; shift 2;;
    --project-root) PROJECT_ROOT="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --image) IMAGE="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "错误: 未知参数 $1" >&2; usage >&2; exit 1;;
  esac
done
[[ -n "$SOURCE" && -n "$TARGET" && -n "$PROJECT_ROOT" && -n "$PORT" ]] || { usage >&2; exit 1; }
[[ -f "$SOURCE/compose.yml" && -f "$SOURCE/.env" && -f "$SOURCE/data/config.json" ]] || { echo "错误: 源部署目录不完整" >&2; exit 1; }
NAME="${NAME:-$(basename "$TARGET")}"
IMAGE="${IMAGE:-$(sed -n 's/^SUPER_HELPER_IMAGE=//p' "$SOURCE/.env" | head -1)}"
[[ -n "$IMAGE" ]] || { echo "错误: 镜像地址缺失" >&2; exit 1; }
"$(dirname "$0")/init-site.sh" --site-dir "$TARGET" --project-root "$PROJECT_ROOT" --port "$PORT" --name "$NAME" --image "$IMAGE"
echo "已复制部署目录: $SOURCE -> $TARGET"
echo "未复制配置、data、knowledge、claude-home 和 Secret；目标站点需独立配置。"
