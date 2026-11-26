const STORAGE_KEY = "canva-gemini-course:v1";
const WRITE_DELAY = 700;
const CLOUD_PAYLOAD_LIMIT = 900000;

let manifest = null;
let manifestUrl = null;
let lessonFrame = null;
let state = loadState();
let saveTimer = null;
let storageAvailable = true;
let pfWeekFilter = "all";
let pfLessonFilter = "all";
let searchQuery = "";

const app = document.getElementById("app");
const sidebar = document.getElementById("sidebar");

function defaultProgress() {
  return {
    checklist: {},
    lessonsDone: {},
    completedLessons: [],
    notes: {},
    theme: "system",
    portfolio: []
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { schemaVersion: 1, progress: defaultProgress() };
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) throw new Error("Dữ liệu tiến độ không hợp lệ");

    if (parsed.schemaVersion === 1 && isObject(parsed.progress)) {
      const progress = parsed.progress;
      const normalized = { ...defaultProgress(), ...progress };
      normalized.checklist = isObject(progress.checklist) ? progress.checklist : {};
      normalized.lessonsDone = isObject(progress.lessonsDone) ? progress.lessonsDone : {};
      normalized.completedLessons = Array.isArray(progress.completedLessons) ? progress.completedLessons : [];
      normalized.notes = isObject(progress.notes) ? progress.notes : {};
      normalized.portfolio = Array.isArray(progress.portfolio) ? progress.portfolio : [];
      normalized.theme = ["system", "light", "dark"].includes(normalized.theme) ? normalized.theme : "system";
      return { ...parsed, schemaVersion: 1, progress: normalized };
    }

    const progress = defaultProgress();
    progress.checklist = isObject(parsed.checklist) ? parsed.checklist : {};
    progress.lessonsDone = isObject(parsed.lessonsDone) ? parsed.lessonsDone : {};
    progress.completedLessons = Object.keys(progress.lessonsDone);
    progress.notes = isObject(parsed.notes) ? parsed.notes : {};
    progress.portfolio = Array.isArray(parsed.portfolio) ? parsed.portfolio : [];
    progress.theme = ["system", "light", "dark"].includes(parsed.theme) ? parsed.theme : "system";
    return { ...parsed, schemaVersion: 1, progress };
  } catch (error) {
    storageAvailable = false;
    return { schemaVersion: 1, progress: defaultProgress(), _malformedExistingData: true };
  }
}

function getProgress() {
  return state.progress;
}

function applyTheme() {
  const theme = getProgress().theme || "system";
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolved;
}

function updateStorageBanner() {
  document.getElementById("storageWarn").classList.toggle("show", !storageAvailable);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  document.getElementById("saveStatus").textContent = "Đang lưu...";
  const syncStatus = document.getElementById("syncStatus");
  if (syncStatus) syncStatus.textContent = "Đang lưu...";
  document.getElementById("saveStatus").classList.add("show");
  saveTimer = setTimeout(() => {
    void saveProgress();
  }, WRITE_DELAY);
}

async function saveProgress() {
  try {
    const payload = JSON.stringify(state);
    const byteLength = new TextEncoder().encode(payload).length;
    if (byteLength > CLOUD_PAYLOAD_LIMIT) throw new Error("Dữ liệu vượt giới hạn 900 KB");
    localStorage.setItem(STORAGE_KEY, payload);
    storageAvailable = true;
    updateStorageBanner();
  } catch (error) {
    storageAvailable = false;
    updateStorageBanner();
  }

  // FIREBASE_HOOK: Google Sign-In + onAuthStateChanged
  // FIREBASE_HOOK: getDoc users/{uid}/course/progress
  // FIREBASE_HOOK: setDoc users/{uid}/course/progress after debounce
  // FIREBASE_HOOK: merge localStorage cache with cloud progress
  await window.courseAppHooks.saveProgress(getProgress());
  const saveLabel = storageAvailable ? "Đã lưu" : "Chỉ lưu trong phiên";
  document.getElementById("saveStatus").textContent = saveLabel;
  const syncStatus = document.getElementById("syncStatus");
  if (syncStatus) syncStatus.textContent = saveLabel;
  setTimeout(() => document.getElementById("saveStatus").classList.remove("show"), 1800);
}

