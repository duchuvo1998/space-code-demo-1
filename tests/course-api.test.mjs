import assert from "node:assert/strict";
import test from "node:test";
import {
  checkLessonAvailability,
  fetchCourseManifest
} from "../assets/course/course-api.mjs";
import { initializeLocale } from "../assets/localization/localization.mjs";

await initializeLocale();

async function withMockedFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("loads and validates the course manifest without browser caching", async () => {
  const manifest = { course: { title: "Course" }, lessons: [] };
  await withMockedFetch(async (url, options) => {
    assert.equal(url.href, "https://example.test/manifest.json");
    assert.deepEqual(options, { cache: "no-store" });
    return { ok: true, json: async () => manifest };
  }, async () => {
    assert.deepEqual(
      await fetchCourseManifest(new URL("https://example.test/manifest.json")),
      manifest
    );
  });
});

test("reports invalid or unavailable manifests", async () => {
  await withMockedFetch(async () => ({ ok: false, status: 503 }), async () => {
    await assert.rejects(
      fetchCourseManifest(new URL("https://example.test/manifest.json")),
      /HTTP 503/
    );
  });
  await withMockedFetch(async () => ({
    ok: true,
    json: async () => ({ lessons: [] })
  }), async () => {
    await assert.rejects(
      fetchCourseManifest(new URL("https://example.test/manifest.json")),
      /danh sách khóa học không hợp lệ/i
    );
  });
});

test("checks lesson availability through the shared request module", async () => {
  await withMockedFetch(async (_url, options) => {
    assert.deepEqual(options, { cache: "no-store" });
    return { ok: true };
  }, async () => {
    assert.equal(
      await checkLessonAvailability(new URL("https://example.test/lesson.html")),
      true
    );
  });
});
