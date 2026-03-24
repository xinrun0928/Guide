#!/usr/bin/env python3
"""
清理 Markdown 文件中标题后的 --- 分隔线

根据 VitePress 规范，h2 标题自带顶部实线分隔（border-top），
无需额外写 ---。本脚本移除满足以下条件的 --- 行：
- 前后都是空行（孤立的分隔线）
- 紧跟在标题行（# 或 ## 等）后面的分隔线
"""

import os
import re

def is_title_line(line):
    """检查是否是标题行"""
    stripped = line.strip()
    return stripped.startswith('# ') or stripped.startswith('## ')

def should_remove_hr(prev_line, next_line):
    """
    判断 --- 行是否应该被移除
    移除条件：
    1. 前后都是空行（孤立的分隔线）
    2. 前一行是标题行（# 或 ## 开头）
    """
    prev_is_empty = prev_line.strip() == ''
    next_is_empty = next_line.strip() == ''

    # 条件1：前后都是空行
    if prev_is_empty and next_is_empty:
        return True

    # 条件2：前一行是标题行
    if is_title_line(prev_line):
        return True

    return False

def clean_horizontal_rules(content):
    """清理内容中的分隔线"""
    lines = content.split('\n')
    result = []
    i = 0

    while i < len(lines):
        line = lines[i]

        if line.strip() == '---':
            prev_line = lines[i - 1] if i > 0 else ''
            next_line = lines[i + 1] if i < len(lines) - 1 else ''

            # 判断是否应该移除
            if should_remove_hr(prev_line, next_line):
                # 跳过这个 ---
                # 如果前一行不是空行（是标题），检查前一行是否已在result中
                # 不需要额外处理，因为标题行已经在result中了
                i += 1
                continue
            else:
                result.append(line)
        else:
            result.append(line)

        i += 1

    return '\n'.join(result)

def process_directory(base_dir):
    """遍历处理目录下所有 .md 文件"""
    fixed_count = 0
    total_count = 0

    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith('.md'):
                filepath = os.path.join(root, file)
                total_count += 1

                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()

                new_content = clean_horizontal_rules(content)

                if new_content != content:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    fixed_count += 1
                    print(f"Fixed: {filepath}")

    return total_count, fixed_count

if __name__ == '__main__':
    base_dir = '/Users/zhang/Programs/Personal/Guide/docs/cs/'
    print(f"开始处理目录: {base_dir}")
    print("-" * 60)

    total, fixed = process_directory(base_dir)

    print("-" * 60)
    print(f"处理完成！共扫描 {total} 个文件，修复了 {fixed} 个文件。")
