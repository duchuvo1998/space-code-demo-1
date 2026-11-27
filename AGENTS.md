# Repository Guidelines

This file is the **single source of truth** for repository-wide rules across AI coding agents (**GitHub Copilot**, **Antigravity**, **Cursor**, **OpenAI Codex**, **Claude Code**, etc.).

## Project Overview

- Static web application for the **Canva + Gemini Course** tracker (no bundler or build step).
- UI supports Vietnamese and English via `assets/localization/localization.mjs` and `assets/localization/locales/{vi,en}.mjs`. Course lessons under `courses/canva-gemini/lessons/` remain in Vietnamese.
- JavaScript ES modules are grouped under `assets/` by feature (`app/`, `course/`, `firebase/`, `progress/`, `localization/`, `ui/`, `dev/`).

## Commands & Verification

- Run locally: `python3 dev-server.py` (serves `http://localhost:4173/`; do not open `index.html` directly).
- Run unit tests: `node --test tests/*.test.mjs`.
- Do not claim tests or checks passed unless you actually ran them.

## Coding & Course Conventions

- Keep changes modular within the existing feature directories under `assets/`.
- When updating UI text, add/update matching keys in both `assets/localization/locales/vi.mjs` and `assets/localization/locales/en.mjs`.
- For course lessons, follow `courses/canva-gemini/LESSON_CHECKLIST.md`:
  - Never rename existing lesson IDs in `courses/canva-gemini/manifest.json`.
  - Keep lesson iframe sandbox as `allow-scripts allow-same-origin` (`assets/course/course-views.mjs`).
  - Keep `courses/canva-gemini/manifest.json` valid JSON with existing `src` files and matching `checklistIds`.
- Never commit secrets, `.env` values, or OAuth tokens/logs.

## Cross-Agent Rules & Skills Synchronization

Follow the open standard (`AGENTS.md` + `.agents/skills/`) as a single source of truth—never duplicate content across vendor-specific folders:

1. **Rules**:
   - Edit `AGENTS.md` (this file) for repo-wide rules, or place a nested `AGENTS.md` in a subdirectory for scoped rules.
   - Keep `.github/copilot-instructions.md` as a short pointer to `AGENTS.md` (for Copilot surfaces that check it). If adopting Claude Code later, use a one-line `CLAUDE.md` containing `@AGENTS.md`. Do not duplicate rule content in vendor files or create a separate root `GEMINI.md`.
2. **Skills**:
   - Store all shared skills in `.agents/skills/<skill-name>/SKILL.md` with YAML frontmatter containing lowercase hyphenated `name` and a clear `description`.
   - `.agents/skills/` is natively discovered by Antigravity, GitHub Copilot, Cursor, OpenAI Codex, and Claude Code.
   - Do not duplicate skills into `.github/skills/`, `.cursor/skills/`, or `.claude/skills/`.
   - Use the `sync-agent-customizations` skill (`.agents/skills/sync-agent-customizations/SKILL.md`) when adding, updating, or auditing shared rules and skills.
3. **Progress Tracking**:
   - Use the `save-progress` skill (`.agents/skills/save-progress/SKILL.md`) for multi-step or resumable work.
