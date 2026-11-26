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

  for (const key of ["checklist", "lessonsDone", "notes"]) {
    const localMap = isRecord(local[key]) ? local[key] : {};
    const cloudMap = isRecord(cloud[key]) ? cloud[key] : {};
    merged[key] = { ...cloudMap, ...localMap };
  }

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
