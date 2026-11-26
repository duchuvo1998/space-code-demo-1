import { createFirebaseSync } from "../firebase/firebase-sync.js";
import { fetchCourseManifest } from "../course/course-api.mjs";
import { createCourseViews } from "../course/course-views.mjs";
import { createDialogController } from "./dialog-controller.mjs";
import { initializeLocale, setLocale, translate as t } from "../localization/localization.mjs";
import {
  applyProgressChanges,
  diffProgress,
  hasProgressData
} from "../progress/progress-merge.mjs";
import {
  clearPendingCloudReset,
  createDefaultProgress,
  loadPendingCloudReset,
  loadProgressState,
  loadWelcomeChoice,
  savePendingCloudReset,
  saveProgressState,
  saveWelcomeChoice
} from "../progress/progress-storage.mjs";
import { UI_ICONS } from "../ui/ui-icons.mjs";

const WRITE_DELAY = 700;

await initializeLocale();

let manifest = null;
let courseViews = null;
const storedProgress = loadProgressState();
let state = storedProgress.state;
let saveTimer = null;
let storageAvailable = storedProgress.available;
let searchQuery = "";
let firebaseSync = null;
let firebaseInitError = null;
let syncError = "";
const pendingCloudReset = loadPendingCloudReset();
let resetCloudUid = pendingCloudReset.uid;
if (!pendingCloudReset.available) storageAvailable = false;
let activeSavePromise = null;
let saveAgain = false;

