---
name: sync-agent-customizations
description: >-
  Create, update, or audit repository rules and skills using the cross-agent open
  standard (AGENTS.md and .agents/skills/) so GitHub Copilot, Antigravity, Cursor,
  Codex, Claude Code, and other agents stay synchronized from a single source of
  truth. Use when adding or modifying rules, custom instructions, or agent skills.
---

# Sync Cross-Agent Rules & Skills

Keep rules and skills in vendor-neutral open-standard locations so every AI coding agent loads the exact same instructions without duplication.

## Canonical Layout

| Customization | Canonical Path | Purpose |
| :--- | :--- | :--- |
| Repo-wide rules | `AGENTS.md` | Single source of truth for all agents |
| Directory-scoped rules | `<dir>/AGENTS.md` | Scoped guidelines for a subdirectory |
| Copilot fallback pointer | `.github/copilot-instructions.md` | Thin pointer to `AGENTS.md` and `.agents/skills/` |
| Claude Code pointer (optional) | `CLAUDE.md` | Only create if using Claude Code; single line `@AGENTS.md` |
| Shared skills | `.agents/skills/<skill-name>/SKILL.md` | Open-standard skills (Antigravity, Copilot, Cursor, Codex, Claude Code) |

## Adding or Updating Rules

1. Edit `AGENTS.md` at the repository root for repo-wide guidance, or `<dir>/AGENTS.md` for folder-specific rules.
2. Do **not** add YAML frontmatter to `AGENTS.md` (standalone `AGENTS.md` files must be plain Markdown).
3. Keep each `AGENTS.md` concise and well under 24 KB.
4. Keep `.github/copilot-instructions.md` as a short pointer only. Never duplicate rule content into vendor files (`.github/copilot-instructions.md`, `GEMINI.md`, `.cursorrules`, etc.).

## Adding or Updating Skills

1. Create `.agents/skills/<skill-name>/SKILL.md` where `<skill-name>` is lowercase and hyphenated (e.g., `create-course-lesson`).
2. Start `SKILL.md` with valid YAML frontmatter containing both required fields:
   - `name`: must match `<skill-name>` (lowercase, hyphenated).
   - `description`: third-person summary of what the skill does and when to activate it.
3. Put bulky references or helper scripts inside optional subdirectories (`references/`, `scripts/`, `examples/`, `resources/`) linked with relative paths from `SKILL.md`.
4. Do **not** duplicate skills into `.github/skills/`, `.cursor/skills/`, or `.claude/skills/`.

## Verification Checklist

Run this check after editing rules or skills:

```bash
python3 -c '
from pathlib import Path

agents_text = Path("AGENTS.md").read_text(encoding="utf-8")
agents_bytes = len(agents_text.encode("utf-8"))
assert not agents_text.startswith("---\n"), "AGENTS.md must not have frontmatter"
assert agents_bytes < 24000, "AGENTS.md exceeds 24KB limit"
print(f"OK: AGENTS.md ({agents_bytes} bytes)")

copilot_md = Path(".github/copilot-instructions.md").read_text(encoding="utf-8")
assert "AGENTS.md" in copilot_md and ".agents/skills" in copilot_md
print("OK: .github/copilot-instructions.md")

skills_dir = Path(".agents/skills")
for p in sorted(skills_dir.iterdir()):
    if not p.is_dir():
        continue
    sf = p / "SKILL.md"
    assert sf.exists(), f"Missing SKILL.md in {p}"
    text = sf.read_text(encoding="utf-8")
    assert text.startswith("---\n"), f"Missing frontmatter in {sf}"
    front = text.split("---\n", 2)[1]
    assert f"name: {p.name}" in front and "description:" in front, f"Invalid frontmatter in {sf}"
    print(f"OK: {sf}")

for forbidden in (".github/skills", ".cursor/skills", ".claude/skills", ".agents/skills.json", "GEMINI.md"):
    assert not Path(forbidden).exists(), f"Duplicate/legacy path exists: {forbidden}"
print("OK: No vendor duplicates")
'
```
