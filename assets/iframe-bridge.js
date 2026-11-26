(function () {
  "use strict";

  const LESSON_ID = document.documentElement.dataset.lessonId;

  function sendProgress(data) {
    if (!LESSON_ID || !data || typeof data !== "object") return;
    window.parent.postMessage({
      type: "LESSON_PROGRESS",
      lessonId: LESSON_ID,
      data
    }, window.location.origin);
  }

  window.IframeProgressBridge = { sendProgress };

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (event.origin !== window.location.origin) return;
    if (!event.data || typeof event.data !== "object") return;
    if (event.data.type !== "LOAD_LESSON_PROGRESS") return;
    if (event.data.lessonId !== LESSON_ID) return;
    if (!event.data.data || typeof event.data.data !== "object") return;
    window.dispatchEvent(new CustomEvent("lesson-progress-load", {
      detail: event.data.data
    }));
  });
})();
