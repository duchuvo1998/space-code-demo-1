import { checkLessonAvailability } from "./course-api.mjs";
import { UI_ICONS } from "../ui/ui-icons.mjs";

export function createCourseViews({
  app,
  sidebar,
  getManifest,
  getProgress,
  escapeHtml,
  t,
  closeMobileMenu,
  openPortfolioModal,
  deletePortfolio
}) {
  let lessonFrame = null;
  let lessonRenderSequence = 0;
  let weekFilter = "all";
  let lessonFilter = "all";
  const expandedWeeks = new Set();
  const collapsedWeeks = new Set();

  function getLessonById(id) {
    const manifest = getManifest();
    return manifest ? manifest.lessons.find(lesson => lesson.id === id) : null;
  }

  function getWeekStats(weekNumber) {
    const manifest = getManifest();
    const lessons = manifest.lessons.filter(lesson => lesson.weekNumber === weekNumber);
    const progress = getProgress();
    let done = 0;
    let started = false;
    lessons.forEach(lesson => {
      const lessonDone = progress.completedLessons.includes(lesson.id) || progress.lessonsDone[lesson.id];
      if (lessonDone) done++;
      if (
        lessonDone ||
        (lesson.checklistIds || []).some(id => progress.checklist[id]) ||
        (typeof progress.notes[lesson.id] === "string" && Boolean(progress.notes[lesson.id].trim()))
      ) started = true;
    });
    return { total: lessons.length, done, started, pct: lessons.length ? Math.round(done / lessons.length * 100) : 0 };
  }

  function getCourseStats() {
    const manifest = getManifest();
    const progress = getProgress();
    let doneLessons = 0;
    manifest.lessons.forEach(lesson => {
      if (progress.completedLessons.includes(lesson.id) || progress.lessonsDone[lesson.id]) doneLessons++;
    });
    const doneChecks = Object.values(progress.checklist).filter(Boolean).length;
    return { totalLessons: manifest.lessons.length, doneLessons, doneChecks };
  }

  function renderSidebar() {
    const manifest = getManifest();
    const progress = getProgress();
    const hash = location.hash;
    const activeLessonMatch = /^#course\/canva-gemini\/lesson\/([^/?]+)/.exec(hash);
    const activeWeekMatch = /^#course\/canva-gemini\/week\/([^/?]+)/.exec(hash);
    const activeLessonWeek = activeLessonMatch
      ? manifest.lessons.find(lesson => lesson.id === activeLessonMatch[1])?.weekNumber
      : null;
    const currentWeek = activeWeekMatch ? Number(activeWeekMatch[1].slice(1)) : activeLessonWeek;
    let html = `
      <div class="nav-group-label">${t("overview")}</div>
      <button type="button" class="nav-btn ${(!hash || hash.includes("/dashboard")) ? "active" : ""}" data-route="dashboard"><span>${UI_ICONS.home} ${t("courseRoadmap")}</span></button>
      <button type="button" class="nav-btn ${hash.includes("/portfolio") ? "active" : ""}" data-route="portfolio"><span>${UI_ICONS.folder} ${t("learningPortfolio")}</span><span class="pill pill-ready">${progress.portfolio.length}</span></button>
      <a class="nav-btn nav-link" href="./ngannk.html" aria-label="${t("openLegacyPage")}" title="${t("openLegacyPage")}"><span>${UI_ICONS.book} ${t("legacyPage")}</span>${UI_ICONS.external}</a>
      <div class="nav-group-label">${t("courseWeeks")}</div>
    `;
    for (let weekNumber = 1; weekNumber <= 8; weekNumber++) {
      const stats = getWeekStats(weekNumber);
      const activeWeek = activeWeekMatch?.[1] === `w${weekNumber}`;
      const weekOpen = expandedWeeks.has(weekNumber)
        || (currentWeek === weekNumber && !collapsedWeeks.has(weekNumber));
      const weekLabel = t("week", { number: weekNumber });
      html += `<div class="nav-week-row">
        <button type="button" class="nav-btn nav-week-link ${activeWeek || activeLessonWeek === weekNumber ? "active" : ""}" data-route="week" data-week="${weekNumber}"><span>${weekLabel}</span><span class="pill ${stats.done === stats.total ? "pill-done" : "pill-ready"}">${stats.pct}%</span></button>
        <button type="button" class="nav-week-toggle" data-week-toggle="${weekNumber}" aria-expanded="${weekOpen}" aria-label="${t(weekOpen ? "collapseWeekLessons" : "expandWeekLessons", { week: weekLabel })}">${UI_ICONS.chevronDown}</button>
      </div>
      <div class="nav-sub" ${weekOpen ? "" : "hidden"}>`;
      manifest.lessons.filter(lesson => lesson.weekNumber === weekNumber).forEach(lesson => {
        const done = progress.completedLessons.includes(lesson.id) || !!progress.lessonsDone[lesson.id];
        const activeLesson = activeLessonMatch?.[1] === lesson.id;
        html += `<button type="button" class="nav-btn ${activeLesson ? "active" : ""}" data-route="lesson" data-id="${escapeHtml(lesson.id)}"><span>${done ? UI_ICONS.check : ""}${t("day", { number: lesson.id.split("-d")[1] || "" })}</span></button>`;
      });
      html += `</div>`;
    }
    sidebar.innerHTML = html;
    sidebar.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleRoute));
    sidebar.querySelectorAll("[data-week-toggle]").forEach(button => button.addEventListener("click", () => {
      const weekNumber = Number(button.dataset.weekToggle);
      if (button.getAttribute("aria-expanded") === "true") {
        expandedWeeks.delete(weekNumber);
        collapsedWeeks.add(weekNumber);
      } else {
        collapsedWeeks.delete(weekNumber);
        expandedWeeks.add(weekNumber);
      }
      renderSidebar();
    }));
  }

  function handleRoute(event) {
    const button = event.currentTarget;
    const route = button.dataset.route;
    if (route === "dashboard") location.hash = "#course/canva-gemini/dashboard";
    if (route === "portfolio") location.hash = "#course/canva-gemini/portfolio";
    if (route === "week") {
      const weekId = String(button.dataset.week).startsWith("w") ? button.dataset.week : `w${button.dataset.week}`;
      location.hash = `#course/canva-gemini/week/${weekId}`;
    }
    if (route === "lesson") location.hash = `#course/canva-gemini/lesson/${button.dataset.id}`;
    closeMobileMenu();
  }

  function renderDashboard() {
    const manifest = getManifest();
    const stats = getCourseStats();
    const progress = getProgress();
    const courseComplete = manifest.lessons.length > 0 && stats.doneLessons === stats.totalLessons;
    const next = courseComplete ? null :
      manifest.lessons.find(lesson => !progress.completedLessons.includes(lesson.id) && !progress.lessonsDone[lesson.id]) ||
      manifest.lessons[0];
    const hasStarted = manifest.lessons.some(lesson =>
      progress.completedLessons.includes(lesson.id) ||
      progress.lessonsDone[lesson.id] ||
      (lesson.checklistIds || []).some(id => progress.checklist[id]) ||
      (typeof progress.notes[lesson.id] === "string" && Boolean(progress.notes[lesson.id].trim()))
    );
    let timeline = "";
    for (let weekNumber = 1; weekNumber <= 8; weekNumber++) {
      const weekStats = getWeekStats(weekNumber);
      const weekLessons = manifest.lessons.filter(lesson => lesson.weekNumber === weekNumber);
      const weekStatus = weekStats.done === weekStats.total
        ? t("completed")
        : weekStats.started ? t("inProgress") : t("notStarted");
      const weekStatusClass = weekStats.done === weekStats.total
        ? "pill-done"
        : weekStats.started ? "pill-ready" : "";
      timeline += `<button type="button" class="week-card" data-route="week" data-week="${weekNumber}">
        <div class="week-card-top"><strong>${t("week", { number: weekNumber })}</strong><span class="pill ${weekStatusClass}">${weekStatus}</span></div>
        <strong style="margin-bottom:6px;">${escapeHtml(weekLessons[0]?.title || "")}</strong>
        <div style="margin-top:auto"><div class="week-progress-label"><span>${t("lessonCount", { done: weekStats.done, total: weekStats.total })}</span><span>${weekStats.pct}%</span></div><div class="progress-track" role="progressbar" aria-label="${t("progressForWeek", { number: weekNumber })}" aria-valuenow="${weekStats.pct}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${weekStats.pct}%"></div></div></div>
      </button>`;
    }
    app.innerHTML = `
      <div class="card hero-card">
        <h1>${escapeHtml(manifest.course.title)}</h1>
        <p>${t("courseIntro")}</p>
        <div class="course-progress-label"><span>${t("lessonProgress")}</span><span>${stats.doneLessons}/${stats.totalLessons}</span></div>
        <div class="progress-track" role="progressbar" aria-label="${t("courseProgress")}" aria-valuenow="${stats.totalLessons ? Math.round(stats.doneLessons / stats.totalLessons * 100) : 0}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${stats.totalLessons ? stats.doneLessons / stats.totalLessons * 100 : 0}%"></div></div>
      </div>
      ${next ? `<section class="card next-lesson-card"><div><span class="eyebrow">${t(hasStarted ? "continueLearningEyebrow" : "startHereEyebrow")}</span><h2>${t(hasStarted ? "nextLesson" : "firstLesson")}</h2><p>${escapeHtml(next.title)}</p></div><button type="button" class="btn btn-primary" data-route="lesson" data-id="${escapeHtml(next.id)}">${t(hasStarted ? "continueLearning" : "startLearning")} <span aria-hidden="true">→</span></button></section>` : ""}
      ${courseComplete ? `<section class="card next-lesson-card"><div><span class="eyebrow">${t("roadmapCompleteEyebrow")}</span><h2>${t("courseComplete")}</h2><p>${t("reviewPortfolio")}</p></div><button type="button" class="btn btn-primary" data-route="portfolio">${t("openPortfolio")} <span aria-hidden="true">→</span></button></section>` : ""}
      <div class="stats-grid">
        <div class="stat-box"><div class="stat-num">${stats.doneLessons}/${stats.totalLessons}</div><div class="stat-label">${t("completedLessons")}</div></div>
        <div class="stat-box"><div class="stat-num">${stats.doneChecks}</div><div class="stat-label">${t("checkedItems")}</div></div>
        <div class="stat-box"><div class="stat-num">8</div><div class="stat-label">${t("learningWeeks")}</div></div>
        <div class="stat-box"><div class="stat-num">${progress.portfolio.length}</div><div class="stat-label">${t("portfolioProducts")}</div></div>
      </div>
      <section class="card"><h2>${t("eightWeekRoadmap")}</h2><div class="timeline-grid">${timeline}</div></section>
    `;
    app.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleRoute));
  }

  function renderWeek(weekId) {
    const manifest = getManifest();
    const match = /^w(\d+)$/.exec(weekId);
    if (!match) return renderDashboard();
    const weekNumber = Number(match[1]);
    const lessons = manifest.lessons.filter(lesson => lesson.weekNumber === weekNumber);
    if (!lessons.length) {
      app.innerHTML = `<div class="card"><button type="button" class="btn" data-route="dashboard">${t("backToRoadmap")}</button><h1>${t("week", { number: weekNumber })}</h1><p>${t("noLessonsThisWeek")}</p></div>`;
    } else {
      app.innerHTML = `<div class="card"><button type="button" class="btn" data-route="dashboard">${t("backToRoadmap")}</button><h1>${t("week", { number: weekNumber })}</h1><p>${t("lessonsForWeek", { number: weekNumber })}</p><div>${lessons.map(lesson => `<div class="portfolio-item" style="align-items:center"><div style="flex:1"><strong>${escapeHtml(lesson.title)}</strong></div><button type="button" class="btn btn-primary" data-route="lesson" data-id="${escapeHtml(lesson.id)}">${t("openLesson")}</button></div>`).join("")}</div></div>`;
    }
    app.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleRoute));
  }

  async function renderLesson(lessonId, renderSequence = ++lessonRenderSequence) {
    const manifest = getManifest();
    const lesson = getLessonById(lessonId);
    if (!lesson) {
      app.innerHTML = `<div class="card"><h1>${t("lessonNotFound")}</h1><p>${t("lessonMissingFromManifest")}</p><button type="button" class="btn" data-route="dashboard">${t("home")}</button></div>`;
      app.querySelector("[data-route]").addEventListener("click", handleRoute);
      return;
    }
    const lessonIndex = manifest.lessons.findIndex(item => item.id === lessonId);
    const lessonDay = lesson.id.split("-d")[1] || "";
    const previousLesson = lessonIndex > 0 ? manifest.lessons[lessonIndex - 1] : null;
    const nextLesson = lessonIndex >= 0 && lessonIndex < manifest.lessons.length - 1 ? manifest.lessons[lessonIndex + 1] : null;
    const courseBaseUrl = new URL("./courses/canva-gemini/", document.baseURI);
    const lessonUrl = new URL(lesson.src, courseBaseUrl).href;
    app.innerHTML = `<div class="lesson-loading card" role="status" aria-live="polite" aria-busy="true">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>${t("loadingLesson", { title: `<strong>${escapeHtml(lesson.title)}</strong>` })}</span>
    </div>`;
    let lessonExists = false;
    try {
      lessonExists = await checkLessonAvailability(lessonUrl);
    } catch (error) {
      lessonExists = false;
    }
    if (renderSequence !== lessonRenderSequence) return;
    if (!lessonExists) {
      app.innerHTML = `<div class="card"><h1>${t("unableToLoadLesson")}</h1><p>${t("retryLessonDescription", { title: escapeHtml(lesson.title) })}</p><div class="lesson-load-actions"><button type="button" class="btn" data-route="week" data-week="w${lesson.weekNumber}">${t("backToWeek", { number: lesson.weekNumber })}</button><button type="button" class="btn btn-primary" id="retryLessonButton">${t("retry")}</button></div></div>`;
      app.querySelector("[data-route]").addEventListener("click", handleRoute);
      document.getElementById("retryLessonButton").addEventListener("click", () => {
        void renderLesson(lessonId);
      });
      return;
    }
    lessonFrame = document.createElement("iframe");
    lessonFrame.className = "lesson-frame";
    lessonFrame.title = lesson.title;
    lessonFrame.dataset.lessonId = lesson.id;
    lessonFrame.sandbox = "allow-scripts allow-same-origin";
    lessonFrame.referrerPolicy = "strict-origin";
    lessonFrame.addEventListener("load", () => {
      if (renderSequence !== lessonRenderSequence || !lessonFrame?.contentWindow) return;
      const loadingOverlay = app.querySelector(".lesson-frame-loading");
      loadingOverlay?.setAttribute("hidden", "");
      app.querySelector(".lesson-frame-wrap")?.setAttribute("aria-busy", "false");
      lessonFrame.contentDocument.documentElement.dataset.theme = document.documentElement.dataset.theme;
      const progress = getProgress();
      const checklist = {};
      (lesson.checklistIds || []).forEach(id => {
        checklist[id] = !!progress.checklist[id];
      });
      const data = {
        checklist,
        notes: progress.notes[lessonId] || "",
        completed: progress.completedLessons.includes(lessonId) || !!progress.lessonsDone[lessonId],
        date: typeof progress.lessonsDone[lessonId] === "string" ? progress.lessonsDone[lessonId] : ""
      };
      lessonFrame.contentWindow.postMessage({ type: "LOAD_LESSON_PROGRESS", lessonId, data }, window.location.origin);
    });
    lessonFrame.src = lessonUrl;
    app.innerHTML = `<div class="lesson-shell">
      <div class="lesson-toolbar">
        ${previousLesson ? `<button type="button" class="btn btn-sm" data-route="lesson" data-id="${escapeHtml(previousLesson.id)}">${t("previousLesson")}</button>` : `<button type="button" class="btn btn-sm" data-route="week" data-week="w${lesson.weekNumber}">${t("week", { number: lesson.weekNumber })}</button>`}
        <div class="lesson-toolbar-title"><strong>${escapeHtml(lesson.title)}</strong><span>${t("lessonPosition", { current: lessonIndex + 1, total: manifest.lessons.length, week: lesson.weekNumber, day: lessonDay })}</span></div>
        <details class="lesson-jump-menu">
          <summary class="btn btn-sm">${t("lessonSections")} ${UI_ICONS.chevronDown}</summary>
          <div class="lesson-jump-options">
            <button type="button" data-lesson-jump="Hướng dẫn thực hành từng bước">${t("jumpPractice")}</button>
            <button type="button" data-lesson-jump="Bài tập thực hành &amp; Sản phẩm đầu ra">${t("jumpExercises")}</button>
            <button type="button" data-lesson-jump="Checklist hoàn thành đo lường được">${t("jumpChecklist")}</button>
          </div>
        </details>
        ${nextLesson ? `<button type="button" class="btn btn-sm btn-primary" data-route="lesson" data-id="${escapeHtml(nextLesson.id)}">${t("nextLessonButton")}</button>` : `<button type="button" class="btn btn-sm" data-route="week" data-week="w${lesson.weekNumber}">${t("finishCourse")}</button>`}
      </div>
      <div class="lesson-frame-wrap" aria-busy="true">
        <div class="lesson-frame-loading" role="status" aria-live="polite">
          <span class="loading-spinner" aria-hidden="true"></span>
          <span>${t("loadingLessonContent")}</span>
        </div>
      </div>
    </div>`;
    const lessonShell = app.querySelector(".lesson-shell");
    lessonShell.querySelector(".lesson-frame-wrap").appendChild(lessonFrame);
    const endCard = document.createElement("section");
    endCard.className = "card lesson-end-card";
    endCard.innerHTML = nextLesson
      ? `<div><span class="eyebrow">${t("nextStep")}</span><h2>${t("afterLesson")}</h2><p>${escapeHtml(nextLesson.title)}</p></div><button type="button" class="btn btn-primary" data-route="lesson" data-id="${escapeHtml(nextLesson.id)}">${t("goToNextLesson")} <span aria-hidden="true">→</span></button>`
      : `<div><span class="eyebrow">${t("lastLesson")}</span><h2>${t("endOfRoadmap")}</h2><p>${t("finishChecklist")}</p></div><button type="button" class="btn btn-primary" data-route="dashboard">${t("backToRoadmap")} <span aria-hidden="true">→</span></button>`;
    lessonShell.appendChild(endCard);
    app.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleRoute));
    app.querySelectorAll("[data-lesson-jump]").forEach(button => button.addEventListener("click", () => {
      const targetTitle = button.dataset.lessonJump;
      const headings = [...lessonFrame.contentDocument.querySelectorAll("body > .card > h2")];
      const targetHeading = headings.find(heading => heading.textContent.trim() === targetTitle);
      const target = targetHeading?.closest(".card");
      if (!target || !targetHeading) return;
      const frameTop = lessonFrame.getBoundingClientRect().top + window.scrollY;
      const targetTop = target.getBoundingClientRect().top;
      const toolbarOffset = document.querySelector(".topbar").getBoundingClientRect().height +
        app.querySelector(".lesson-toolbar").getBoundingClientRect().height + 12;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: Math.max(0, frameTop + targetTop - toolbarOffset), behavior: reduceMotion ? "auto" : "smooth" });
      app.querySelector(".lesson-jump-menu").open = false;
      targetHeading.tabIndex = -1;
      targetHeading.focus({ preventScroll: true });
    }));
  }

  function renderPortfolio() {
    const manifest = getManifest();
    const progress = getProgress();
    let items = progress.portfolio;
    if (weekFilter !== "all") items = items.filter(item => item.lessonId && item.lessonId.startsWith(weekFilter));
    if (lessonFilter !== "all") items = items.filter(item => item.lessonId === lessonFilter);
    app.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h1>${t("learningPortfolio")}</h1><button type="button" class="btn btn-primary" id="addPortfolio">${t("addProduct")}</button></div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <select id="pfWeekFilter"><option value="all">${t("allWeeks")}</option>${Array.from({length:8},(_,i)=>`<option value="w${i+1}" ${weekFilter===`w${i+1}`?"selected":""}>${t("week", { number: i + 1 })}</option>`).join("")}</select>
          <select id="pfLessonFilter"><option value="all">${t("allLessons")}</option>${manifest.lessons.map(lesson=>`<option value="${escapeHtml(lesson.id)}" ${lessonFilter===lesson.id?"selected":""}>${escapeHtml(lesson.title)}</option>`).join("")}</select>
        </div>
        ${items.length ? items.map(item=>`<div class="portfolio-item"><div style="flex:1"><strong>${escapeHtml(item.title)}</strong><div style="font-size:13px;color:var(--muted);margin-top:3px">${escapeHtml(item.lessonId)} · ${escapeHtml(item.date)}</div>${item.link?`<div><a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${t("openLink")}</a></div>`:""}${item.note?`<p>${escapeHtml(item.note)}</p>`:""}</div><div style="display:flex;gap:6px"><button type="button" class="btn btn-sm" data-edit-pf="${escapeHtml(item.id)}">${t("edit")}</button><button type="button" class="btn btn-sm btn-danger" data-del-pf="${escapeHtml(item.id)}">${t("delete")}</button></div></div>`).join("") : `<p>${t("noPortfolioItems")}</p>`}
      </div>
    `;
    document.getElementById("addPortfolio").addEventListener("click", () => openPortfolioModal());
    document.getElementById("pfWeekFilter").addEventListener("change", event => { weekFilter = event.target.value; renderPortfolio(); });
    document.getElementById("pfLessonFilter").addEventListener("change", event => { lessonFilter = event.target.value; renderPortfolio(); });
    app.querySelectorAll("[data-edit-pf]").forEach(button => button.addEventListener("click", () => openPortfolioModal(button.dataset.editPf)));
    app.querySelectorAll("[data-del-pf]").forEach(button => button.addEventListener("click", () => deletePortfolio(button.dataset.delPf)));
  }

  function route() {
    const manifest = getManifest();
    if (!manifest) return;
    const renderSequence = ++lessonRenderSequence;
    document.getElementById("searchResults")?.remove();
    const hash = location.hash || "#course/canva-gemini/dashboard";
    const lessonMatch = /^#course\/canva-gemini\/lesson\/([^/?]+)/.exec(hash);
    const weekMatch = /^#course\/canva-gemini\/week\/([^/?]+)/.exec(hash);
    if (hash.includes("/portfolio")) renderPortfolio();
    else if (lessonMatch) void renderLesson(decodeURIComponent(lessonMatch[1]), renderSequence);
    else if (weekMatch) renderWeek(decodeURIComponent(weekMatch[1]));
    else renderDashboard();
    renderSidebar();
  }

  return {
    getLessonById,
    getLessonFrame: () => lessonFrame,
    handleRoute,
    renderPortfolio,
    renderSidebar,
    route
  };
}
