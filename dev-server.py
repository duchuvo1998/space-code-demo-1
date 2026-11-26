#!/usr/bin/env python3
import argparse
import hashlib
import io
import json
import os
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


IGNORED_DIRECTORIES = {".git", ".github", "node_modules", "progress"}


def files_version(root):
    entries = []
    for current, directories, filenames in os.walk(root):
        directories[:] = [
            name for name in directories
            if name not in IGNORED_DIRECTORIES and not name.startswith(".")
        ]
        for filename in filenames:
            if filename.startswith(".") or filename.endswith(".log"):
                continue
            path = Path(current, filename)
            try:
                details = path.stat()
            except OSError:
                continue
            relative_path = path.relative_to(root).as_posix()
            entries.append(
                f"{relative_path}\0{details.st_mtime_ns}\0{details.st_size}\n"
            )
    return hashlib.sha256("".join(sorted(entries)).encode()).hexdigest()


class LiveReloadHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, directory):
        self.root = Path(directory).resolve()
        self._version = files_version(self.root)
        self._version_lock = threading.Lock()
        handler = partial(DevServerHandler, directory=str(self.root))
        super().__init__(address, handler)
        threading.Thread(target=self._watch_files, daemon=True).start()

    def get_version(self):
        with self._version_lock:
            return self._version

    def _watch_files(self):
        candidate = self._version
        candidate_since = time.monotonic()
        while True:
            time.sleep(0.5)
            version = files_version(self.root)
            if version != candidate:
                candidate = version
                candidate_since = time.monotonic()
            elif version != self.get_version() and time.monotonic() - candidate_since >= 1:
                with self._version_lock:
                    self._version = version


class DevServerHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        request_path = urlsplit(self.path).path
        if request_path == "/__dev__/version":
            body = json.dumps({"version": self.server.get_version()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if any(
            part == ".env" or part.startswith(".env.")
            for part in Path(unquote(request_path)).parts
        ):
            self.send_error(404)
            return
        super().do_GET()

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            for index_name in ("index.html", "index.htm"):
                index_path = os.path.join(path, index_name)
                if os.path.isfile(index_path):
                    path = index_path
                    break
        if os.path.isfile(path) and path.lower().endswith(".html"):
            with open(path, "rb") as html_file:
                content = html_file.read()
            live_reload = b'\n<script src="/assets/dev/dev-live-reload.js"></script>\n'
            closing_body = content.lower().rfind(b"</body>")
            if closing_body >= 0:
                content = content[:closing_body] + live_reload + content[closing_body:]
            else:
                content += live_reload
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
            self.end_headers()
            return io.BytesIO(content)
        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description="Serve the course with local live reload.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--directory", default=".")
    args = parser.parse_args()

    with LiveReloadHTTPServer((args.host, args.port), args.directory) as server:
        print(f"Serving {server.root} at http://{args.host}:{args.port}/ (Ctrl+C to stop)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
