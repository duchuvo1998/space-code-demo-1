import { createFirebaseSync } from "../firebase/firebase-sync.js";
import { fetchCourseManifest } from "../course/course-api.mjs";
import { createCourseViews } from "../course/course-views.mjs";
import { createDialogController } from "./dialog-controller.mjs";
import { initializeLocale, setLocale, translate as t } from "../localization/localization.mjs";
import {
  applyProgressChanges,
  diffProgress,
  resolveSignInSyncStrategy,
  summarizeProgress
} from "../progress/progress-merge.mjs";
import {
  clearLastSyncedUid,
  clearPendingCloudReset,
  createDefaultProgress,
  loadLastSyncedUid,
  loadPendingCloudReset,
  loadProgressState,
  loadWelcomeChoice,
  saveLastSyncedUid,
  savePendingCloudReset,
  saveProgressState,
  saveWelcomeChoice
} from "../progress/progress-storage.mjs";
import { mergeImportedProgress, validateImportedData as validateImportedProgress } from "../progress/progress-import.mjs";
import { UI_ICONS } from "../ui/ui-icons.mjs";

const WRITE_DELAY = 700;

await initializeLocale();

let manifest = null;
let courseViews = null;
const storedProgress = loadProgressState();
let state = storedProgress.state;
let saveTimer = null;
let saveStatusHideTimer = null;
let storageAvailable = storedProgress.available;
let searchQuery = "";
let firebaseSync = null;
let firebaseInitError = null;
let syncError = "";
const pendingCloudReset = loadPendingCloudReset();
let resetCloudUid = pendingCloudReset.uid;
if (!pendingCloudReset.available) storageAvailable = false;
const storedLastSyncedUid = loadLastSyncedUid();
let lastSyncedUid = storedLastSyncedUid.uid;
if (!storedLastSyncedUid.available) storageAvailable = false;
let activeSavePromise = null;
let saveAgain = false;
let authBusy = "";
let syncSaving = false;

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

function route(options) {
  courseViews?.route(options);
}

function syncViewAfterExternalProgressUpdate() {
  applyTheme();
  const lessonFrame = courseViews?.getLessonFrame();
  const activeLessonMatch = /^#course\/canva-gemini\/lesson\/([^/?]+)/.exec(location.hash);
  if (lessonFrame && activeLessonMatch && lessonFrame.dataset.lessonId === decodeURIComponent(activeLessonMatch[1])) {
    courseViews.sendLessonProgress(lessonFrame.dataset.lessonId);
    renderSidebar();
    return;
  }
  route({ preserveScroll: true });
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

function persistLastSyncedUid(uid) {
  lastSyncedUid = uid || "";
  if (!lastSyncedUid) return;
  const result = saveLastSyncedUid(lastSyncedUid);
  if (!result.saved) {
    storageAvailable = false;
    updateStorageBanner();
  }
}

function clearStoredLastSyncedUid() {
  lastSyncedUid = "";
  const result = clearLastSyncedUid();
  if (!result.saved) {
    storageAvailable = false;
    updateStorageBanner();
  }
}

function getUserDisplayName(user) {
  return user?.displayName?.trim() || user?.email?.trim() || t("accountFallbackName");
}

function getUserAccountLabel(user) {
  return user?.email?.trim() || user?.displayName?.trim() || t("accountFallbackName");
}

function getUserInitial(user) {
  const source = (user?.displayName || user?.email || "G").trim();
  return (source[0] || "G").toUpperCase();
}

function renderAvatarElement(container, user) {
  if (!container) return;
  if (!user) {
    container.classList.add("account-avatar-local");
    container.innerHTML = UI_ICONS.account;
    return;
  }
  container.classList.remove("account-avatar-local");
  container.textContent = getUserInitial(user);
  if (user?.photoURL && /^https?:\/\//i.test(user.photoURL)) {
    const img = document.createElement("img");
    img.className = "account-avatar-img";
    img.src = user.photoURL;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.remove());
    container.appendChild(img);
  }
}

function renderAccountMenuStats() {
  const statsEl = document.getElementById("accountMenuStats");
  if (!statsEl) return;
  statsEl.innerHTML = "";
  formatSyncSummaryItems(getProgress()).forEach(text => {
    const item = document.createElement("li");
    item.textContent = text;
    statsEl.appendChild(item);
  });
}

