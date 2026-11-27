import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProgressChanges,
  areProgressEqual,
  diffProgress,
  hasProgressData,
  mergeProgress,
  resolveSignInSyncStrategy,
  summarizeProgress
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

test("areProgressEqual ignores false checklist entries, empty notes, key order, and lesson order", () => {
  const local = {
    checklist: { "c-1": true, "c-2": false },
    lessonsDone: { "w1-d2": "2026-01-02", "w1-d1": "2026-01-01" },
    completedLessons: ["w1-d2", "w1-d1"],
    notes: { "w1-d1": "Hello", "w1-d2": "" },
    theme: "system",
    portfolio: [{ id: "p2", title: "B" }, { id: "p1", title: "A" }]
  };
  const cloud = {
    checklist: { "c-1": true },
    lessonsDone: { "w1-d1": "2026-01-01", "w1-d2": "2026-01-02" },
    completedLessons: ["w1-d1", "w1-d2"],
    notes: { "w1-d1": "Hello" },
    theme: "light",
    portfolio: [{ id: "p1", title: "A" }, { id: "p2", title: "B" }]
  };

  assert.equal(areProgressEqual(local, cloud), true);
  assert.deepEqual(summarizeProgress(local), {
    completedLessons: 2,
    checkedItems: 1,
    notesCount: 1,
    portfolioCount: 2
  });
});

test("mergeProgress keeps checked cloud checklist items and non-empty cloud notes when local is unchecked or empty", () => {
  const merged = mergeProgress(
    {
      checklist: { "c-1": false, "c-2": true },
      notes: { "w1-d1": "" },
      lessonsDone: {},
      completedLessons: [],
      portfolio: []
    },
    {
      checklist: { "c-1": true },
      notes: { "w1-d1": "Cloud note" },
      lessonsDone: {},
      completedLessons: [],
      portfolio: []
    }
  );

  assert.equal(merged.checklist["c-1"], true);
  assert.equal(merged.checklist["c-2"], true);
  assert.equal(merged.notes["w1-d1"], "Cloud note");
});

test("resolveSignInSyncStrategy avoids unnecessary overwrite prompts on logout/relogin and handles conflicts cleanly", () => {
  const base = {
    checklist: { "c-1": true },
    lessonsDone: { "w1-d1": "2026-01-01" },
    completedLessons: ["w1-d1"],
    notes: { "w1-d1": "Initial note" },
    theme: "light",
    portfolio: []
  };

  // 1. Logout then re-login into the same account with identical data: silent sync.
  assert.equal(
    resolveSignInSyncStrategy({
      localProgress: base,
      cloudProgress: { ...base },
      baselineProgress: base,
      lastSyncedUid: "uid-a",
      signingInUid: "uid-a"
    }).action,
    "already-in-sync"
  );

  // 2. Same account, cloud advanced on another device while local stayed at baseline: silent pull.
  const cloudNewer = {
    ...base,
    lessonsDone: { ...base.lessonsDone, "w1-d2": "2026-01-02" },
    completedLessons: ["w1-d1", "w1-d2"]
  };
  assert.equal(
    resolveSignInSyncStrategy({
      localProgress: base,
      cloudProgress: cloudNewer,
      baselineProgress: base,
      lastSyncedUid: "uid-a",
      signingInUid: "uid-a"
    }).action,
    "use-cloud"
  );

  // 3. Same account, local advanced offline while cloud stayed at baseline: silent upload.
  const localNewer = {
    ...base,
    checklist: { "c-1": true, "c-2": true }
  };
  assert.equal(
    resolveSignInSyncStrategy({
      localProgress: localNewer,
      cloudProgress: base,
      baselineProgress: base,
      lastSyncedUid: "uid-a",
      signingInUid: "uid-a"
    }).action,
    "replace-cloud"
  );

  // 4. Same account, both devices changed different lessons/checklists: seamless 3-way merge.
  assert.equal(
    resolveSignInSyncStrategy({
      localProgress: localNewer,
      cloudProgress: cloudNewer,
      baselineProgress: base,
      lastSyncedUid: "uid-a",
      signingInUid: "uid-a"
    }).action,
    "three-way-merge"
  );

  // 5. Same account, both devices edited the exact same lesson note differently: prompt recommending merge.
  const sameAccountConflict = resolveSignInSyncStrategy({
    localProgress: { ...base, notes: { "w1-d1": "Laptop edit" } },
    cloudProgress: { ...base, notes: { "w1-d1": "Phone edit" } },
    baselineProgress: base,
    lastSyncedUid: "uid-a",
    signingInUid: "uid-a"
  });
  assert.equal(sameAccountConflict.prompt, true);
  assert.equal(sameAccountConflict.reason, "same-account-conflict");
  assert.equal(sameAccountConflict.recommended, "merge");

  // 6. Different account signing into a browser holding Account A's progress: prompt recommending use-cloud.
  const differentAccount = resolveSignInSyncStrategy({
    localProgress: base,
    cloudProgress: cloudNewer,
    baselineProgress: null,
    lastSyncedUid: "uid-a",
    signingInUid: "uid-b"
  });
  assert.equal(differentAccount.prompt, true);
  assert.equal(differentAccount.reason, "different-account");
  assert.equal(differentAccount.recommended, "use-cloud");

  // 7. Guest with local progress signing into an account that already has cloud data: prompt recommending merge.
  const guestIntoExisting = resolveSignInSyncStrategy({
    localProgress: localNewer,
    cloudProgress: cloudNewer,
    baselineProgress: null,
    lastSyncedUid: "",
    signingInUid: "uid-a"
  });
  assert.equal(guestIntoExisting.prompt, true);
  assert.equal(guestIntoExisting.reason, "local-and-cloud-exist");
  assert.equal(guestIntoExisting.recommended, "merge");
});
