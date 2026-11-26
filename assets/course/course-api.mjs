import { translate as t } from "../localization/localization.mjs";

export async function fetchCourseManifest(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(t("manifestHttpError", { status: response.status }));
  }

  const manifest = await response.json();
  if (!manifest.course || !Array.isArray(manifest.lessons)) {
    throw new Error(t("invalidManifest"));
  }
  return manifest;
}

export async function checkLessonAvailability(url) {
  const response = await fetch(url, { cache: "no-store" });
  return response.ok;
}
