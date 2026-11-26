import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProgressChanges,
  diffProgress,
  hasProgressData,
  mergeProgress
} from "../assets/progress/progress-merge.mjs";

test("detects whether local progress is meaningful before cloud overwrite", () => {
  assert.equal(hasProgressData({
    checklist: {},
    lessonsDone: {},
    completedLessons: [],
    notes: {},
    theme: "system",
    portfolio: []
  }), false);
  assert.equal(hasProgressData({ theme: "light" }), false);
  assert.equal(hasProgressData({ checklist: { "check-1": true } }), true);
  assert.equal(hasProgressData({ portfolio: [{ id: "p1" }] }), true);
});

test("uses cloud progress when the local cache only has defaults", () => {
  const cloud = {
    checklist: { check1: true },
    lessonsDone: { "w1-d1": "2026-01-01" },
    completedLessons: ["w1-d1"],
    notes: { "w1-d1": "Cloud note" },
    theme: "dark",
    portfolio: [{ id: "p1", title: "Cloud item" }]
  };
  const local = {
    checklist: {},
    lessonsDone: {},
    completedLessons: [],
    notes: {},
    theme: "light",
    portfolio: []
  };

  assert.deepEqual(mergeProgress(local, cloud), cloud);
});

test("uses cloud theme over the default light theme when merging a first-time device", () => {
  assert.equal(
    mergeProgress({ theme: "light" }, { theme: "dark" }).theme,
    "dark"
  );
  assert.equal(mergeProgress({ theme: "light" }, {}).theme, "light");
});

test("unions progress and portfolio while local values win conflicts", () => {
  const cloud = {
    checklist: { check1: false, check2: true },
    lessonsDone: { "w1-d1": "2026-01-01" },
    completedLessons: ["w1-d1"],
    notes: { "w1-d1": "Cloud note" },
    theme: "dark",
    portfolio: [{ id: "p1", title: "Cloud item" }],
    futureField: { keep: true }
  };
  const local = {
    checklist: { check1: true },
    lessonsDone: { "w1-d1": "2026-02-01" },
    completedLessons: ["w1-d2"],
    notes: { "w1-d1": "Local note" },
    theme: "light",
    portfolio: [{ id: "p1", title: "Local item" }, { id: "p2", title: "New item" }],
    localField: "preserved"
  };

  assert.deepEqual(mergeProgress(local, cloud), {
    checklist: { check1: true, check2: true },
    lessonsDone: { "w1-d1": "2026-02-01" },
    completedLessons: ["w1-d1", "w1-d2"],
    notes: { "w1-d1": "Local note" },
    theme: "light",
    portfolio: [{ id: "p1", title: "Local item" }, { id: "p2", title: "New item" }],
    futureField: { keep: true },
    localField: "preserved"
  });
});

test("sync changes preserve remote updates and propagate local deletions", () => {
  const baseline = {
    checklist: { remove: true, keep: false },
    lessonsDone: { "w1-d1": "2026-01-01" },
    completedLessons: ["w1-d1"],
    notes: { "w1-d1": "Old note" },
    theme: "system",
    portfolio: [{ id: "p1", title: "Delete me" }]
  };
  const local = {
    checklist: { keep: true },
    lessonsDone: {},
    completedLessons: [],
    notes: {},
    theme: "dark",
    portfolio: []
  };
  const cloud = {
    checklist: { remove: true, keep: false, cloudOnly: true },
    lessonsDone: { "w1-d1": "2026-01-01" },
    completedLessons: ["w1-d1"],
    notes: { "w1-d1": "Old note", "w1-d2": "Remote note" },
    theme: "system",
    portfolio: [{ id: "p1", title: "Delete me" }, { id: "p2", title: "Remote item" }]
  };

  const synchronized = applyProgressChanges(cloud, diffProgress(baseline, local));

  assert.deepEqual(synchronized, {
    checklist: { keep: true, cloudOnly: true },
    lessonsDone: {},
    completedLessons: [],
    notes: { "w1-d2": "Remote note" },
    theme: "dark",
    portfolio: [{ id: "p2", title: "Remote item" }]
  });
});

test("an unchanged stale device does not restore a remotely deleted portfolio item", () => {
  const baseline = {
    checklist: {},
    lessonsDone: {},
    completedLessons: [],
    notes: {},
    theme: "system",
    portfolio: [{ id: "p1", title: "Removed on another device" }]
  };
  const cloud = {
    checklist: {},
    lessonsDone: {},
    completedLessons: [],
    notes: {},
    theme: "system",
    portfolio: []
  };

  assert.deepEqual(
    applyProgressChanges(cloud, diffProgress(baseline, baseline)),
    cloud
  );
});

test("the last local change wins a same-field conflict without replacing other cloud data", () => {
  const baseline = {
    checklist: { check1: false },
    lessonsDone: {},
    completedLessons: [],
    notes: {},
    theme: "system",
    portfolio: []
  };
  const local = { ...baseline, checklist: { check1: true } };
  const cloud = {
    ...baseline,
    checklist: { check1: false },
    notes: { "w1-d2": "Changed on another device" }
  };

  assert.deepEqual(
    applyProgressChanges(cloud, diffProgress(baseline, local)),
    { ...cloud, checklist: { check1: true } }
  );
});
