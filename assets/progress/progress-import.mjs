function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateImportedData(parsed, manifest) {
  if (!isObject(parsed) || !manifest || !Array.isArray(manifest.lessons)) return false;
  const progress = parsed.schemaVersion === 1 && isObject(parsed.progress) ? parsed.progress : parsed;
  if (progress.checklist !== undefined && !isObject(progress.checklist)) return false;
  if (progress.notes !== undefined && !isObject(progress.notes)) return false;
  if (progress.lessonsDone !== undefined && !isObject(progress.lessonsDone)) return false;
  if (progress.completedLessons !== undefined && !Array.isArray(progress.completedLessons)) return false;
  if (progress.portfolio !== undefined && !Array.isArray(progress.portfolio)) return false;

  const known = new Set(manifest.lessons.map(lesson => lesson.id));
  const knownChecks = new Set(manifest.lessons.flatMap(lesson => lesson.checklistIds || []));

  for (const [id, checked] of Object.entries(progress.checklist || {})) {
    if (!knownChecks.has(id) || typeof checked !== "boolean") return false;
  }
  for (const [id, note] of Object.entries(progress.notes || {})) {
    if (!known.has(id) || typeof note !== "string") return false;
  }
  for (const id of Object.keys(progress.lessonsDone || {})) {
    if (!known.has(id)) return false;
  }
  for (const id of progress.completedLessons || []) {
    if (typeof id !== "string" || !known.has(id)) return false;
  }
  for (const item of progress.portfolio || []) {
    if (!isObject(item)) return false;
    if (typeof item.id !== "string" || !item.id.trim()) return false;
    if (item.link && (typeof item.link !== "string" || !/^https?:\/\//i.test(item.link))) return false;
    if (item.lessonId && (typeof item.lessonId !== "string" || !known.has(item.lessonId))) return false;
  }
  return true;
}

export function mergeImportedProgress(parsed, currentProgress) {
  const progress = parsed.schemaVersion === 1 && isObject(parsed.progress) ? parsed.progress : parsed;
  const lessonsDone = isObject(progress.lessonsDone) ? { ...progress.lessonsDone } : { ...currentProgress.lessonsDone };
  const completedLessons = Array.isArray(progress.completedLessons)
    ? [...new Set(progress.completedLessons)]
    : Object.keys(lessonsDone);

  return {
    schemaVersion: 1,
    progress: {
      checklist: isObject(progress.checklist) ? { ...progress.checklist } : { ...currentProgress.checklist },
      notes: isObject(progress.notes) ? { ...progress.notes } : { ...currentProgress.notes },
      portfolio: Array.isArray(progress.portfolio)
        ? progress.portfolio.map(item => ({ ...item }))
        : currentProgress.portfolio.map(item => ({ ...item })),
      lessonsDone,
      completedLessons,
      theme: ["light", "dark"].includes(progress.theme) ? progress.theme : currentProgress.theme
    }
  };
}
