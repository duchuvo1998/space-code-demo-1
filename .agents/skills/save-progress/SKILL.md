---
name: save-progress
description: Keep a concise progress.md checkpoint so work can resume without rereading the full conversation. Use when starting, continuing, handing off, or finishing repository work.
---

# Save Progress

Use `progress/progress.md` for active work and `progress/archive/` for completed-task summaries, one file per task.

## At the start of work

- Read `progress/progress.md` only when the current task resumes or depends on earlier work, or the user asks to resume it. Do not load it for unrelated tasks.
- Do not read archived task files by default. Consult only the matching task file when the current task depends on that completed work or the user asks about it; do not load the whole archive.
- Check that its task and next steps still match the user's current request; current instructions take precedence.
- If it does not exist and a task needs continuity, create `progress/progress.md` with only the context needed to resume.

## While working and before handing off

- Update the checkpoint when meaningful work is completed, decisions change, blockers appear, or work is about to pause or hand off.
- While the task is still in progress, note completed milestones and confirmed findings only when they are needed for its next steps.
- Record the task goal and the next concrete action or blocker when work is incomplete.
- Keep only context needed to continue the active task. Replace stale details instead of accumulating history.
- Do not copy conversations, source files, or command output.
- Hard limit: keep `progress/progress.md` to at most 200 words and 20 nonblank lines. If it approaches either limit, condense it to the most important context for the active task.
- Keep each archived task summary concise: task, outcome, important decisions/findings, and checks actually run. Save it as `progress/archive/YYYY-MM-DD-task-slug.md`. Do not archive transcripts or code.
- Omit routine commands and details that can be quickly read from source files.
- Never include secrets, credentials, personal data, or unrelated repository details.
- Preserve useful user-authored content; make targeted edits rather than replacing unrelated material.

## Completion

- When a task is complete, save its concise summary in its own file under `progress/archive/` and clear its details from `progress/progress.md`. Update that task's archive file rather than creating duplicates if resuming it later.
- Do not claim checks passed unless they were actually run.
