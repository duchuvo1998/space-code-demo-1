function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasProgressData(progress) {
  return ["checklist", "lessonsDone", "notes"].some(key =>
    isRecord(progress[key]) && Object.keys(progress[key]).length > 0
  ) || (Array.isArray(progress.completedLessons) && progress.completedLessons.length > 0)
    || (Array.isArray(progress.portfolio) && progress.portfolio.length > 0)
    || (progress.theme && !["system", "light"].includes(progress.theme));
}

function equalValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) =>
      key === rightKeys[index] && equalValue(left[key], right[key])
    );
}

function normalizeMapForComparison(map, keepEntry) {
  const normalized = {};
  if (!isRecord(map)) return normalized;
  for (const key of Object.keys(map).sort()) {
    if (keepEntry(map[key])) {
      normalized[key] = map[key];
    }
  }
  return normalized;
}

function normalizeProgressForComparison(progress) {
  const source = isRecord(progress) ? progress : {};
  const normalized = {};
  const reservedFields = new Set([
    "checklist", "lessonsDone", "notes", "completedLessons", "portfolio", "theme"
  ]);

  normalized.checklist = normalizeMapForComparison(source.checklist, value => value === true);
  normalized.lessonsDone = normalizeMapForComparison(source.lessonsDone, value => Boolean(value));
  normalized.notes = normalizeMapForComparison(
    source.notes,
    value => typeof value === "string" && value.length > 0
  );
  normalized.completedLessons = [
    ...new Set(Array.isArray(source.completedLessons) ? source.completedLessons.filter(Boolean) : [])
  ].sort();
  normalized.portfolio = (Array.isArray(source.portfolio) ? source.portfolio : [])
    .filter(item => isRecord(item))
    .slice()
    .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
  normalized.theme = source.theme === "dark" ? "dark" : "light";

  for (const key of Object.keys(source).sort()) {
    if (!reservedFields.has(key) && source[key] !== undefined) {
      normalized[key] = source[key];
    }
  }
  return normalized;
}

export function areProgressEqual(left, right) {
  return equalValue(
    normalizeProgressForComparison(left),
    normalizeProgressForComparison(right)
  );
}

export function summarizeProgress(progress) {
  const source = isRecord(progress) ? progress : {};
  const completed = new Set(
    Array.isArray(source.completedLessons) ? source.completedLessons.filter(Boolean) : []
  );
  if (isRecord(source.lessonsDone)) {
    for (const [id, date] of Object.entries(source.lessonsDone)) {
      if (date) completed.add(id);
    }
  }
  const checkedItems = isRecord(source.checklist)
    ? Object.values(source.checklist).filter(value => value === true).length
    : 0;
  const notesCount = isRecord(source.notes)
    ? Object.values(source.notes).filter(value => typeof value === "string" && value.trim().length > 0).length
    : 0;
  const portfolioCount = Array.isArray(source.portfolio) ? source.portfolio.length : 0;

  return {
    completedLessons: completed.size,
    checkedItems,
    notesCount,
    portfolioCount
  };
}

function hasOverlappingContentConflict(baseline, local, cloud) {
  const localChanges = diffProgress(baseline, local);
  const cloudChanges = diffProgress(baseline, cloud);

  const localNotes = localChanges.maps.notes || {};
  const cloudNotes = cloudChanges.maps.notes || {};
  for (const lessonId of Object.keys(localNotes)) {
    if (Object.hasOwn(cloudNotes, lessonId) && !equalValue(localNotes[lessonId], cloudNotes[lessonId])) {
      return true;
    }
  }

  for (const itemId of Object.keys(localChanges.portfolio)) {
    if (
      Object.hasOwn(cloudChanges.portfolio, itemId)
      && !equalValue(localChanges.portfolio[itemId], cloudChanges.portfolio[itemId])
    ) {
      return true;
    }
  }

  return false;
}

