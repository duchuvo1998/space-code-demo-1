# Lesson creation checklist template

Copy this checklist into the task or PR and fill in the lesson details before marking the work complete.

## Lesson details

- Week/module:
- Lesson ID:
- Lesson title:
- Lesson file:

## Checklist

- [ ] Read `README.md`, the relevant manifest entries, and a neighboring lesson.
- [ ] Confirm the lesson ID is unique and stable; do not rename an existing lesson ID.
- [ ] Create the HTML file under `courses/canva-gemini/lessons/` using the neighboring lesson's structure.
- [ ] Set `lang="vi"`, viewport metadata, and a `data-lesson-id` matching the manifest ID.
- [ ] Verify stylesheet and `../../../assets/course/iframe-bridge.js` paths resolve correctly.
- [ ] If the lesson supports checklist, notes, or completion state, implement progress using the existing `IframeProgressBridge` pattern.
- [ ] Add a manifest entry with `id`, `weekId`, `weekNumber`, `moduleId`, `title`, `src`, `searchTerms`, and `checklistIds`.
- [ ] Confirm lesson IDs and checklist IDs are unique, and checklist IDs match the lesson HTML.
- [ ] Place the manifest entry in the intended order; manifest order controls previous/next navigation.
- [ ] Ask a separate UI-focused agent to review the lesson for usability, visual hierarchy, responsiveness, and consistency; avoid generic, template-like presentation that feels AI-generated, and address its concrete findings.
- [ ] Verify the manifest is valid JSON and the `src` file exists.
- [ ] Serve the app over HTTP(S) and verify the lesson loads; test progress interaction if implemented.
- [ ] Confirm the iframe sandbox remains `allow-scripts allow-same-origin`.

## Completion notes

- Validation performed:
- Known issues or follow-up:
