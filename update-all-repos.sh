#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REMOTE="origin"
BRANCH=""
DRY_RUN=false
TARGETS=("ct" "edu")

usage() {
  cat <<'EOF'
用法：
  ./update-all-repos.sh [选项]

扫描脚本所在目录下 ct、edu 中的所有 Git 仓库并拉取最新代码，
包括 edusoho、edusoho-lms 以及 edusoho/plugins 下的独立插件仓库。

选项：
  -b, --branch <分支>  所有仓库统一切换到指定分支后更新
  -r, --remote <远端>  Git 远端名称，默认 origin
  -n, --dry-run        只显示将执行的操作，不修改仓库
  -h, --help           显示帮助

示例：
  ./update-all-repos.sh
  ./update-all-repos.sh --branch master
  ./update-all-repos.sh -b release/8.0
  ./update-all-repos.sh -b master --dry-run

安全规则：
  - 有未提交或未跟踪文件的仓库会被跳过。
  - 更新只允许 fast-forward，不会自动 merge、rebase 或强制重置。
  - 指定分支在远端不存在时，仅跳过对应仓库并继续处理其他仓库。
EOF
}

error() {
  printf '错误：%s\n' "$*" >&2
}

while (($# > 0)); do
  case "$1" in
    -b|--branch)
      if (($# < 2)) || [[ -z "$2" ]]; then
        error "$1 需要提供分支名"
        usage >&2
        exit 64
      fi
      BRANCH="$2"
      shift 2
      ;;
    -r|--remote)
      if (($# < 2)) || [[ -z "$2" ]]; then
        error "$1 需要提供远端名称"
        usage >&2
        exit 64
      fi
      REMOTE="$2"
      shift 2
      ;;
    -n|--dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      error "未知参数：$1"
      usage >&2
      exit 64
      ;;
  esac
done

command -v git >/dev/null 2>&1 || {
  error "未找到 git 命令"
  exit 127
}

run_git() {
  local repo="$1"
  shift

  if [[ "$DRY_RUN" == true ]]; then
    printf '  [预览] git -C %q' "$repo"
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi

  git -C "$repo" "$@"
}

declare -a repos=()

for target in "${TARGETS[@]}"; do
  target_path="$SCRIPT_DIR/$target"
  if [[ ! -d "$target_path" ]]; then
    printf '警告：目录不存在，已跳过：%s\n' "$target_path" >&2
    continue
  fi

  while IFS= read -r -d '' git_marker; do
    repo="$(dirname -- "$git_marker")"
    repos+=("$repo")
  done < <(find "$target_path" -name .git -prune -print0)
done

if ((${#repos[@]} == 0)); then
  error "在 $SCRIPT_DIR/ct 和 $SCRIPT_DIR/edu 下没有找到 Git 仓库"
  exit 1
fi

printf '发现 %d 个 Git 仓库。\n' "${#repos[@]}"
if [[ -n "$BRANCH" ]]; then
  printf '统一分支：%s；远端：%s\n' "$BRANCH" "$REMOTE"
else
  printf '保留各仓库当前分支；远端：%s\n' "$REMOTE"
fi
printf '\n'

updated=0
unchanged=0
skipped=0
failed=0

for repo in "${repos[@]}"; do
  relative_repo="${repo#"$SCRIPT_DIR"/}"
  printf '==> %s\n' "$relative_repo"

  if [[ -n "$(git -C "$repo" status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then
    printf '  跳过：存在未提交或未跟踪文件。\n\n' >&2
    ((skipped += 1))
    continue
  fi

  if ! git -C "$repo" remote get-url "$REMOTE" >/dev/null 2>&1; then
    printf '  失败：远端 %s 不存在。\n\n' "$REMOTE" >&2
    ((failed += 1))
    continue
  fi

  before="$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)"
  if [[ -z "$before" ]]; then
    printf '  失败：无法读取当前提交。\n\n' >&2
    ((failed += 1))
    continue
  fi

  if ! run_git "$repo" fetch "$REMOTE" --prune; then
    printf '  失败：拉取远端信息失败。\n\n' >&2
    ((failed += 1))
    continue
  fi

  if [[ -n "$BRANCH" ]]; then
    if ! git -C "$repo" show-ref --verify --quiet "refs/remotes/$REMOTE/$BRANCH"; then
      printf '  跳过：远端不存在分支 %s/%s。\n\n' "$REMOTE" "$BRANCH" >&2
      ((skipped += 1))
      continue
    fi

    if git -C "$repo" show-ref --verify --quiet "refs/heads/$BRANCH"; then
      if ! run_git "$repo" checkout "$BRANCH"; then
        printf '  失败：无法切换到本地分支 %s。\n\n' "$BRANCH" >&2
        ((failed += 1))
        continue
      fi
    else
      if ! run_git "$repo" checkout -b "$BRANCH" --track "$REMOTE/$BRANCH"; then
        printf '  失败：无法创建并切换到分支 %s。\n\n' "$BRANCH" >&2
        ((failed += 1))
        continue
      fi
    fi

    if ! run_git "$repo" merge --ff-only "$REMOTE/$BRANCH"; then
      printf '  失败：本地与 %s/%s 已分叉，未自动合并。\n\n' "$REMOTE" "$BRANCH" >&2
      ((failed += 1))
      continue
    fi
  else
    current_branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    if [[ -z "$current_branch" ]]; then
      printf '  跳过：当前处于 detached HEAD，请使用 --branch 指定分支。\n\n' >&2
      ((skipped += 1))
      continue
    fi

    upstream="$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
    if [[ -z "$upstream" ]]; then
      printf '  跳过：当前分支 %s 没有配置 upstream。\n\n' "$current_branch" >&2
      ((skipped += 1))
      continue
    fi

    if ! run_git "$repo" merge --ff-only "$upstream"; then
      printf '  失败：本地与 %s 已分叉，未自动合并。\n\n' "$upstream" >&2
      ((failed += 1))
      continue
    fi
  fi

  if [[ "$DRY_RUN" == true ]]; then
    printf '  预览完成。\n\n'
    ((unchanged += 1))
    continue
  fi

  after="$(git -C "$repo" rev-parse HEAD)"
  if [[ "$before" == "$after" ]]; then
    printf '  已是最新。\n\n'
    ((unchanged += 1))
  else
    printf '  更新完成：%s -> %s\n\n' "${before:0:10}" "${after:0:10}"
    ((updated += 1))
  fi
done

printf '%s\n' '----------------------------------------'
printf '完成：更新 %d，已是最新/预览 %d，跳过 %d，失败 %d。\n' \
  "$updated" "$unchanged" "$skipped" "$failed"

if ((failed > 0)); then
  exit 1
fi
