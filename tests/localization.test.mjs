import assert from "node:assert/strict";
import test from "node:test";
import { getLocale, initializeLocale, setLocale, translate } from "../assets/localization/localization.mjs";
import english from "../assets/localization/locales/en.mjs";
import vietnamese from "../assets/localization/locales/vi.mjs";

test("loads a locale on demand and translates interpolated UI strings", async () => {
  assert.deepEqual(Object.keys(english).sort(), Object.keys(vietnamese).sort());
  await initializeLocale();
  await setLocale("vi");
  assert.equal(getLocale(), "vi");
  assert.equal(translate("week", { number: 3 }), "Tuần 3");

  assert.equal(await setLocale("en"), true);
  assert.equal(getLocale(), "en");
  assert.equal(translate("week", { number: 3 }), "Week 3");
  assert.equal(translate("retryLessonDescription", { title: "Lesson 2" }),
    "Could not load Lesson 2. Check your connection and try again.");
  assert.equal(await setLocale("fr"), false);
  assert.equal(getLocale(), "en");
  await setLocale("vi");
});