window.courseAppHooks = {
  async saveProgress(progress) {
    return Promise.resolve(progress);
  },
  async loadProgress() {
    return getProgress();
  }
};

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function getLessonById(id) {
  return manifest ? manifest.lessons.find(lesson => lesson.id === id) : null;
}

function getWeekStats(weekNumber) {
  const lessons = manifest.lessons.filter(lesson => lesson.weekNumber === weekNumber);
  const progress = getProgress();
  let done = 0;
  lessons.forEach(lesson => {
    if (progress.completedLessons.includes(lesson.id) || progress.lessonsDone[lesson.id]) done++;
  });
  return { total: lessons.length, done, pct: lessons.length ? Math.round(done / lessons.length * 100) : 0 };
}

function getCourseStats() {
  const progress = getProgress();
  let doneLessons = 0;
  manifest.lessons.forEach(lesson => {
    if (progress.completedLessons.includes(lesson.id) || progress.lessonsDone[lesson.id]) doneLessons++;
  });
  const checklistValues = progress.checklist;
  let totalChecks = 0;
  let doneChecks = 0;
  Object.keys(checklistValues).forEach(id => {
    if (checklistValues[id]) doneChecks++;
  });
  doneChecks = doneChecks;
  return { totalLessons: manifest.lessons.length, doneLessons, doneChecks };
}

function renderSidebar() {
  const progress = getProgress();
  const hash = location.hash;
  const activeLessonMatch = /^#course\/canva-gemini\/lesson\/([^/?]+)/.exec(hash);
  const activeWeekMatch = /^#course\/canva-gemini\/week\/([^/?]+)/.exec(hash);
  let html = `
    <div class="nav-group-label">Tổng quan</div>
    <button type="button" class="nav-btn ${(!hash || hash.includes("/dashboard")) ? "active" : ""}" data-route="dashboard"><span>🏠 Lộ trình 8 tuần</span></button>
    <button type="button" class="nav-btn ${hash.includes("/portfolio") ? "active" : ""}" data-route="portfolio"><span>📁 Hồ sơ học tập</span><span class="pill pill-ready">${progress.portfolio.length}</span></button>
    <div class="nav-group-label">Các tuần học</div>
  `;
  for (let weekNumber = 1; weekNumber <= 8; weekNumber++) {
    const stats = getWeekStats(weekNumber);
    const activeWeek = activeWeekMatch?.[1] === `w${weekNumber}`;
    html += `<button type="button" class="nav-btn ${activeWeek ? "active" : ""}" data-route="week" data-week="${weekNumber}"><span>Tuần ${weekNumber}</span><span class="pill ${stats.done === stats.total ? "pill-done" : "pill-ready"}">${stats.pct}%</span></button><div class="nav-sub">`;
    manifest.lessons.filter(lesson => lesson.weekNumber === weekNumber).forEach(lesson => {
      const done = progress.completedLessons.includes(lesson.id) || !!progress.lessonsDone[lesson.id];
      const activeLesson = activeLessonMatch?.[1] === lesson.id;
      html += `<button type="button" class="nav-btn ${activeLesson ? "active" : ""}" data-route="lesson" data-id="${esc(lesson.id)}"><span>${done ? "✓ " : ""}Ngày ${lesson.id.split("-d")[1] || ""}</span></button>`;
    });
    html += `</div>`;
  }
  sidebar.innerHTML = html;
  sidebar.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleSidebarRoute));
}

