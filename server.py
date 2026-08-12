#!/usr/bin/env python3
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(ROOT, "save")
os.makedirs(SAVE_DIR, exist_ok=True)
PORT = int(os.environ.get("PORT", "8383"))

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


def sanitize(name):
    if not name or name in (".", ".."):
        return None
    base = os.path.basename(name)
    if base != name or "/" in name or "\\" in name:
        return None
    base = re.sub(r"^\.+", "", base).replace("..", "_")
    if not base:
        return None
    if not base.lower().endswith(".sav"):
        base += ".sav"
    return base


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send(self, status, body=b"", ctype="text/plain; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def _world_rest(self):
        path = unquote(urlparse(self.path).path)
        if not path.startswith("/api/worlds"):
            return None
        return path[len("/api/worlds"):].rstrip("/")

    def do_GET(self):
        rest = self._world_rest()
        if rest is not None:
            if not rest:
                items = []
                for name in sorted(os.listdir(SAVE_DIR), key=lambda n: os.path.getmtime(os.path.join(SAVE_DIR, n)), reverse=True):
                    if not name.lower().endswith(".sav"):
                        continue
                    st = os.stat(os.path.join(SAVE_DIR, name))
                    items.append({"name": name, "size": st.st_size, "mtime": st.st_mtime * 1000})
                return self._json(200, items)
            name = sanitize(rest[1:])
            if not name:
                return self._send(400, b"Bad file name")
            try:
                with open(os.path.join(SAVE_DIR, name), "rb") as f:
                    self._send(200, f.read(), "application/octet-stream")
            except OSError:
                self._send(404, b"Save not found")
            return
        path = "/" if urlparse(self.path).path == "/" else unquote(urlparse(self.path).path)
        if path == "/":
            path = "/index.html"
        file = os.path.realpath(os.path.join(ROOT, path.lstrip("/")))
        if not file.startswith(ROOT):
            return self._send(403, b"Forbidden")
        if not os.path.isfile(file):
            return self._send(404, b"Not found")
        ext = os.path.splitext(file)[1].lower()
        with open(file, "rb") as f:
            self._send(200, f.read(), MIME.get(ext, "application/octet-stream"))

    def do_PUT(self):
        rest = self._world_rest()
        if rest is None:
            return self._send(404, b"Not found")
        name = sanitize(rest[1:]) if rest else None
        if not name:
            return self._send(400, b"Bad file name")
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else b""
        with open(os.path.join(SAVE_DIR, name), "wb") as f:
            f.write(body)
        self._json(200, {"ok": True, "name": name})

    def do_DELETE(self):
        rest = self._world_rest()
        if rest is None:
            return self._send(404, b"Not found")
        name = sanitize(rest[1:]) if rest else None
        if not name:
            return self._send(400, b"Bad file name")
        try:
            os.remove(os.path.join(SAVE_DIR, name))
        except OSError:
            pass
        self._json(200, {"ok": True})


if __name__ == "__main__":
    print("MiniCraft running at http://localhost:%d/" % PORT)
    print("World saves are written to %s" % SAVE_DIR)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()