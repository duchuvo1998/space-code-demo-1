import { loadFirebaseConfig } from "./firebase-config.js";
import { translate as t } from "../localization/localization.mjs";
import {
  applyProgressChanges,
  diffProgress,
  mergeProgress
} from "../progress/progress-merge.mjs";

const FIREBASE_SDK_VERSION = "11.10.0";
const CLOUD_PAYLOAD_LIMIT = 900000;
const SYNC_BASELINE_KEY = "canva-gemini-course:firebase-baseline:v1:";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasFirebaseConfig(config) {
  return isRecord(config)
    && ["apiKey", "authDomain", "projectId", "appId"].every(key =>
      typeof config[key] === "string" && config[key].length > 0
    );
}

function validateCloudProgress(progress) {
  if (!isRecord(progress)) throw new Error(t("invalidFirebaseProgress"));
  const payload = JSON.stringify({ schemaVersion: 1, progress, updatedAt: null });
  if (new TextEncoder().encode(payload).length > CLOUD_PAYLOAD_LIMIT) {
    throw new Error(t("firebasePayloadTooLarge"));
  }
}

function baselineKey(uid) {
  return `${SYNC_BASELINE_KEY}${uid}`;
}

function readBaseline(uid) {
  try {
    const saved = localStorage.getItem(baselineKey(uid));
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!isRecord(parsed)) throw new Error(t("invalidSyncBaseline"));
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(t("corruptSyncBaseline"));
    }
    throw error;
  }
}

function saveBaseline(uid, progress) {
  try {
    localStorage.setItem(baselineKey(uid), JSON.stringify(progress));
  } catch {
    // Ignore storage failures when updating the local sync baseline.
  }
}

function removeBaseline(uid) {
  if (!uid) return;
  try {
    localStorage.removeItem(baselineKey(uid));
  } catch {
    // Ignore storage failures when clearing a local sync baseline.
  }
}

export async function createFirebaseSync() {
  const firebaseConfig = await loadFirebaseConfig();
  if (!hasFirebaseConfig(firebaseConfig)) return null;

  const baseUrl = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  const [appSdk, authSdk, firestoreSdk] = await Promise.all([
    import(`${baseUrl}/firebase-app.js`),
    import(`${baseUrl}/firebase-auth.js`),
    import(`${baseUrl}/firebase-firestore.js`)
  ]);
  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);
  const provider = new authSdk.GoogleAuthProvider();
  let synchronizationQueue = Promise.resolve();

  let currentUser = await new Promise((resolve, reject) => {
    let unsubscribe;
    unsubscribe = authSdk.onAuthStateChanged(
      auth,
      user => {
        unsubscribe();
        resolve(user);
      },
      reject
    );
  });

  function progressDocument(user) {
    return firestoreSdk.doc(db, "users", user.uid, "course", "progress");
  }

  async function getCloudProgress() {
    const user = currentUser;
    if (!user) return null;
    const snapshot = await firestoreSdk.getDoc(progressDocument(user));
    if (!snapshot.exists()) return null;
    const cloudDocument = snapshot.data();
    if (cloudDocument.schemaVersion !== 1 || !isRecord(cloudDocument.progress)) {
      throw new Error(t("incompatibleFirebaseProgress"));
    }
    return cloudDocument.progress;
  }

  function makeCloudDocument(progress) {
    validateCloudProgress(progress);
    return {
      schemaVersion: 1,
      progress,
      updatedAt: firestoreSdk.serverTimestamp()
    };
  }

  async function synchronizeProgressNow(localProgress, replace = false, useBaseline = true) {
    const user = currentUser;
    if (!user) return null;
    validateCloudProgress(localProgress);
    const baseline = replace || !useBaseline ? null : readBaseline(user.uid);
    const reference = progressDocument(user);
    const merged = await firestoreSdk.runTransaction(db, async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) {
        transaction.set(reference, makeCloudDocument(localProgress));
        return localProgress;
      }

      const cloudDocument = snapshot.data();
      if (cloudDocument.schemaVersion !== 1 || !isRecord(cloudDocument.progress)) {
        throw new Error(t("incompatibleFirebaseProgress"));
      }

      const nextProgress = replace
        ? localProgress
        : baseline
          ? applyProgressChanges(
              cloudDocument.progress,
              diffProgress(baseline, localProgress)
            )
          : mergeProgress(localProgress, cloudDocument.progress);

      if (replace || JSON.stringify(nextProgress) !== JSON.stringify(cloudDocument.progress)) {
        transaction.set(reference, makeCloudDocument(nextProgress));
      }
      return nextProgress;
    });
    saveBaseline(user.uid, merged);
    return merged;
  }

  function synchronizeProgress(localProgress, replace = false, useBaseline = true) {
    if (!currentUser) return Promise.resolve(null);
    const queuedSync = synchronizationQueue.then(() =>
      synchronizeProgressNow(localProgress, replace, useBaseline)
    );
    // Keep later saves runnable while returning this save's error to its caller.
    synchronizationQueue = queuedSync.catch(() => {});
    return queuedSync;
  }

  return {
    get currentUser() {
      return currentUser;
    },
    getCloudProgress,
    getBaselineProgress() {
      if (!currentUser) return null;
      try {
        return readBaseline(currentUser.uid);
      } catch {
        return null;
      }
    },
    adoptCloudProgress(cloudProgress) {
      if (!currentUser || !isRecord(cloudProgress)) return null;
      saveBaseline(currentUser.uid, cloudProgress);
      return cloudProgress;
    },
    clearBaseline(uid = currentUser?.uid) {
      removeBaseline(uid);
    },
    loadProgress: synchronizeProgress,
    async saveProgress(progress, replace = false) {
      return synchronizeProgress(progress, replace);
    },
    async signIn() {
      const credential = await authSdk.signInWithPopup(auth, provider);
      currentUser = credential.user;
      return currentUser;
    },
    async signOut() {
      await authSdk.signOut(auth);
      currentUser = null;
    }
  };
}