function closeAccountMenu({ restoreFocus = false } = {}) {
  const panel = document.getElementById("accountMenuPanel");
  const button = document.getElementById("accountButton");
  if (!panel || panel.hidden) return;
  const hadFocus = panel.contains(document.activeElement);
  panel.hidden = true;
  if (button) {
    button.setAttribute("aria-expanded", "false");
  }
  if (restoreFocus && hadFocus) {
    button?.focus({ preventScroll: true });
  }
}

function toggleAccountMenu() {
  const panel = document.getElementById("accountMenuPanel");
  const button = document.getElementById("accountButton");
  if (!panel || !button) return;
  const willOpen = panel.hidden;
  if (willOpen) {
    closeToolsMenu();
    renderAccountMenuStats();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    panel.querySelector("button:not([hidden]):not(:disabled)")?.focus({ preventScroll: true });
  } else {
    closeAccountMenu({ restoreFocus: true });
  }
}

function updateAccountUi() {
  const accountMenu = document.getElementById("accountMenu");
  const accountButton = document.getElementById("accountButton");
  const accountMenuPanel = document.getElementById("accountMenuPanel");
  const syncStatus = document.getElementById("syncStatus");
  if (!accountMenu || !accountButton || !syncStatus) return;
  const welcomeLoginButton = document.getElementById("welcomeLoginButton");

  const cloudAvailable = Boolean(firebaseSync) && !firebaseInitError;
  const user = cloudAvailable ? firebaseSync.currentUser : null;
  const syncState = firebaseInitError || syncError
    ? "error"
    : syncSaving
      ? "syncing"
      : user
        ? "synced"
        : "local";

  accountMenu.hidden = false;
  if (welcomeLoginButton) welcomeLoginButton.hidden = !cloudAvailable || Boolean(user);

  syncStatus.dataset.state = syncState;
  syncStatus.textContent = firebaseInitError
    ? t("firebaseNotConnected")
    : syncError
      ? t("syncError")
      : syncSaving
        ? t("saving")
        : user
          ? t("synced")
          : t("saveInBrowser");
  syncStatus.title = firebaseInitError
    ? t("browserProgressSaved")
    : !firebaseSync
      ? t("configureFirebase")
      : syncError || (user
        ? t("syncingWithAccount", { account: getUserAccountLabel(user) })
        : t("browserProgressSyncHint"));

  accountButton.disabled = Boolean(authBusy);
  if (authBusy) accountButton.setAttribute("aria-busy", "true");
  else accountButton.removeAttribute("aria-busy");
  accountButton.setAttribute("aria-haspopup", "menu");
  accountButton.setAttribute("aria-controls", "accountMenuPanel");
  accountButton.setAttribute("aria-expanded", String(Boolean(accountMenuPanel && !accountMenuPanel.hidden)));

  const nameEl = document.getElementById("accountMenuName");
  const emailEl = document.getElementById("accountMenuEmail");
  const menuSyncEl = document.getElementById("accountMenuSync");
  const menuSyncTextEl = document.getElementById("accountMenuSyncText");
  const retryButton = document.getElementById("retrySyncButton");
  const dividerEl = document.getElementById("accountMenuDivider");
  const signInSection = document.getElementById("accountMenuSignInSection");
  const signInMenuButton = document.getElementById("signInMenuButton");
  const signOutMenuButton = document.getElementById("signOutMenuButton");

  renderAccountMenuStats();

  if (!user) {
    accountButton.classList.add("account-btn-local");
    accountButton.classList.remove("account-btn-profile");
    accountButton.title = `${t("localProfileTitle")} — ${t("localProfileSubtitle")}`;
    accountButton.setAttribute("aria-label", authBusy === "signin" ? t("signingInProgress") : t("localProfileAria"));
    accountButton.innerHTML = authBusy === "signin"
      ? `<span class="btn-spinner" aria-hidden="true"></span><span class="account-label">${esc(t("signingInProgress"))}</span>`
      : `<span class="account-avatar-wrap"><span class="account-avatar account-avatar-local" data-trigger-avatar></span><span class="account-status-dot" data-state="${syncState}" aria-hidden="true"></span></span><span class="account-label">${esc(t("localProfileTrigger"))}</span><svg class="ui-icon account-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>`;
    renderAvatarElement(accountButton.querySelector("[data-trigger-avatar]"), null);
    renderAvatarElement(document.getElementById("accountMenuAvatar"), null);

    if (nameEl) {
      nameEl.textContent = t("localProfileTitle");
      nameEl.title = nameEl.textContent;
    }
    if (emailEl) {
      emailEl.textContent = t("localProfileSubtitle");
      emailEl.hidden = false;
      emailEl.title = emailEl.textContent;
    }
    if (menuSyncEl) menuSyncEl.dataset.state = syncState;
    if (menuSyncTextEl) {
      menuSyncTextEl.textContent = firebaseInitError
        ? t("firebaseNotConnected")
        : t("saveInBrowser");
      menuSyncTextEl.title = firebaseInitError ? t("browserProgressSaved") : t("browserProgressSyncHint");
    }
    if (retryButton) retryButton.hidden = true;
    if (signOutMenuButton) signOutMenuButton.hidden = true;
    if (signInSection) signInSection.hidden = !cloudAvailable;
    if (dividerEl) dividerEl.hidden = !cloudAvailable;
    if (signInMenuButton) signInMenuButton.disabled = Boolean(authBusy);
    return;
  }

  const accountLabel = getUserAccountLabel(user);
  accountButton.classList.remove("account-btn-local");
  accountButton.classList.add("account-btn-profile");
  accountButton.title = `${t("accountMenuTitle")} (${accountLabel})`;
  accountButton.setAttribute("aria-label", t("accountMenuLabel", { account: accountLabel }));

  accountButton.innerHTML = authBusy
    ? `<span class="btn-spinner" aria-hidden="true"></span><span class="account-label">${esc(t(authBusy === "signout" ? "signingOutProgress" : "saving"))}</span>`
    : `<span class="account-avatar-wrap"><span class="account-avatar" data-trigger-avatar></span><span class="account-status-dot" data-state="${syncState}" aria-hidden="true"></span></span><svg class="ui-icon account-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>`;
  renderAvatarElement(accountButton.querySelector("[data-trigger-avatar]"), user);
  renderAvatarElement(document.getElementById("accountMenuAvatar"), user);

  if (nameEl) {
    nameEl.textContent = getUserDisplayName(user);
    nameEl.title = nameEl.textContent;
  }
  if (emailEl) {
    emailEl.textContent = user.email || "";
    emailEl.hidden = !user.email || user.email === nameEl?.textContent;
    emailEl.title = user.email || "";
  }
  if (menuSyncEl) menuSyncEl.dataset.state = syncState;
  if (menuSyncTextEl) {
    menuSyncTextEl.textContent = syncError
      ? t("cloudSyncErrorLabel")
      : syncSaving
        ? t("cloudSyncingLabel")
        : t("cloudSyncedLabel");
    menuSyncTextEl.title = syncError || "";
  }
  if (retryButton) {
    retryButton.hidden = !syncError || Boolean(authBusy);
    retryButton.disabled = Boolean(authBusy);
  }
  if (signInSection) signInSection.hidden = true;
  if (dividerEl) dividerEl.hidden = false;
  if (signOutMenuButton) {
    signOutMenuButton.hidden = false;
    signOutMenuButton.disabled = Boolean(authBusy);
  }
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
  if (!location.hash || /\/(dashboard|portfolio|week\/)/.test(location.hash)) {
    route({ preserveScroll: true });
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  clearTimeout(saveStatusHideTimer);
  const localSaved = saveLocalState();
  syncSaving = true;
  document.getElementById("saveStatus").textContent = t("saving");
  updateAccountUi();
  document.getElementById("saveStatus").classList.add("show");
  courseViews?.notifyLessonSaveStatus(localSaved ? "saving" : "error");
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveProgress();
  }, WRITE_DELAY);
  return localSaved;
}

function flushPendingSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  saveLocalState();
  if (firebaseSync?.currentUser) {
    void saveProgress();
  }
}

async function flushPendingSaveAsync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saveLocalState();
    if (firebaseSync?.currentUser) {
      await saveProgress();
      return;
    }
  }
  if (activeSavePromise) {
    await activeSavePromise;
  }
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

function scheduleHideSaveStatus() {
  clearTimeout(saveStatusHideTimer);
  saveStatusHideTimer = setTimeout(() => {
    document.getElementById("saveStatus").classList.remove("show");
  }, 1800);
}

async function saveProgressOnce() {
  const localSaved = saveLocalState();
  if (!firebaseSync?.currentUser) {
    syncSaving = false;
    updateAccountUi();
    document.getElementById("saveStatus").textContent = formatSaveStatus(localSaved);
    courseViews?.notifyLessonSaveStatus(localSaved ? "saved" : "error");
    scheduleHideSaveStatus();
    return;
  }

  syncSaving = true;
  updateAccountUi();
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
    persistLastSyncedUid(firebaseSync.currentUser.uid);
    syncSaving = false;
    updateAccountUi();
    document.getElementById("saveStatus").textContent = formatSaveStatus(localSaved);
    courseViews?.notifyLessonSaveStatus(localSaved ? "saved" : "error");
  } catch (error) {
    syncError = error instanceof Error ? error.message : t("unknownError");
    syncSaving = false;
    updateAccountUi();
    document.getElementById("saveStatus").textContent = localSaved
      ? t("savedBrowserSyncError")
      : t("unableToSaveProgress");
    courseViews?.notifyLessonSaveStatus(localSaved ? "saved" : "error");
    showToast(t("firebaseSyncFailed", { error: syncError }), { duration: 4200 });
  }
  scheduleHideSaveStatus();
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
        syncViewAfterExternalProgressUpdate();
      }
      else syncError = "";
    } catch (error) {
      syncError = error instanceof Error ? error.message : t("unknownError");
      showToast(t("firebaseLoadFailed", { error: syncError }), { duration: 4200 });
    }
    if (!syncError) persistLastSyncedUid(firebaseSync.currentUser.uid);
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

