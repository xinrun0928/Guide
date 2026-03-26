#!/bin/bash

# 统计 docs 目录下各模块的 md 文档数量

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs"
OUTPUT_FILE="$(cd "$(dirname "$0")" && pwd)/module_stats.txt"

{
  echo "模块文档数量统计"
  echo "生成时间: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "================================================================"
  echo ""

  # 临时文件保存各模块数据
  temp=$(mktemp)

  for dir in "$ROOT_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    basename="$(basename "$dir")"
    [[ "$basename" == .* ]] && continue

    # 统计不含 index.md 和 README.md 的数量
    count=$(find "$dir" -name "*.md" ! -name "index.md" ! -name "README.md" 2>/dev/null | wc -l | tr -d ' ')
    # 统计包含 index.md 和 README.md 的总数量
    total=$(find "$dir" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    echo "$count $total $basename" >> "$temp"
  done

  # 按数量降序排列输出
  sort -rn "$temp" | while read -r count total name; do
    printf "%-30s %4s 篇（含 index/README: %s）\n" "$name" "$count" "$total"
  done

  rm -f "$temp"

  echo ""
  echo "----------------------------------------------------------------"

  # 总体统计
  total_count=$(find "$ROOT_DIR" -name "*.md" ! -name "index.md" ! -name "README.md" ! -path "$ROOT_DIR/.vitepress/*" 2>/dev/null | wc -l | tr -d ' ')
  total_all=$(find "$ROOT_DIR" -name "*.md" ! -path "$ROOT_DIR/.vitepress/*" 2>/dev/null | wc -l | tr -d ' ')
  printf "%-30s %4s 篇（含 index/README: %s）\n" "合计" "$total_count" "$total_all"

  echo ""
  echo "说明：统计不含 index.md 和 README.md"
} | tee "$OUTPUT_FILE"
