(function () {
  "use strict";

  const LESSON_ID = document.documentElement.dataset.lessonId;
  const COPY_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg>';

  let lastReportedHeight = 0;
  let progressHydrated = false;
  let lastSaveState = "idle";
  let uiLabels = {
    copyPrompt: "Sao chép",
    copyPromptAria: "Sao chép mẫu prompt",
    copiedPrompt: "Đã sao chép",
    notesAutoSave: "Tự động lưu trên trình duyệt",
    notesSaving: "Đang lưu ghi chú...",
    notesSaved: "Đã lưu ghi chú",
    notesSaveError: "Không thể lưu ghi chú"
  };

  function postToParent(payload) {
    if (!LESSON_ID || window.parent === window) return;
    window.parent.postMessage(payload, window.location.origin);
  }

  function updateNotesStatus(state) {
    lastSaveState = state || "idle";
    const statusEl = document.getElementById("lessonNotesStatus");
    if (!statusEl) return;
    statusEl.dataset.state = lastSaveState;
    if (lastSaveState === "saving") statusEl.textContent = uiLabels.notesSaving;
    else if (lastSaveState === "saved") statusEl.textContent = uiLabels.notesSaved;
    else if (lastSaveState === "error") statusEl.textContent = uiLabels.notesSaveError;
    else statusEl.textContent = uiLabels.notesAutoSave;
  }

  function sendProgress(data) {
    if (!LESSON_ID || !data || typeof data !== "object") return;
    updateNotesStatus("saving");
    postToParent({
      type: "LESSON_PROGRESS",
      lessonId: LESSON_ID,
      data
    });
  }

  function measureContentHeight() {
    if (!document.body) return 0;
    const bodyStyle = window.getComputedStyle(document.body);
    const paddingBottom = parseFloat(bodyStyle.paddingBottom) || 0;
    const marginTop = parseFloat(bodyStyle.marginTop) || 0;
    const marginBottom = parseFloat(bodyStyle.marginBottom) || 0;
    let maxBottom = document.body.getBoundingClientRect().height + marginTop + marginBottom;
    const children = document.body.children;
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const rect = child.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) continue;
      const childStyle = window.getComputedStyle(child);
      const childMarginBottom = parseFloat(childStyle.marginBottom) || 0;
      const bottom = rect.bottom + window.scrollY + childMarginBottom + paddingBottom + marginBottom;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return Math.max(320, Math.ceil(maxBottom) + 12);
  }

  function reportHeight() {
    if (!LESSON_ID || window.parent === window) return;
    const height = measureContentHeight();
    if (!height || height === lastReportedHeight) return;
    lastReportedHeight = height;
    postToParent({
      type: "LESSON_RESIZE",
      lessonId: LESSON_ID,
      height
    });
  }

  function fallbackCopyText(text) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.top = "-9999px";
    helper.style.left = "-9999px";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.focus({ preventScroll: true });
    helper.select();
    helper.setSelectionRange(0, text.length);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    helper.remove();
    return copied;
  }

  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fall through to parent clipboard or execCommand fallback.
      }
    }
    if (window.parent && window.parent !== window) {
      try {
        if (window.parent.navigator?.clipboard?.writeText) {
          await window.parent.navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // Fall through to execCommand fallback.
      }
    }
    return fallbackCopyText(text);
  }

  function selectElementText(element) {
    if (!window.getSelection || !document.createRange) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function applyCopyButtonLabel(button, copied) {
    const icon = copied ? CHECK_ICON : COPY_ICON;
    const label = copied ? uiLabels.copiedPrompt : uiLabels.copyPrompt;
    button.classList.toggle("is-copied", copied);
    button.setAttribute("aria-label", uiLabels.copyPromptAria);
    button.innerHTML = icon + '<span class="prompt-copy-label">' + label + "</span>";
  }

  function applyUiLabels(nextLabels) {
    if (!nextLabels || typeof nextLabels !== "object") return;
    uiLabels = { ...uiLabels, ...nextLabels };
    document.querySelectorAll(".prompt-copy-btn").forEach(button => {
      applyCopyButtonLabel(button, button.classList.contains("is-copied"));
    });
    updateNotesStatus(lastSaveState);
  }

  function enhancePromptBoxes() {
    document.querySelectorAll(".prompt-box").forEach(box => {
      const pre = box.querySelector("pre");
      if (!pre || box.querySelector(".prompt-copy-btn")) return;

      const header = document.createElement("div");
      header.className = "prompt-box-header";

      const title = box.firstElementChild && box.firstElementChild.tagName === "STRONG"
        ? box.firstElementChild
        : null;
      if (title) {
        title.classList.add("prompt-box-title");
        header.appendChild(title);
      } else {
        const fallbackTitle = document.createElement("strong");
        fallbackTitle.className = "prompt-box-title";
        fallbackTitle.textContent = "Prompt";
        header.appendChild(fallbackTitle);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-sm prompt-copy-btn";
      applyCopyButtonLabel(button, false);

      let resetTimer = null;
      button.addEventListener("click", async () => {
        const promptText = (pre.textContent || "").trim();
        if (!promptText) return;
        const copied = await copyText(promptText);
        if (copied) {
          applyCopyButtonLabel(button, true);
          clearTimeout(resetTimer);
          resetTimer = setTimeout(() => {
            applyCopyButtonLabel(button, false);
          }, 2000);
        } else {
          selectElementText(pre);
        }
        postToParent({
          type: "LESSON_COPY_PROMPT",
          lessonId: LESSON_ID,
          copied
        });
      });

      header.appendChild(button);
      box.insertBefore(header, pre);
    });
  }

  function enhanceNotesSection() {
    const notes = document.getElementById("lessonNotes");
    if (!notes || document.getElementById("lessonNotesStatus")) return;

    const status = document.createElement("span");
    status.id = "lessonNotesStatus";
    status.className = "notes-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const heading = notes.previousElementSibling;
    if (heading && /^H[2-4]$/.test(heading.tagName)) {
      const header = document.createElement("div");
      header.className = "notes-header";
      heading.parentNode.insertBefore(header, heading);
      header.appendChild(heading);
      header.appendChild(status);
    } else {
      notes.parentNode.insertBefore(status, notes);
    }
    updateNotesStatus(lastSaveState);
  }

  function sendReady() {
    if (progressHydrated) return;
    postToParent({
      type: "LESSON_READY",
      lessonId: LESSON_ID
    });
  }

  function initEnhancements() {
    enhancePromptBoxes();
    enhanceNotesSection();
    reportHeight();
    // Defer ready handshake until inline lesson scripts finish registering listeners.
    setTimeout(sendReady, 0);
  }

  window.IframeProgressBridge = { sendProgress, reportHeight };

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => requestAnimationFrame(reportHeight));
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  }
  if ("MutationObserver" in window && document.body) {
    const mutationObserver = new MutationObserver(() => requestAnimationFrame(reportHeight));
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "hidden", "class", "style"]
    });
  }

  document.addEventListener("toggle", () => requestAnimationFrame(reportHeight), true);
  window.addEventListener("load", () => {
    reportHeight();
    sendReady();
  });
  window.addEventListener("resize", () => requestAnimationFrame(reportHeight));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(reportHeight).catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEnhancements, { once: true });
  } else {
    initEnhancements();
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (event.origin !== window.location.origin) return;
    if (!event.data || typeof event.data !== "object") return;
    if (event.data.lessonId !== LESSON_ID) return;

    if (event.data.type === "UPDATE_LESSON_UI") {
      applyUiLabels(event.data.labels);
      requestAnimationFrame(reportHeight);
      return;
    }

    if (event.data.type === "LESSON_SAVE_STATUS") {
      updateNotesStatus(event.data.status);
      return;
    }

    if (event.data.type !== "LOAD_LESSON_PROGRESS") return;
    if (!event.data.data || typeof event.data.data !== "object") return;
    progressHydrated = true;
    applyUiLabels(event.data.labels);
    window.dispatchEvent(new CustomEvent("lesson-progress-load", {
      detail: event.data.data
    }));
    updateNotesStatus("idle");
    requestAnimationFrame(reportHeight);
  });
})();
