# Canva + Gemini Course

A static course tracker with a Vietnamese/English interface. Course lessons remain in Vietnamese.

## Run locally

```bash
python3 dev-server.py
```

Open <http://localhost:4173/>. The page reloads when application files change. The server binds to localhost by default; do not open `index.html` directly.

## Notes

- Progress is saved in browser storage. Google sign-in is optional for cloud sync.
- Only the selected interface language is loaded. Add a locale file and register it in `assets/localization/localization.mjs`.
- JavaScript modules are grouped under `assets/` by feature (`app/`, `course/`, `firebase/`, `progress/`, `localization/`, `ui/`, and `dev/`). Lessons and their manifest are in `courses/canva-gemini/`.
- For Firebase setup, see [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md).