export function resolveSignInSyncStrategy({
  localProgress,
  cloudProgress,
  baselineProgress = null,
  lastSyncedUid = "",
  signingInUid = "",
  replacingResetProgress = false
}) {
  if (replacingResetProgress) {
    return { action: "replace-cloud", prompt: false, reason: "pending-reset", recommended: "replace-cloud" };
  }
  if (!cloudProgress) {
    return { action: "upload-local", prompt: false, reason: "empty-cloud", recommended: "replace-cloud" };
  }
  if (!hasProgressData(localProgress)) {
    return { action: "use-cloud", prompt: false, reason: "empty-local", recommended: "use-cloud" };
  }
  if (areProgressEqual(localProgress, cloudProgress)) {
    return { action: "already-in-sync", prompt: false, reason: "identical", recommended: "use-cloud" };
  }

  const sameAccount = Boolean(lastSyncedUid && signingInUid && lastSyncedUid === signingInUid);
  if (sameAccount && isRecord(baselineProgress)) {
    if (areProgressEqual(localProgress, baselineProgress)) {
      return { action: "use-cloud", prompt: false, reason: "cloud-newer", recommended: "use-cloud" };
    }
    if (areProgressEqual(cloudProgress, baselineProgress)) {
      return { action: "replace-cloud", prompt: false, reason: "local-newer", recommended: "replace-cloud" };
    }
    if (!hasOverlappingContentConflict(baselineProgress, localProgress, cloudProgress)) {
      return { action: "three-way-merge", prompt: false, reason: "same-account-auto-merge", recommended: "merge" };
    }
    return { action: "prompt", prompt: true, reason: "same-account-conflict", recommended: "merge" };
  }

  if (lastSyncedUid && signingInUid && lastSyncedUid !== signingInUid) {
    return { action: "prompt", prompt: true, reason: "different-account", recommended: "use-cloud" };
  }

  return { action: "prompt", prompt: true, reason: "local-and-cloud-exist", recommended: "merge" };
}

function setOwnProperty(target, key, value) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true
    });
}

function diffMap(before, after) {
    const changes = Object.create(null);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (equalValue(before[key], after[key])) continue;
    setOwnProperty(changes, key, Object.hasOwn(after, key)
      ? { exists: true, value: after[key] }
      : { exists: false });
  }
  return changes;
}

function portfolioById(items) {
  return new Map(
    (Array.isArray(items) ? items : [])
      .filter(item => item && typeof item.id === "string")
      .map(item => [item.id, item])
  );
}

export function diffProgress(baseline, current) {
  const before = isRecord(baseline) ? baseline : {};
  const after = isRecord(current) ? current : {};
  const changes = {
    maps: Object.create(null),
    completedLessons: Object.create(null),
    portfolio: Object.create(null),
    fields: Object.create(null)
  };

  for (const key of ["checklist", "lessonsDone", "notes"]) {
    const mapChanges = diffMap(
      isRecord(before[key]) ? before[key] : {},
      isRecord(after[key]) ? after[key] : {}
    );
    if (Object.keys(mapChanges).length) changes.maps[key] = mapChanges;
  }

  const beforeCompleted = new Set(Array.isArray(before.completedLessons) ? before.completedLessons : []);
  const afterCompleted = new Set(Array.isArray(after.completedLessons) ? after.completedLessons : []);
  for (const id of new Set([...beforeCompleted, ...afterCompleted])) {
    if (beforeCompleted.has(id) !== afterCompleted.has(id)) {
      setOwnProperty(changes.completedLessons, id, afterCompleted.has(id));
    }
  }

  const beforePortfolio = portfolioById(before.portfolio);
  const afterPortfolio = portfolioById(after.portfolio);
  for (const id of new Set([...beforePortfolio.keys(), ...afterPortfolio.keys()])) {
    const previous = beforePortfolio.get(id);
    const next = afterPortfolio.get(id);
    if (equalValue(previous, next)) continue;
    setOwnProperty(
      changes.portfolio,
      id,
      next === undefined ? { exists: false } : { exists: true, value: next }
    );
  }

  const reservedFields = new Set([
    "checklist", "lessonsDone", "notes", "completedLessons", "portfolio"
  ]);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (reservedFields.has(key) || equalValue(before[key], after[key])) continue;
    setOwnProperty(changes.fields, key, Object.hasOwn(after, key)
      ? { exists: true, value: after[key] }
      : { exists: false });
  }
  return changes;
}