const app = document.getElementById("app");
const sidebar = document.getElementById("sidebar");
const dialogs = createDialogController({
  onWelcomeDismissed: persistWelcomeChoice
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getProgress() {
  return state.progress;
}

function getLessonById(id) {
  return courseViews?.getLessonById(id) || null;
}

function renderSidebar() {
  courseViews?.renderSidebar();
}

function renderPortfolio() {
  courseViews?.renderPortfolio();
}

function route() {
  courseViews?.route();
}

function applyTheme() {
  const theme = getProgress().theme || "light";
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolved;
  const lessonFrame = courseViews?.getLessonFrame();
  if (lessonFrame?.contentDocument?.documentElement) {
    lessonFrame.contentDocument.documentElement.dataset.theme = resolved;
  }
}

function updateStorageBanner() {
  document.getElementById("storageWarn").classList.toggle("show", !storageAvailable);
}

function persistWelcomeChoice() {
  const result = saveWelcomeChoice();
  if (!result.saved) {
    storageAvailable = false;
    updateStorageBanner();
  }
}

function markCloudReset(uid) {
  resetCloudUid = uid;
  const result = savePendingCloudReset(uid);
  if (!result.saved) {
    syncError = result.error instanceof Error ? result.error.message : t("resetRequestSaveFailed");
    showToast(t("resetRequestSaveToast", { error: syncError }));
  }
}

function clearCloudReset() {
  const result = clearPendingCloudReset();
  if (result.saved) {
    resetCloudUid = "";
    return true;
  }
  syncError = result.error instanceof Error ? result.error.message : t("resetRequestClearFailed");
  showToast(t("resetRequestClearToast", { error: syncError }));
  return false;
}

function updateAccountUi() {
  const accountButton = document.getElementById("accountButton");
  const syncStatus = document.getElementById("syncStatus");
  if (!accountButton || !syncStatus) return;
  const welcomeLoginButton = document.getElementById("welcomeLoginButton");

  if (firebaseInitError) {
    accountButton.hidden = true;
    if (welcomeLoginButton) welcomeLoginButton.hidden = true;
    syncStatus.textContent = t("firebaseNotConnected");
    syncStatus.title = t("browserProgressSaved");
    return;
  }
  if (!firebaseSync) {
    accountButton.hidden = true;
    if (welcomeLoginButton) welcomeLoginButton.hidden = true;
    syncStatus.textContent = t("saveInBrowser");
    syncStatus.title = t("configureFirebase");
    return;
  }

  accountButton.hidden = false;
  if (welcomeLoginButton) welcomeLoginButton.hidden = !!firebaseSync.currentUser;
  accountButton.innerHTML = UI_ICONS.account;
  accountButton.title = firebaseSync.currentUser ? t("signOutGoogle") : t("signInGoogle");
  accountButton.setAttribute(
    "aria-label",
    firebaseSync.currentUser
      ? t("signingOutGoogle", { account: firebaseSync.currentUser.email || "Google" })
      : t("signingInGoogle")
  );
  syncStatus.textContent = syncError
    ? t("syncError")
    : firebaseSync.currentUser
      ? t("synced")
      : t("saveInBrowser");
  syncStatus.title = syncError || (firebaseSync.currentUser
    ? t("syncingWithAccount", { account: firebaseSync.currentUser.email || "Google" })
    : t("browserProgressSyncHint"));
}

function saveLocalState() {
  const result = saveProgressState(state);
  storageAvailable = result.saved;
  updateStorageBanner();
  return result.saved;
}

function formatSaveStatus(localSaved) {
  if (localSaved) return t("saved");
  return firebaseSync?.currentUser ? t("synced") : t("unableToSaveProgress");
}

function cloneProgress(progress) {
  return JSON.parse(JSON.stringify(progress));
}

function applySyncedProgress(baseProgress, localProgress, syncedProgress) {
  const localChanges = diffProgress(baseProgress, localProgress);
  return applyProgressChanges(syncedProgress, localChanges);
}

function refreshProgressView() {
  renderSidebar();
  if (!location.hash || /\/(dashboard|portfolio|week\/)/.test(location.hash)) route();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  document.getElementById("saveStatus").textContent = t("saving");
  const syncStatus = document.getElementById("syncStatus");
  if (syncStatus) syncStatus.textContent = t("saving");
  document.getElementById("saveStatus").classList.add("show");
  saveTimer = setTimeout(() => {
    void saveProgress();
  }, WRITE_DELAY);
}

function saveProgress() {
  if (activeSavePromise) {
    saveAgain = true;
    return activeSavePromise;
  }
  activeSavePromise = (async () => {
    do {
      saveAgain = false;
      await saveProgressOnce();
    } while (saveAgain);
  })().finally(() => {
    activeSavePromise = null;
  });
  return activeSavePromise;
}

async function saveProgressOnce() {
  const localSaved = saveLocalState();
  if (!firebaseSync?.currentUser) {
    updateAccountUi();
    document.getElementById("saveStatus").textContent = formatSaveStatus(localSaved);
    setTimeout(() => document.getElementById("saveStatus").classList.remove("show"), 1800);
    return;
  }

  const progressSnapshot = cloneProgress(getProgress());
  const replaceCloudProgress = !!firebaseSync?.currentUser
    && firebaseSync.currentUser.uid === resetCloudUid;
  try {
    const syncedProgress = await window.courseAppHooks.saveProgress(
      progressSnapshot,
      { replace: replaceCloudProgress }
    );
    if (syncedProgress) {
      state = {
        ...state,
        progress: applySyncedProgress(progressSnapshot, getProgress(), syncedProgress)
      };
      saveLocalState();
      refreshProgressView();
      const resetCleared = !replaceCloudProgress || clearCloudReset();
      syncError = resetCleared ? "" : syncError;
    }
    else syncError = "";
    updateAccountUi();
    document.getElementById("saveStatus").textContent = formatSaveStatus(localSaved);
  } catch (error) {
    syncError = error instanceof Error ? error.message : t("unknownError");
    updateAccountUi();
    document.getElementById("saveStatus").textContent = localSaved
      ? t("savedBrowserSyncError")
      : t("unableToSaveProgress");
    showToast(t("firebaseSyncFailed", { error: syncError }));
  }
  setTimeout(() => document.getElementById("saveStatus").classList.remove("show"), 1800);
}

window.courseAppHooks = {
  async saveProgress(progress, options = {}) {
    if (!firebaseSync?.currentUser) return null;
    return firebaseSync.saveProgress(progress, options.replace);
  },
  async loadProgress() {
    if (!firebaseSync?.currentUser) return getProgress();
    return (await firebaseSync.loadProgress(getProgress())) || getProgress();
  }
};

async function initializeFirebaseSync() {
  try {
    firebaseSync = await createFirebaseSync();
  } catch (error) {
    firebaseInitError = error;
    syncError = error instanceof Error ? error.message : t("unknownError");
    showToast(t("firebaseInitFailed", { error: syncError }));
    updateAccountUi();
    maybeShowWelcome();
    return;
  }

  if (firebaseSync?.currentUser) {
    try {
      const initialProgress = cloneProgress(getProgress());
      const replaceCloudProgress = firebaseSync.currentUser.uid === resetCloudUid;
      const loadedProgress = await firebaseSync.loadProgress(initialProgress, replaceCloudProgress);
      if (loadedProgress) {
        state = {
          ...state,
          progress: applySyncedProgress(initialProgress, getProgress(), loadedProgress)
        };
        saveLocalState();
        await saveProgress();
        applyTheme();
        route();
      }
      else syncError = "";
    } catch (error) {
      syncError = error instanceof Error ? error.message : t("unknownError");
      showToast(t("firebaseLoadFailed", { error: syncError }));
    }
  }
  updateAccountUi();
  maybeShowWelcome();
}

function maybeShowWelcome() {
  if (firebaseSync?.currentUser) return;
  const choice = loadWelcomeChoice();
  if (!choice.available) {
    storageAvailable = false;
    updateStorageBanner();
    return;
  }
  if (!choice.dismissed) dialogs.showWelcome();
}

async function handleAccountAction(button) {
  if (!firebaseSync) return;
  button.disabled = true;
  try {
    if (firebaseSync.currentUser) {
      await firebaseSync.signOut();
      syncError = "";
      updateAccountUi();
      showToast(t("signedOutNotice"));
      return;
    }

    const initialProgress = cloneProgress(getProgress());
    const user = await firebaseSync.signIn();
    const replacingResetProgress = user.uid === resetCloudUid;
    const cloudProgress = replacingResetProgress ? null : await firebaseSync.getCloudProgress();
    const replacingExistingProgress = !!cloudProgress && hasProgressData(initialProgress);
    if (replacingExistingProgress) button.disabled = false;
    if (replacingExistingProgress && !(await dialogs.requestCloudOverwriteConsent())) {
      await firebaseSync.signOut();
      syncError = "";
      updateAccountUi();
      showToast(t("syncCancelledNotice"));
      if (document.getElementById("welcomeModal").dataset.restoreAfterSignIn === "true") {
        dialogs.showWelcome(true);
      }
      return;
    }

    const syncedProgress = await firebaseSync.loadProgress(
      initialProgress,
      replacingResetProgress || replacingExistingProgress,
      !cloudProgress || hasProgressData(initialProgress)
    );
    if (syncedProgress) {
      state = {
        ...state,
        progress: applySyncedProgress(initialProgress, getProgress(), syncedProgress)
      };
      saveLocalState();
      applyTheme();
      route();
    }
    if (replacingResetProgress) clearCloudReset();
    syncError = "";
    updateAccountUi();
    showToast(t("signedInNotice"));
  } catch (error) {
    syncError = error instanceof Error ? error.message : t("unknownError");
    updateAccountUi();
    showToast(t("syncProgressFailed", { error: syncError }));
  } finally {
    button.disabled = false;
  }
}

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

function openPortfolioModal(editId) {
  const modal = document.getElementById("portfolioModal");
  const title = document.getElementById("portfolioModalTitle");
  const lessonSelect = document.getElementById("pfLesson");
  refreshPortfolioModalLocale();
  document.getElementById("pfEditId").value = editId || "";
  title.textContent = t(editId ? "editPortfolioTitle" : "addPortfolioTitle");
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

function refreshPortfolioModalLocale() {
  const lessonSelect = document.getElementById("pfLesson");
  const selectedLesson = lessonSelect.value;
  lessonSelect.innerHTML = manifest.lessons
    .map(lesson => `<option value="${esc(lesson.id)}">${esc(t("week", { number: lesson.weekNumber }))} · ${esc(lesson.title)}</option>`)
    .join("");
  lessonSelect.value = selectedLesson;
  const isEditing = Boolean(document.getElementById("pfEditId").value);
  document.getElementById("portfolioModalTitle").textContent = t(isEditing ? "editPortfolioTitle" : "addPortfolioTitle");
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
  showToast(t("productDeleted"));
}

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function closeMobileMenu() {
  sidebar.classList.remove("open");
  document.getElementById("drawerBackdrop").classList.remove("open");
  const menuToggle = document.getElementById("menuToggle");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", t("openNavigation"));
}

function closeToolsMenu() {
  if (!window.matchMedia("(min-width: 1440px)").matches) {
    document.getElementById("topbarTools").open = false;
  }
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
  normalized.theme = ["light","dark"].includes(progress.theme) ? progress.theme : getProgress().theme;
  state = { ...state, ...parsed, schemaVersion: 1, progress: normalized };
}

window.addEventListener("message", event => {
  const lessonFrame = courseViews?.getLessonFrame();
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
  updateAccountUi();
  try {
    const manifestUrl = new URL("./courses/canva-gemini/manifest.json", document.baseURI);
    manifest = await fetchCourseManifest(manifestUrl);
  } catch (error) {
    app.innerHTML = `<div class="card"><h1>${t("unableToLoadCourse")}</h1><p>${esc(error.message)}</p></div>`;
    return;
  }
  courseViews = createCourseViews({
    app,
    sidebar,
    getManifest: () => manifest,
    getProgress,
    escapeHtml: esc,
    t,
    closeMobileMenu,
    openPortfolioModal,
    deletePortfolio
  });
  updateStorageBanner();
  route();

  window.addEventListener("hashchange", route);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  document.getElementById("brandButton").addEventListener("click", () => { location.hash = "#course/canva-gemini/dashboard"; });
  document.getElementById("menuToggle").addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    document.getElementById("drawerBackdrop").classList.toggle("open", isOpen);
    const menuToggle = document.getElementById("menuToggle");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", t(isOpen ? "closeNavigation" : "openNavigation"));
  });
  const topbarTools = document.getElementById("topbarTools");
  const wideToolbar = window.matchMedia("(min-width: 1440px)");
  const syncToolsLayout = () => {
    topbarTools.open = wideToolbar.matches;
  };
  syncToolsLayout();
  wideToolbar.addEventListener("change", syncToolsLayout);
  document.addEventListener("click", event => {
    if (!(event.target instanceof Node) || !topbarTools.contains(event.target)) {
      closeToolsMenu();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !topbarTools.open || wideToolbar.matches) return;
    closeToolsMenu();
    topbarTools.querySelector("summary").focus();
  });
  document.querySelectorAll("[data-locale]").forEach(button => button.addEventListener("click", async event => {
    await setLocale(event.currentTarget.dataset.locale);
    closeToolsMenu();
    refreshPortfolioModalLocale();
    const menuToggle = document.getElementById("menuToggle");
    menuToggle.setAttribute("aria-label", t(sidebar.classList.contains("open") ? "closeNavigation" : "openNavigation"));
    updateAccountUi();
    updateStorageBanner();
    route();
  }));
  document.getElementById("drawerBackdrop").addEventListener("click", closeMobileMenu);
  document.getElementById("themeButton").addEventListener("click", () => {
    const progress = getProgress();
    const current = progress.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : progress.theme;
    progress.theme = current === "dark" ? "light" : "dark";
    applyTheme();
    scheduleSave();
    closeToolsMenu();
  });
  document.getElementById("accountButton").addEventListener("click", event => {
    void handleAccountAction(event.currentTarget);
  });
  document.getElementById("welcomeLoginButton").addEventListener("click", async event => {
    const button = event.currentTarget;
    document.getElementById("welcomeModal").dataset.restoreAfterSignIn = "true";
    await handleAccountAction(button);
    if (firebaseSync?.currentUser || !document.getElementById("welcomeModal").classList.contains("open")) {
      dialogs.dismissWelcome();
    }
    delete document.getElementById("welcomeModal").dataset.restoreAfterSignIn;
  });
  document.getElementById("welcomeContinueButton").addEventListener("click", dialogs.dismissWelcome);
  document.getElementById("welcomeCloseButton").addEventListener("click", dialogs.closeWelcomeWithoutChoice);

  document.getElementById("exportButton").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "canva-gemini-course-backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(t("exportedJson"));
    closeToolsMenu();
  });
  document.getElementById("importButton").addEventListener("click", () => {
    closeToolsMenu();
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!validateImportedData(parsed)) throw new Error(t("invalidImport"));
      mergeImportedData(parsed);
      applyTheme();
      scheduleSave();
      route();
      showToast(t("importedProgress"));
    } catch (error) {
      showToast(error.message || t("invalidJsonFile"));
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
      showToast(t("invalidLink"));
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
  document.getElementById("resetButton").addEventListener("click", () => {
    closeToolsMenu();
    document.getElementById("resetModal").classList.add("open");
  });
  document.getElementById("cancelReset").addEventListener("click", () => document.getElementById("resetModal").classList.remove("open"));
  document.getElementById("confirmReset").addEventListener("click", () => {
    state = { ...state, schemaVersion: 1, progress: createDefaultProgress() };
    if (firebaseSync?.currentUser) markCloudReset(firebaseSync.currentUser.uid);
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
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", t("searchResults"));
      panel.setAttribute("aria-live", "polite");
      app.prepend(panel);
    }
    panel.innerHTML = results.length ? results.map(lesson => `<button type="button" class="search-result" data-route="lesson" data-id="${esc(lesson.id)}"><strong>${esc(lesson.title)}</strong><div style="font-size:12px;color:var(--muted)">${esc(t("week", { number: lesson.weekNumber }))}</div></button>`).join("") : `<p class="search-empty">${t("noSearchResults")}</p>`;
    panel.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", courseViews.handleRoute));
  });
  document.getElementById("globalSearch").addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    app.querySelector(".search-results")?.remove();
  });
  void initializeFirebaseSync();
}

init();