function handleSidebarRoute(event) {
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
  const stats = getCourseStats();
  const progress = getProgress();
  const next = manifest.lessons.find(lesson => !progress.completedLessons.includes(lesson.id) && !progress.lessonsDone[lesson.id]) || manifest.lessons[0];
  let timeline = "";
  for (let weekNumber = 1; weekNumber <= 8; weekNumber++) {
    const weekStats = getWeekStats(weekNumber);
    const weekLessons = manifest.lessons.filter(lesson => lesson.weekNumber === weekNumber);
    timeline += `<button type="button" class="week-card" data-route="week" data-week="${weekNumber}">
      <div class="week-card-top"><strong>Tuần ${weekNumber}</strong><span class="pill ${weekStats.done === weekStats.total ? "pill-done" : "pill-ready"}">${weekStats.done === weekStats.total ? "Đã hoàn thành" : "Đang học"}</span></div>
      <strong style="margin-bottom:6px;">${esc(weekLessons[0]?.title || "")}</strong>
      <div style="margin-top:auto"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)"><span>${weekStats.done}/${weekStats.total} bài</span><span>${weekStats.pct}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${weekStats.pct}%"></div></div></div>
    </button>`;
  }
  app.innerHTML = `
    <div class="card hero-card">
      <h1>${esc(manifest.course.title)}</h1>
      <p>Lộ trình thực chiến 8 tuần với 56 bài học, checklist theo ngày và hồ sơ sản phẩm.</p>
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px;max-width:720px"><span>Tiến độ bài học</span><span>${stats.doneLessons}/${stats.totalLessons}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${stats.totalLessons ? stats.doneLessons / stats.totalLessons * 100 : 0}%"></div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-num">${stats.doneLessons}/${stats.totalLessons}</div><div class="stat-label">Bài học đã hoàn thành</div></div>
      <div class="stat-box"><div class="stat-num">${stats.doneChecks}</div><div class="stat-label">Mục checklist đã tick</div></div>
      <div class="stat-box"><div class="stat-num">8</div><div class="stat-label">Tuần học</div></div>
      <div class="stat-box"><div class="stat-num">${progress.portfolio.length}</div><div class="stat-label">Sản phẩm Hồ sơ học tập</div></div>
    </div>
    ${next ? `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><strong>Bài tiếp theo cần học</strong><p style="margin:6px 0 0">${esc(next.title)}</p></div><button type="button" class="btn btn-primary" data-route="lesson" data-id="${esc(next.id)}">Học ngay →</button></div>` : ""}
    <section class="card"><h2>Lộ trình 8 tuần học</h2><div class="timeline-grid">${timeline}</div></section>
  `;
  app.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleSidebarRoute));
}

function renderWeek(weekId) {
  const match = /^w(\d+)$/.exec(weekId);
  if (!match) return renderDashboard();
  const weekNumber = Number(match[1]);
  const lessons = manifest.lessons.filter(lesson => lesson.weekNumber === weekNumber);
  if (!lessons.length) {
    app.innerHTML = `<div class="card"><button type="button" class="btn" data-route="dashboard">← Về Lộ trình 8 tuần</button><h1>Tuần ${weekNumber}</h1><p>Chưa có bài học chi tiết cho tuần này.</p></div>`;
  } else {
    app.innerHTML = `<div class="card"><button type="button" class="btn" data-route="dashboard">← Về Lộ trình 8 tuần</button><h1>Tuần ${weekNumber}</h1><p>Danh sách bài học Tuần ${weekNumber}</p><div>${lessons.map(lesson => `<div class="portfolio-item" style="align-items:center"><div style="flex:1"><strong>${esc(lesson.title)}</strong></div><button type="button" class="btn btn-primary" data-route="lesson" data-id="${esc(lesson.id)}">Mở bài học →</button></div>`).join("")}</div></div>`;
  }
  app.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleSidebarRoute));
}