function isPopupCancelledError(error) {
  const code = error && typeof error === "object" ? error.code : "";
  return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}

function isPopupBlockedError(error) {
  const code = error && typeof error === "object" ? error.code : "";
  return code === "auth/popup-blocked";
}

function formatSyncSummaryItems(progress) {
  const summary = summarizeProgress(progress);
  return [
    t("syncSummaryLessons", { count: summary.completedLessons }),
    t("syncSummaryChecklist", { count: summary.checkedItems }),
    t("syncSummaryPortfolio", { count: summary.portfolioCount })
  ];
}

function getConflictDescription(reason, account) {
  if (reason === "different-account") {
    return t("syncConflictDescriptionDifferentAccount", { account });
  }
  if (reason === "same-account-conflict") {
    return t("syncConflictDescriptionDiverged", { account });
  }
  return t("syncConflictDescriptionGuest", { account });
}

function restoreAuthTriggerFocus(triggerButton, hadFocus) {
  if (!hadFocus) return;
  if (document.activeElement !== document.body && document.activeElement !== document.documentElement) return;
  const fallback = triggerButton && triggerButton.isConnected && !triggerButton.hidden && !triggerButton.disabled
    ? triggerButton
    : document.getElementById("accountButton");
  if (fallback && !fallback.hidden && !fallback.disabled) {
    fallback.focus({ preventScroll: true });
  }
}

