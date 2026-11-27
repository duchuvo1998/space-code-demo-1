export const PROGRESS_STORAGE_KEY = "canva-gemini-course:v1";
export const WELCOME_CHOICE_STORAGE_KEY = `${PROGRESS_STORAGE_KEY}:welcome-choice`;
export const CLOUD_RESET_STORAGE_KEY = `${PROGRESS_STORAGE_KEY}:firebase-reset-uid`;
export const LAST_SYNCED_UID_STORAGE_KEY = `${PROGRESS_STORAGE_KEY}:firebase-last-uid`;

const MAX_PROGRESS_BYTES = 900000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createDefaultProgress() {
  return {
    checklist: {},
    lessonsDone: {},
    completedLessons: [],
    notes: {},
    theme: "light",
    portfolio: []
  };
}

function normalizeProgress(progress) {
  const normalized = { ...createDefaultProgress(), ...progress };
  normalized.checklist = isRecord(progress.checklist) ? progress.checklist : {};
  normalized.lessonsDone = isRecord(progress.lessonsDone) ? progress.lessonsDone : {};
  normalized.completedLessons = Array.isArray(progress.completedLessons) ? progress.completedLessons : [];
  normalized.notes = isRecord(progress.notes) ? progress.notes : {};
  normalized.portfolio = Array.isArray(progress.portfolio) ? progress.portfolio : [];
  normalized.theme = ["light", "dark"].includes(normalized.theme) ? normalized.theme : "light";
  return normalized;
}

function normalizeStoredState(parsed) {
  if (!isRecord(parsed)) throw new Error("Stored progress must be an object.");

  if (parsed.schemaVersion === 1 && isRecord(parsed.progress)) {
    return {
      ...parsed,
      schemaVersion: 1,
      progress: normalizeProgress(parsed.progress)
    };
  }

  const progress = createDefaultProgress();
  progress.checklist = isRecord(parsed.checklist) ? parsed.checklist : {};
  progress.lessonsDone = isRecord(parsed.lessonsDone) ? parsed.lessonsDone : {};
  progress.completedLessons = Object.keys(progress.lessonsDone);
  progress.notes = isRecord(parsed.notes) ? parsed.notes : {};
  progress.portfolio = Array.isArray(parsed.portfolio) ? parsed.portfolio : [];
  progress.theme = ["light", "dark"].includes(parsed.theme) ? parsed.theme : "light";
  return { ...parsed, schemaVersion: 1, progress };
}

export function loadProgressState(storage) {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(PROGRESS_STORAGE_KEY);
    if (!raw) {
      return {
        state: { schemaVersion: 1, progress: createDefaultProgress() },
        firstVisit: true,
        available: true,
        error: null
      };
    }

    return {
      state: normalizeStoredState(JSON.parse(raw)),
      firstVisit: false,
      available: true,
      error: null
    };
  } catch (error) {
    return {
      state: {
        schemaVersion: 1,
        progress: createDefaultProgress(),
        _malformedExistingData: true
      },
      firstVisit: false,
      available: false,
      error
    };
  }
}

export function saveProgressState(state, storage) {
  try {
    const payload = JSON.stringify(state);
    if (new TextEncoder().encode(payload).length > MAX_PROGRESS_BYTES) {
      throw new Error("Progress exceeds the 900 KB local storage limit.");
    }
    (storage ?? globalThis.localStorage).setItem(PROGRESS_STORAGE_KEY, payload);
    return { saved: true, error: null };
  } catch (error) {
    return { saved: false, error };
  }
}

export function loadPendingCloudReset(storage) {
  try {
    return {
      uid: (storage ?? globalThis.localStorage).getItem(CLOUD_RESET_STORAGE_KEY) || "",
      available: true,
      error: null
    };
  } catch (error) {
    return { uid: "", available: false, error };
  }
}

export function savePendingCloudReset(uid, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(CLOUD_RESET_STORAGE_KEY, uid);
    return { saved: true, error: null };
  } catch (error) {
    return { saved: false, error };
  }
}

export function clearPendingCloudReset(storage) {
  try {
    (storage ?? globalThis.localStorage).removeItem(CLOUD_RESET_STORAGE_KEY);
    return { saved: true, error: null };
  } catch (error) {
    return { saved: false, error };
  }
}

export function loadWelcomeChoice(storage) {
  try {
    return {
      dismissed: (storage ?? globalThis.localStorage).getItem(WELCOME_CHOICE_STORAGE_KEY) === "1",
      available: true,
      error: null
    };
  } catch (error) {
    return { dismissed: false, available: false, error };
  }
}

export function saveWelcomeChoice(storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(WELCOME_CHOICE_STORAGE_KEY, "1");
    return { saved: true, error: null };
  } catch (error) {
    return { saved: false, error };
  }
}

export function loadLastSyncedUid(storage) {
  try {
    return {
      uid: (storage ?? globalThis.localStorage).getItem(LAST_SYNCED_UID_STORAGE_KEY) || "",
      available: true,
      error: null
    };
  } catch (error) {
    return { uid: "", available: false, error };
  }
}

export function saveLastSyncedUid(uid, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(LAST_SYNCED_UID_STORAGE_KEY, uid);
    return { saved: true, error: null };
  } catch (error) {
    return { saved: false, error };
  }
}

export function clearLastSyncedUid(storage) {
  try {
    (storage ?? globalThis.localStorage).removeItem(LAST_SYNCED_UID_STORAGE_KEY);
    return { saved: true, error: null };
  } catch (error) {
    return { saved: false, error };
  }
}