async function renderLesson(lessonId) {
  const lesson = getLessonById(lessonId);
  if (!lesson) {
    app.innerHTML = `<div class="card"><h1>Không tìm thấy bài học</h1><p>Bài học không tồn tại trong manifest.</p><button type="button" class="btn" data-route="dashboard">Về trang chủ</button></div>`;
    app.querySelector("[data-route]").addEventListener("click", handleSidebarRoute);
    return;
  }
  const lessonIndex = manifest.lessons.findIndex(item => item.id === lessonId);
  const previousLesson = lessonIndex > 0 ? manifest.lessons[lessonIndex - 1] : null;
  const nextLesson = lessonIndex >= 0 && lessonIndex < manifest.lessons.length - 1 ? manifest.lessons[lessonIndex + 1] : null;
  const courseBaseUrl = new URL("./courses/canva-gemini/", document.baseURI);
  const lessonUrl = new URL(lesson.src, courseBaseUrl).href;
  let lessonExists = false;
  try {
    const lessonResponse = await fetch(lessonUrl, { cache: "no-store" });
    lessonExists = lessonResponse.ok;
  } catch (error) {
    lessonExists = false;
  }
  if (!lessonExists) {
    app.innerHTML = `<div class="card"><h1>Không tìm thấy bài học</h1><p>Không thể tải: ${esc(lesson.title)}</p><button type="button" class="btn" data-route="week" data-week="w${lesson.weekNumber}">← Quay lại Tuần ${lesson.weekNumber}</button></div>`;
    app.querySelector("[data-route]").addEventListener("click", handleSidebarRoute);
    return;
  }
  lessonFrame = document.createElement("iframe");
  lessonFrame.className = "lesson-frame";
  lessonFrame.title = lesson.title;
  lessonFrame.src = lessonUrl;
  lessonFrame.dataset.lessonId = lesson.id;
  lessonFrame.sandbox = "allow-scripts allow-same-origin";
  lessonFrame.referrerPolicy = "strict-origin";
  app.innerHTML = `<div class="lesson-shell">
    <div class="lesson-toolbar">
      ${previousLesson ? `<button type="button" class="btn btn-sm" data-route="lesson" data-id="${esc(previousLesson.id)}">← Bài trước</button>` : `<button type="button" class="btn btn-sm" data-route="week" data-week="w${lesson.weekNumber}">← Tuần ${lesson.weekNumber}</button>`}
      <div class="lesson-toolbar-title"><strong>${esc(lesson.title)}</strong><span>${previousLesson ? "Bài trước: " + esc(previousLesson.title) : "Bài đầu tiên của khóa học"}</span></div>
      ${nextLesson ? `<button type="button" class="btn btn-sm btn-primary" data-route="lesson" data-id="${esc(nextLesson.id)}">Bài tiếp theo →</button>` : `<button type="button" class="btn btn-sm" data-route="week" data-week="w${lesson.weekNumber}">Hoàn thành khóa học</button>`}
    </div>
  </div>`;
  app.querySelector(".lesson-shell").appendChild(lessonFrame);
  app.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleSidebarRoute));
  lessonFrame.addEventListener("load", () => {
    if (!lessonFrame.contentWindow) return;
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
}

function renderPortfolio() {
  const progress = getProgress();
  let items = progress.portfolio;
  if (pfWeekFilter !== "all") items = items.filter(item => item.lessonId && item.lessonId.startsWith(pfWeekFilter));
  if (pfLessonFilter !== "all") items = items.filter(item => item.lessonId === pfLessonFilter);
  app.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h1>Hồ sơ học tập</h1><button type="button" class="btn btn-primary" id="addPortfolio">Thêm sản phẩm</button></div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <select id="pfWeekFilter"><option value="all">Tất cả tuần</option>${Array.from({length:8},(_,i)=>`<option value="w${i+1}" ${pfWeekFilter===`w${i+1}`?"selected":""}>Tuần ${i+1}</option>`).join("")}</select>
        <select id="pfLessonFilter"><option value="all">Tất cả bài học</option>${manifest.lessons.map(l=>`<option value="${esc(l.id)}" ${pfLessonFilter===l.id?"selected":""}>${esc(l.title)}</option>`).join("")}</select>
      </div>
      ${items.length ? items.map(item=>`<div class="portfolio-item"><div style="flex:1"><strong>${esc(item.title)}</strong><div style="font-size:13px;color:var(--muted);margin-top:3px">${esc(item.lessonId)} · ${esc(item.date)}</div>${item.link?`<div><a href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">Mở liên kết ↗</a></div>`:""}${item.note?`<p>${esc(item.note)}</p>`:""}</div><div style="display:flex;gap:6px"><button type="button" class="btn btn-sm" data-edit-pf="${esc(item.id)}">Sửa</button><button type="button" class="btn btn-sm btn-danger" data-del-pf="${esc(item.id)}">Xóa</button></div></div>`).join("") : `<p>Chưa có sản phẩm nào trong Hồ sơ học tập.</p>`}
    </div>
  `;
  document.getElementById("addPortfolio").addEventListener("click", () => openPortfolioModal());
  document.getElementById("pfWeekFilter").addEventListener("change", event => { pfWeekFilter=event.target.value; renderPortfolio(); });
  document.getElementById("pfLessonFilter").addEventListener("change", event => { pfLessonFilter=event.target.value; renderPortfolio(); });
  app.querySelectorAll("[data-edit-pf]").forEach(button => button.addEventListener("click", () => openPortfolioModal(button.dataset.editPf)));
  app.querySelectorAll("[data-del-pf]").forEach(button => button.addEventListener("click", () => deletePortfolio(button.dataset.delPf)));
}

function openPortfolioModal(editId) {
  const modal = document.getElementById("portfolioModal");
  const title = document.getElementById("portfolioModalTitle");
  const lessonSelect = document.getElementById("pfLesson");
  lessonSelect.innerHTML = manifest.lessons.map(lesson => `<option value="${esc(lesson.id)}">Tuần ${lesson.weekNumber} · ${esc(lesson.title)}</option>`).join("");
  document.getElementById("pfEditId").value = editId || "";
  title.textContent = editId ? "Sửa sản phẩm trong Hồ sơ học tập" : "Thêm sản phẩm vào Hồ sơ học tập";
  if (editId) {
    const item = getProgress().portfolio.find(portfolio => portfolio.id === editId);
    if (item) {
      lessonSelect.value = item.lessonId;
      document.getElementById("pfTitle").value = item.title || "";
      document.getElementById("pfLink").value = item.link || "";
      document.getElementById("pfDate").value = item.date || "";
      document.getElementById("pfNote").value = item.note || "";
    }
  } else {
    document.getElementById("portfolioForm").reset();
  }
  modal.classList.add("open");
}

function closePortfolioModal() {
  document.getElementById("portfolioModal").classList.remove("open");
}

function deletePortfolio(id) {
  const progress = getProgress();
  progress.portfolio = progress.portfolio.filter(item => item.id !== id);
  scheduleSave();
  renderSidebar();
  renderPortfolio();
  showToast("Đã xóa sản phẩm.");
}

function route() {
  if (!manifest) return;
  document.getElementById("searchResults")?.remove();
  const hash = location.hash || `#course/canva-gemini/dashboard`;
  const lessonMatch = /^#course\/canva-gemini\/lesson\/([^/?]+)/.exec(hash);
  const weekMatch = /^#course\/canva-gemini\/week\/([^/?]+)/.exec(hash);
  if (hash.includes("/portfolio")) renderPortfolio();
  else if (lessonMatch) renderLesson(decodeURIComponent(lessonMatch[1]));
  else if (weekMatch) renderWeek(decodeURIComponent(weekMatch[1]));
  else renderDashboard();
  renderSidebar();
}

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function closeMobileMenu() {
  sidebar.classList.remove("open");
  document.getElementById("drawerBackdrop").classList.remove("open");
}

function getKnownLessonIds() {
  return new Set(manifest.lessons.map(lesson => lesson.id));
}

function validateImportedData(parsed) {
  if (!isObject(parsed)) return false;
  const progress = parsed.schemaVersion === 1 && isObject(parsed.progress) ? parsed.progress : parsed;
  if (progress.checklist && !isObject(progress.checklist)) return false;
  if (progress.notes && !isObject(progress.notes)) return false;
  if (progress.portfolio && !Array.isArray(progress.portfolio)) return false;
  const known = getKnownLessonIds();
  const knownChecks = new Set(manifest.lessons.flatMap(lesson => lesson.checklistIds || []));
  for (const id of Object.keys(progress.checklist || {})) if (!knownChecks.has(id)) return false;
  for (const id of Object.keys(progress.notes || {})) if (!known.has(id)) return false;
  for (const id of Object.keys(progress.lessonsDone || {})) if (!known.has(id)) return false;
  for (const id of progress.completedLessons || []) if (!known.has(id)) return false;
  for (const item of progress.portfolio || []) {
    if (!isObject(item)) return false;
    if (item.link && !/^https?:\/\//i.test(item.link)) return false;
    if (item.lessonId && !known.has(item.lessonId)) return false;
  }
  return true;
}

function mergeImportedData(parsed) {
  const progress = parsed.schemaVersion === 1 && isObject(parsed.progress) ? parsed.progress : parsed;
  const normalized = { ...getProgress(), ...progress };
  normalized.checklist = isObject(progress.checklist) ? progress.checklist : getProgress().checklist;
  normalized.notes = isObject(progress.notes) ? progress.notes : getProgress().notes;
  normalized.portfolio = Array.isArray(progress.portfolio) ? progress.portfolio : getProgress().portfolio;
  normalized.lessonsDone = isObject(progress.lessonsDone) ? progress.lessonsDone : getProgress().lessonsDone;
  normalized.completedLessons = Array.isArray(progress.completedLessons)
    ? progress.completedLessons
    : Object.keys(normalized.lessonsDone);
  normalized.theme = ["system","light","dark"].includes(progress.theme) ? progress.theme : getProgress().theme;
  state = { ...state, ...parsed, schemaVersion: 1, progress: normalized };
}

window.addEventListener("message", event => {
  if (!lessonFrame || event.source !== lessonFrame.contentWindow) return;
  if (event.origin !== window.location.origin) return;
  if (!isObject(event.data)) return;
  if (typeof event.data.lessonId !== "string" || !event.data.lessonId) return;
  if (!getLessonById(event.data.lessonId)) return;
  if (event.data.lessonId !== lessonFrame.dataset.lessonId) return;

  if (event.data.type === "LESSON_RESIZE") {
    if (!Number.isFinite(event.data.height) || event.data.height < 320 || event.data.height > 200000) return;
    lessonFrame.style.height = `${Math.ceil(event.data.height)}px`;
    return;
  }
  if (event.data.type !== "LESSON_PROGRESS") return;
  if (!isObject(event.data.data)) return;

  const progress = getProgress();
  const data = event.data.data;
  if (isObject(data.checklist)) {
    const knownChecks = new Set(manifest.lessons.flatMap(lesson => lesson.checklistIds || []));
    const safeChecklist = {};
    Object.entries(data.checklist).forEach(([id, checked]) => {
      if (knownChecks.has(id) && typeof checked === "boolean") safeChecklist[id] = checked;
    });
    progress.checklist = { ...progress.checklist, ...safeChecklist };
  }
  if (typeof data.notes === "string") progress.notes[event.data.lessonId] = data.notes;
  if (data.completed === true) {
    progress.lessonsDone[event.data.lessonId] = data.date || todayISO();
    if (!progress.completedLessons.includes(event.data.lessonId)) progress.completedLessons.push(event.data.lessonId);
  } else if (data.completed === false) {
    delete progress.lessonsDone[event.data.lessonId];
    progress.completedLessons = progress.completedLessons.filter(id => id !== event.data.lessonId);
  }
  scheduleSave();
  renderSidebar();
});

async function init() {
  applyTheme();
  try {
    manifestUrl = new URL("./courses/canva-gemini/manifest.json", document.baseURI);
    const response = await fetch(manifestUrl.href, { cache: "no-store" });
    if (!response.ok) throw new Error(`Không thể tải manifest (HTTP ${response.status})`);
    manifest = await response.json();
    if (!manifest.course || !Array.isArray(manifest.lessons)) throw new Error("Manifest không hợp lệ");
  } catch (error) {
    app.innerHTML = `<div class="card"><h1>Không thể tải khóa học</h1><p>${esc(error.message)}</p></div>`;
    return;
  }
  updateStorageBanner();
  route();

  window.addEventListener("hashchange", route);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  document.getElementById("brandButton").addEventListener("click", () => { location.hash = "#course/canva-gemini/dashboard"; });
  document.getElementById("menuToggle").addEventListener("click", () => {
    sidebar.classList.toggle("open");
    document.getElementById("drawerBackdrop").classList.toggle("open");
  });
  document.getElementById("drawerBackdrop").addEventListener("click", closeMobileMenu);
  document.getElementById("themeButton").addEventListener("click", () => {
    const progress = getProgress();
    const current = progress.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : progress.theme;
    progress.theme = current === "dark" ? "light" : "dark";
    applyTheme();
    scheduleSave();
  });

  document.getElementById("exportButton").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "canva-gemini-course-backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("Đã xuất dữ liệu JSON.");
  });
  document.getElementById("importButton").addEventListener("click", () => document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!validateImportedData(parsed)) throw new Error("Tệp JSON không hợp lệ hoặc chứa dữ liệu bài học không xác định.");
      mergeImportedData(parsed);
      applyTheme();
      scheduleSave();
      route();
      showToast("Đã nhập dữ liệu tiến độ.");
    } catch (error) {
      showToast(error.message || "Tệp JSON không hợp lệ.");
    } finally {
      event.target.value = "";
    }
  });

  document.getElementById("portfolioForm").addEventListener("submit", event => {
    event.preventDefault();
    const editId = document.getElementById("pfEditId").value;
    const lessonId = document.getElementById("pfLesson").value;
    const title = document.getElementById("pfTitle").value.trim();
    const link = document.getElementById("pfLink").value.trim();
    if (link && !/^https?:\/\//i.test(link)) {
      showToast("Liên kết phải bắt đầu bằng http hoặc https.");
      return;
    }
    if (!title) return;
    const progress = getProgress();
    const item = {
      id: editId || `pf-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      lessonId,
      title,
      link,
      date: document.getElementById("pfDate").value,
      note: document.getElementById("pfNote").value
    };
    if (editId) progress.portfolio = progress.portfolio.map(existing => existing.id === editId ? item : existing);
    else progress.portfolio.push(item);
    closePortfolioModal();
    scheduleSave();
    renderSidebar();
    renderPortfolio();
  });
  document.getElementById("cancelPortfolio").addEventListener("click", closePortfolioModal);
  document.getElementById("resetButton").addEventListener("click", () => document.getElementById("resetModal").classList.add("open"));
  document.getElementById("cancelReset").addEventListener("click", () => document.getElementById("resetModal").classList.remove("open"));
  document.getElementById("confirmReset").addEventListener("click", () => {
    state = { ...state, schemaVersion: 1, progress: defaultProgress() };
    applyTheme();
    scheduleSave();
    document.getElementById("resetModal").classList.remove("open");
    route();
  });

  document.getElementById("globalSearch").addEventListener("input", event => {
    searchQuery = event.target.value.trim().toLowerCase();
    if (!searchQuery) {
      app.querySelector(".search-results")?.remove();
      return;
    }
    const results = manifest.lessons.filter(lesson =>
      lesson.title.toLowerCase().includes(searchQuery) ||
      (lesson.searchTerms || []).some(term => term.toLowerCase().includes(searchQuery))
    ).slice(0, 20);
    let panel = document.getElementById("searchResults");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "searchResults";
      panel.className = "card search-results";
      app.prepend(panel);
    }
    panel.innerHTML = results.length ? results.map(lesson => `<button type="button" class="search-result" data-route="lesson" data-id="${esc(lesson.id)}"><strong>${esc(lesson.title)}</strong><div style="font-size:12px;color:var(--muted)">Tuần ${lesson.weekNumber}</div></button>`).join("") : "<p>Không tìm thấy bài học hoặc thuật ngữ.</p>";
    panel.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", handleSidebarRoute));
  });
}

init();