export function applyProgressChanges(cloudProgress, changes) {
  const merged = isRecord(cloudProgress) ? { ...cloudProgress } : {};

  for (const key of ["checklist", "lessonsDone", "notes"]) {
    const map = isRecord(merged[key]) ? { ...merged[key] } : {};
    for (const [id, change] of Object.entries(changes.maps[key] || {})) {
      if (change.exists) setOwnProperty(map, id, change.value);
      else delete map[id];
    }
    merged[key] = map;
  }

  const completedLessons = new Set(
    Array.isArray(merged.completedLessons) ? merged.completedLessons : []
  );
  for (const [id, completed] of Object.entries(changes.completedLessons)) {
    if (completed) completedLessons.add(id);
    else completedLessons.delete(id);
  }
  merged.completedLessons = [...completedLessons];

  const portfolio = Array.isArray(merged.portfolio) ? [...merged.portfolio] : [];
  for (const [id, change] of Object.entries(changes.portfolio)) {
    const index = portfolio.findIndex(item => item?.id === id);
    if (!change.exists) {
      if (index >= 0) portfolio.splice(index, 1);
    } else if (index >= 0) {
      portfolio[index] = { ...portfolio[index], ...change.value };
    } else {
      portfolio.push(change.value);
    }
  }
  merged.portfolio = portfolio;

  for (const [key, change] of Object.entries(changes.fields)) {
    if (change.exists) setOwnProperty(merged, key, change.value);
    else delete merged[key];
  }

  return merged;
}

function mergePortfolio(localItems, cloudItems) {
  const items = [...(Array.isArray(cloudItems) ? cloudItems : [])];
  for (const localItem of Array.isArray(localItems) ? localItems : []) {
    const existingIndex = items.findIndex(item => item?.id && item.id === localItem?.id);
    if (existingIndex < 0) items.push(localItem);
    else items[existingIndex] = { ...items[existingIndex], ...localItem };
  }
  return items;
}

export function mergeProgress(localProgress, cloudProgress) {
  const local = isRecord(localProgress) ? localProgress : {};
  const cloud = isRecord(cloudProgress) ? cloudProgress : {};
  const localIsActive = hasProgressData(local);
  const merged = localIsActive ? { ...cloud, ...local } : { ...local, ...cloud };

  const localChecklist = isRecord(local.checklist) ? local.checklist : {};
  const cloudChecklist = isRecord(cloud.checklist) ? cloud.checklist : {};
  const mergedChecklist = { ...cloudChecklist, ...localChecklist };
  for (const key of new Set([...Object.keys(cloudChecklist), ...Object.keys(localChecklist)])) {
    if (cloudChecklist[key] === true || localChecklist[key] === true) {
      mergedChecklist[key] = true;
    }
  }
  merged.checklist = mergedChecklist;

  const localLessonsDone = isRecord(local.lessonsDone) ? local.lessonsDone : {};
  const cloudLessonsDone = isRecord(cloud.lessonsDone) ? cloud.lessonsDone : {};
  merged.lessonsDone = { ...cloudLessonsDone, ...localLessonsDone };

  const localNotes = isRecord(local.notes) ? local.notes : {};
  const cloudNotes = isRecord(cloud.notes) ? cloud.notes : {};
  const mergedNotes = { ...cloudNotes, ...localNotes };
  for (const key of Object.keys(cloudNotes)) {
    const localNote = localNotes[key];
    const cloudNote = cloudNotes[key];
    if (typeof cloudNote === "string" && cloudNote.length > 0 && typeof localNote === "string" && localNote.length === 0) {
      mergedNotes[key] = cloudNote;
    }
  }
  merged.notes = mergedNotes;

  merged.completedLessons = [...new Set([
    ...(Array.isArray(cloud.completedLessons) ? cloud.completedLessons : []),
    ...(Array.isArray(local.completedLessons) ? local.completedLessons : [])
  ])];
  merged.portfolio = mergePortfolio(local.portfolio, cloud.portfolio);
  merged.theme = localIsActive && local.theme === "light"
    ? "light"
    : local.theme === "dark"
      ? "dark"
      : ["light", "dark"].includes(cloud.theme)
        ? cloud.theme
        : "light";
  return merged;
}
