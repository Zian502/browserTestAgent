# Cursor 项目配置（本目录）

## Project Rules（`.cursor/rules/*.mdc`）

- 由 **YAML frontmatter** 控制：`alwaysApply`、`globs`、`description`。
- 修改后提交 Git，团队共享。

## Memories（Cursor 内置「记忆」）

- **不在仓库里自动生效**：需在 Cursor **设置 → Rules / Memories**（或对话中由你确认保存）里维护。
- 仓库根目录的 **`MEMORIES.template.md`** 提供建议条目：复制其中段落到 Cursor Memories，或按需删减。

## 根目录 `AGENTS.md`

- Cursor 会读取的简单指令文件，适合不想拆多条规则时使用；与 `rules` 可同时存在。
