(function () {
  "use strict";

  const LESSON_ID = document.documentElement.dataset.lessonId;
  let lastReportedHeight = 0;

  function sendProgress(data) {
    if (!LESSON_ID || !data || typeof data !== "object") return;
    window.parent.postMessage({
      type: "LESSON_PROGRESS",
      lessonId: LESSON_ID,
      data
    }, window.location.origin);
  }

  function reportHeight() {
    if (!LESSON_ID || window.parent === window) return;
    const height = Math.ceil(Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    ));
    if (height === lastReportedHeight) return;
    lastReportedHeight = height;
    window.parent.postMessage({
      type: "LESSON_RESIZE",
      lessonId: LESSON_ID,
      height
    }, window.location.origin);
  }

  window.IframeProgressBridge = { sendProgress };

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(reportHeight);
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  }
  window.addEventListener("load", reportHeight);
  window.addEventListener("resize", reportHeight);
  requestAnimationFrame(reportHeight);

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
