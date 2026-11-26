import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPendingCloudReset,
  createDefaultProgress,
  loadPendingCloudReset,
  loadProgressState,
  loadWelcomeChoice,
  savePendingCloudReset,
  saveProgressState,
  saveWelcomeChoice
} from "../assets/progress/progress-storage.mjs";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("loads defaults and marks a browser with no saved progress as a first visit", () => {
  const result = loadProgressState(new MemoryStorage());

  assert.deepEqual(result.state, {
    schemaVersion: 1,
    progress: createDefaultProgress()
  });
  assert.equal(result.firstVisit, true);
  assert.equal(result.available, true);
  assert.equal(result.state.progress.theme, "light");
});

test("normalizes saved state and migrates legacy progress", () => {
  const storage = new MemoryStorage();
  storage.setItem("canva-gemini-course:v1", JSON.stringify({
    lessonsDone: { "w1-d1": "2026-01-01" },
    notes: { "w1-d1": "Note" },
    theme: "dark",
    futureField: "preserved"
  }));

  const result = loadProgressState(storage);

  assert.equal(result.firstVisit, false);
  assert.equal(result.state.schemaVersion, 1);
  assert.deepEqual(result.state.progress.completedLessons, ["w1-d1"]);
  assert.equal(result.state.progress.theme, "dark");
  assert.equal(result.state.futureField, "preserved");
});

test("migrates the old system theme default to light while preserving explicit dark mode", () => {
  const storage = new MemoryStorage();
  storage.setItem("canva-gemini-course:v1", JSON.stringify({
    schemaVersion: 1,
    progress: { ...createDefaultProgress(), theme: "system" }
  }));

  assert.equal(loadProgressState(storage).state.progress.theme, "light");
});

test("persists progress and browser choice flags", () => {
  const storage = new MemoryStorage();
  const state = { schemaVersion: 1, progress: createDefaultProgress() };

  assert.equal(saveProgressState(state, storage).saved, true);
  assert.deepEqual(loadProgressState(storage).state, state);
  assert.equal(loadWelcomeChoice(storage).dismissed, false);
  assert.equal(saveWelcomeChoice(storage).saved, true);
  assert.equal(loadWelcomeChoice(storage).dismissed, true);
  assert.equal(savePendingCloudReset("user-1", storage).saved, true);
  assert.equal(loadPendingCloudReset(storage).uid, "user-1");
  assert.equal(clearPendingCloudReset(storage).saved, true);
  assert.equal(loadPendingCloudReset(storage).uid, "");
});

test("reports browser storage failures to the caller", () => {
  const storageError = new Error("Storage is blocked.");
  const storage = {
    getItem() { throw storageError; },
    setItem() { throw storageError; }
  };

  const loadResult = loadProgressState(storage);
  assert.equal(loadResult.available, false);
  assert.equal(loadResult.error, storageError);
  assert.equal(saveProgressState({ schemaVersion: 1 }, storage).error, storageError);
});
