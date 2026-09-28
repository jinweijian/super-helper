#!/usr/bin/env bash
set -euo pipefail
SITE_DIR=""; VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site-dir) SITE_DIR="$2"; shift 2;;
    --version) VERSION="$2"; shift 2;;
    -h|--help) echo "用法: $0 --site-dir <目录> --version <镜像标签>"; exit 0;;
    *) echo "错误: 未知参数 $1" >&2; exit 1;;
  esac
done
[[ -n "$SITE_DIR" && -n "$VERSION" && -f "$SITE_DIR/.env" ]] || { echo "缺少参数或部署目录无效" >&2; exit 1; }
"$(dirname "$0")/check-deployment.sh" "$SITE_DIR"
tmp_env="$(mktemp)"
backup_env="$(mktemp)"
cp "$SITE_DIR/.env" "$backup_env"
cleanup() {
  status=$?
  if [[ $status -ne 0 ]]; then cp "$backup_env" "$SITE_DIR/.env"; fi
  rm -f "$tmp_env" "$backup_env"
  exit "$status"
}
trap cleanup EXIT
awk -v version="$VERSION" 'BEGIN { replaced=0 } /^SUPER_HELPER_IMAGE=/ { print "SUPER_HELPER_IMAGE=" version; replaced=1; next } { print } END { if (!replaced) print "SUPER_HELPER_IMAGE=" version }' "$SITE_DIR/.env" > "$tmp_env"
mv "$tmp_env" "$SITE_DIR/.env"
(cd "$SITE_DIR" && docker compose config >/dev/null && docker compose pull && docker compose up -d)
echo "已升级: $SITE_DIR -> $VERSION"