async function startGoogleSignIn(triggerButton) {
  if (!firebaseSync || authBusy) return;
  const hadFocus = document.activeElement === triggerButton;
  authBusy = "signin";
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.setAttribute("aria-busy", "true");
  }
  updateAccountUi();

  try {
    const initialProgress = cloneProgress(getProgress());
    const user = await firebaseSync.signIn();
    const replacingResetProgress = user.uid === resetCloudUid;
    const cloudProgress = replacingResetProgress ? null : await firebaseSync.getCloudProgress();
    const baselineProgress = replacingResetProgress ? null : firebaseSync.getBaselineProgress();
    const strategy = resolveSignInSyncStrategy({
      localProgress: initialProgress,
      cloudProgress,
      baselineProgress,
      lastSyncedUid,
      signingInUid: user.uid,
      replacingResetProgress
    });

    let resolution = strategy.action;
    if (strategy.prompt) {
      if (triggerButton) {
        triggerButton.disabled = false;
        triggerButton.removeAttribute("aria-busy");
      }
      const accountLabel = getUserAccountLabel(user);
      resolution = await dialogs.requestSyncConflictResolution({
        description: getConflictDescription(strategy.reason, accountLabel),
        cloudTitle: `${t("syncConflictCloudLabel")} (${accountLabel})`,
        localItems: formatSyncSummaryItems(initialProgress),
        cloudItems: formatSyncSummaryItems(cloudProgress),
        recommended: strategy.recommended
      });

      if (!resolution) {
        await firebaseSync.signOut();
        syncError = "";
        authBusy = "";
        updateAccountUi();
        showToast(t("syncCancelledNotice"));
        if (document.getElementById("welcomeModal").dataset.restoreAfterSignIn === "true") {
          dialogs.showWelcome(true);
        }
        return;
      }
    }

    let successToast = t("signedInNotice");
    if (resolution === "already-in-sync") {
      firebaseSync.adoptCloudProgress(cloudProgress);
    } else if (resolution === "use-cloud") {
      const adopted = firebaseSync.adoptCloudProgress(cloudProgress) || cloudProgress;
      state = {
        ...state,
        progress: cloneProgress(adopted)
      };
      saveLocalState();
      syncViewAfterExternalProgressUpdate();
      successToast = strategy.prompt ? t("syncedUsingCloudNotice") : t("signedInNotice");
    } else {
      const replaceCloud = resolution === "replace-cloud" || resolution === "upload-local";
      const useBaseline = resolution === "three-way-merge";
      const syncedProgress = await firebaseSync.loadProgress(
        initialProgress,
        replaceCloud,
        useBaseline
      );
      if (syncedProgress) {
        state = {
          ...state,
          progress: applySyncedProgress(initialProgress, getProgress(), syncedProgress)
        };
        saveLocalState();
        syncViewAfterExternalProgressUpdate();
      }
      if (replacingResetProgress) clearCloudReset();
      if (resolution === "merge" || resolution === "three-way-merge") {
        successToast = t("syncedMergedNotice");
      } else if (resolution === "replace-cloud" && cloudProgress && !replacingResetProgress) {
        successToast = t("syncedReplacedCloudNotice");
      }
    }

    persistLastSyncedUid(user.uid);
    syncError = "";
    authBusy = "";
    updateAccountUi();
    showToast(successToast);
  } catch (error) {
    if (isPopupCancelledError(error)) {
      return;
    }
    if (isPopupBlockedError(error)) {
      showToast(t("popupBlockedNotice"), { duration: 4500 });
      return;
    }
    syncError = error instanceof Error ? error.message : t("unknownError");
    updateAccountUi();
    showToast(t("syncProgressFailed", { error: syncError }), { duration: 4200 });
  } finally {
    authBusy = "";
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.removeAttribute("aria-busy");
    }
    updateAccountUi();
    restoreAuthTriggerFocus(triggerButton, hadFocus);
  }
}

async function performSignOut({ clearLocal = false } = {}) {
  if (!firebaseSync?.currentUser || authBusy) return;
  const previousUid = firebaseSync.currentUser.uid;
  authBusy = "signout";
  updateAccountUi();

  try {
    await flushPendingSaveAsync();
    await firebaseSync.signOut();
    if (clearLocal) {
      state = { ...state, schemaVersion: 1, progress: createDefaultProgress() };
      saveLocalState();
      firebaseSync.clearBaseline(previousUid);
      clearStoredLastSyncedUid();
      syncViewAfterExternalProgressUpdate();
    } else {
      persistLastSyncedUid(previousUid);
    }
    syncError = "";
    showToast(t(clearLocal ? "signedOutClearedNotice" : "signedOutNotice"));
  } catch (error) {
    syncError = error instanceof Error ? error.message : t("unknownError");
    showToast(t("syncProgressFailed", { error: syncError }), { duration: 4200 });
  } finally {
    authBusy = "";
    updateAccountUi();
    document.getElementById("accountButton")?.focus({ preventScroll: true });
  }
}

