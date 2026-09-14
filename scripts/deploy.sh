#!/usr/bin/env bash
set -euo pipefail
usage() { echo "用法: $0 image [--tag <镜像>] [--push] | site --site-dir <目录>"; }
command_name="${1:-}"
[[ -n "$command_name" ]] || { usage >&2; exit 1; }
shift
case "$command_name" in
  image)
    tag="docker.example.invalid/super-helper:$(date +%Y.%m%d.%H%M%S)"; push_image=false
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --tag) tag="$2"; shift 2;;
        --push) push_image=true; shift;;
        *) echo "错误: 未知参数 $1" >&2; usage >&2; exit 1;;
      esac
    done
    docker build -f docker/Dockerfile -t "$tag" .
    $push_image && docker push "$tag"
    echo "镜像: $tag"
    ;;
  site)
    site_dir=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --site-dir) site_dir="$2"; shift 2;;
        *) echo "错误: 未知参数 $1" >&2; usage >&2; exit 1;;
      esac
    done
    [[ -n "$site_dir" ]] || { usage >&2; exit 1; }
    scripts/check-deployment.sh "$site_dir"
    (cd "$site_dir" && docker compose pull && docker compose up -d)
    ;;
  *) echo "错误: 未知命令 $command_name" >&2; usage >&2; exit 1;;
esac