async function retryCloudSync() {
  if (!firebaseSync?.currentUser || authBusy) return;
  authBusy = "retry";
  syncSaving = true;
  updateAccountUi();
  try {
    await saveProgress();
    if (!syncError) showToast(t("synced"));
  } finally {
    authBusy = "";
    syncSaving = false;
    updateAccountUi();
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

function showToast(message, { duration = 2600 } = {}) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), duration);
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
    document.getElementById("pfDate").value = todayISO();
  }
  dialogs.openDialog(modal, { initialFocus: () => document.getElementById("pfLesson") });
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

function closePortfolioModal(options) {
  dialogs.closeDialog(document.getElementById("portfolioModal"), options);
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

function closeToolsMenu({ restoreFocus = false } = {}) {
  const topbarTools = document.getElementById("topbarTools");
  if (!window.matchMedia("(min-width: 1560px)").matches && topbarTools.open) {
    const hadFocus = topbarTools.contains(document.activeElement);
    topbarTools.open = false;
    if (restoreFocus && hadFocus) {
      topbarTools.querySelector("summary")?.focus({ preventScroll: true });
    }
  }
}

function validateImportedData(parsed) {
  return validateImportedProgress(parsed, manifest);
}

function mergeImportedData(parsed) {
  state = mergeImportedProgress(parsed, getProgress());
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
    if (!Number.isFinite(event.data.height) || event.data.height < 200 || event.data.height > 200000) return;
    lessonFrame.style.height = `${Math.ceil(event.data.height)}px`;
    courseViews?.onLessonFrameResize?.();
    return;
  }
  if (event.data.type === "LESSON_READY") {
    courseViews?.sendLessonProgress(event.data.lessonId);
    return;
  }
  if (event.data.type === "LESSON_COPY_PROMPT") {
    showToast(t(event.data.copied ? "copiedPromptToast" : "copyPromptFailed"));
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

  window.addEventListener("hashchange", () => route());
  window.addEventListener("pagehide", flushPendingSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingSave();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  document.querySelector(".skip-link")?.addEventListener("click", event => {
    event.preventDefault();
    const mainContent = document.getElementById("mainContent");
    if (!mainContent) return;
    mainContent.focus({ preventScroll: true });
    mainContent.scrollIntoView({ block: "start" });
  });
  document.getElementById("brandButton").addEventListener("click", () => {
    document.getElementById("searchResults")?.remove();
    const dashboardHash = "#course/canva-gemini/dashboard";
    if (location.hash === dashboardHash) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } else {
      location.hash = dashboardHash;
    }
  });
  document.getElementById("menuToggle").addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    document.getElementById("drawerBackdrop").classList.toggle("open", isOpen);
    const menuToggle = document.getElementById("menuToggle");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", t(isOpen ? "closeNavigation" : "openNavigation"));
    if (isOpen) {
      sidebar.querySelector("button, a")?.focus();
    }
  });
  const topbarTools = document.getElementById("topbarTools");
  const accountMenu = document.getElementById("accountMenu");
  const wideToolbar = window.matchMedia("(min-width: 1560px)");
  const syncToolsLayout = () => {
    topbarTools.open = wideToolbar.matches;
  };
  syncToolsLayout();
  wideToolbar.addEventListener("change", syncToolsLayout);
  topbarTools.addEventListener("toggle", () => {
    if (topbarTools.open && !wideToolbar.matches) closeAccountMenu();
  });
  document.addEventListener("click", event => {
    if (!(event.target instanceof Node) || !topbarTools.contains(event.target)) {
      closeToolsMenu();
    }
    if (!(event.target instanceof Node) || !accountMenu?.contains(event.target)) {
      closeAccountMenu();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (document.querySelector(".modal-backdrop.open")) return;
    const accountMenuPanel = document.getElementById("accountMenuPanel");
    if (accountMenuPanel && !accountMenuPanel.hidden) {
      closeAccountMenu({ restoreFocus: true });
      return;
    }
    if (sidebar.classList.contains("open")) {
      closeMobileMenu();
      document.getElementById("menuToggle").focus();
      return;
    }
    const searchResults = document.getElementById("searchResults");
    if (searchResults) {
      const returnToSearch = searchResults.contains(document.activeElement);
      searchResults.remove();
      if (returnToSearch) document.getElementById("globalSearch")?.focus({ preventScroll: true });
      return;
    }
    if (!topbarTools.open || wideToolbar.matches) return;
    closeToolsMenu();
    topbarTools.querySelector("summary").focus();
  });
  document.querySelectorAll("[data-locale]").forEach(button => button.addEventListener("click", async event => {
    await setLocale(event.currentTarget.dataset.locale);
    closeToolsMenu({ restoreFocus: true });
    refreshPortfolioModalLocale();
    const menuToggle = document.getElementById("menuToggle");
    menuToggle.setAttribute("aria-label", t(sidebar.classList.contains("open") ? "closeNavigation" : "openNavigation"));
    updateAccountUi();
    updateStorageBanner();
    if (!courseViews?.refreshActiveLessonLocale?.()) {
      route({ preserveScroll: true });
    }
  }));
  document.getElementById("drawerBackdrop").addEventListener("click", closeMobileMenu);
  document.getElementById("themeButton").addEventListener("click", () => {
    const progress = getProgress();
    const current = progress.theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : progress.theme;
    progress.theme = current === "dark" ? "light" : "dark";
    applyTheme();
    scheduleSave();
    closeToolsMenu({ restoreFocus: true });
  });
  document.getElementById("accountButton").addEventListener("click", () => {
    toggleAccountMenu();
  });
  document.getElementById("signInMenuButton").addEventListener("click", () => {
    closeAccountMenu();
    void startGoogleSignIn(document.getElementById("accountButton"));
  });
  document.getElementById("retrySyncButton").addEventListener("click", () => {
    closeAccountMenu();
    void retryCloudSync();
  });
  document.getElementById("signOutMenuButton").addEventListener("click", async () => {
    closeAccountMenu();
    const user = firebaseSync?.currentUser;
    if (!user) return;
    const result = await dialogs.requestSignOutConfirmation({
      description: t("signOutModalDescription", { account: getUserAccountLabel(user) })
    });
    if (result?.confirmed) {
      await performSignOut({ clearLocal: result.clearLocal });
    }
  });
  document.getElementById("welcomeLoginButton").addEventListener("click", async event => {
    const button = event.currentTarget;
    document.getElementById("welcomeModal").dataset.restoreAfterSignIn = "true";
    await startGoogleSignIn(button);
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
    closeToolsMenu({ restoreFocus: true });
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
      const saved = scheduleSave();
      route();
      showToast(t(saved ? "importedProgress" : "unableToSaveProgress"));
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
    const titleInput = document.getElementById("pfTitle");
    const title = titleInput.value.trim();
    const link = document.getElementById("pfLink").value.trim();
    if (link && !/^https?:\/\//i.test(link)) {
      showToast(t("invalidLink"));
      return;
    }
    if (!title) {
      titleInput.value = "";
      titleInput.reportValidity?.();
      titleInput.focus();
      return;
    }
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
    closePortfolioModal({ restoreFocus: false });
    scheduleSave();
    renderSidebar();
    renderPortfolio();
    const nextFocus = editId
      ? app.querySelector(`[data-edit-pf="${CSS.escape(item.id)}"]`) || document.getElementById("addPortfolio")
      : document.getElementById("addPortfolio");
    nextFocus?.focus({ preventScroll: true });
  });
  document.getElementById("cancelPortfolio").addEventListener("click", () => closePortfolioModal());
  document.getElementById("resetButton").addEventListener("click", () => {
    closeToolsMenu();
    dialogs.openDialog(document.getElementById("resetModal"), {
      initialFocus: () => document.getElementById("cancelReset")
    });
  });
  document.getElementById("cancelReset").addEventListener("click", () => {
    dialogs.closeDialog(document.getElementById("resetModal"));
  });
  document.getElementById("confirmReset").addEventListener("click", () => {
    state = { ...state, schemaVersion: 1, progress: createDefaultProgress() };
    if (firebaseSync?.currentUser) markCloudReset(firebaseSync.currentUser.uid);
    else clearStoredLastSyncedUid();
    applyTheme();
    scheduleSave();
    dialogs.closeDialog(document.getElementById("resetModal"), { restoreFocus: false });
    route();
    document.getElementById("mainContent")?.focus({ preventScroll: true });
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
