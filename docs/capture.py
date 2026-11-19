#!/usr/bin/env python3
"""Regenerate docs/screenshots/*.jpg, docs/walkthrough.mp4 and docs/walkthrough.gif from the real app.

    python docs/capture.py

It never touches your own database. Everything runs in a throwaway sandbox:

  1. a temporary SQLite database + media folder (deleted afterwards)
  2. `cli.py init-db` + `cli.py seed`, an admin registered through the API, then `cli.py demo-data`
  3. the API on http://127.0.0.1:8765 and the web app on http://localhost:5199 (both stopped afterwards)
  4. _capture.js signs in through the real sign-in page with headless Chrome / Edge, opens every
     screen, and writes the screenshots + video

Needs: backend/venv (pip install -r backend/requirements.txt), frontend/node_modules (npm install),
Node.js on PATH and Chrome or Edge installed. On the first run it installs puppeteer-core and
ffmpeg-static into docs/node_modules (git-ignored).
"""
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import json

DOCS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(DOCS)
BACKEND = os.path.join(ROOT, "backend")
FRONTEND = os.path.join(ROOT, "frontend")
API_PORT, WEB_PORT = 8765, 5199
API = f"http://127.0.0.1:{API_PORT}"
WEB = f"http://localhost:{WEB_PORT}"
USER, PASS = "demo_admin", "Ledger-Demo-2026!"
DEPS = ("puppeteer-core@24", "ffmpeg-static@5")


def backend_python() -> str:
    for c in (os.path.join(BACKEND, "venv", "Scripts", "python.exe"),
              os.path.join(BACKEND, "venv", "bin", "python"),
              os.path.join(BACKEND, ".venv", "Scripts", "python.exe"),
              os.path.join(BACKEND, ".venv", "bin", "python")):
        if os.path.exists(c):
            return c
    return sys.executable


def wait_for(url: str, seconds: int = 90) -> None:
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=3)
            return
        except urllib.error.HTTPError:
            return  # the server answered
        except Exception:
            time.sleep(0.7)
    sys.exit(f"Timed out waiting for {url}")


def post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def stop(proc: subprocess.Popen | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.call(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> None:
    node, npm = shutil.which("node"), shutil.which("npm")
    if not node or not npm:
        sys.exit("Node.js + npm are required and were not found on PATH.")
    vite = os.path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js")
    if not os.path.exists(vite):
        sys.exit("Run `npm install` in frontend/ first.")
    if not os.path.isdir(os.path.join(DOCS, "node_modules", "puppeteer-core")):
        subprocess.check_call([npm, "install", "--no-save", "--no-package-lock", *DEPS], cwd=DOCS)

    sandbox = tempfile.mkdtemp(prefix="ledgerdesk-capture-")
    db_path = os.path.join(sandbox, "capture.db").replace("\\", "/")
    env = {
        **os.environ,
        # Environment variables win over backend/.env, so the real database is never used.
        "DATABASE_URL": f"sqlite:///{db_path}",
        "SECRET_KEY": secrets.token_urlsafe(48),
        "MEDIA_ROOT": os.path.join(sandbox, "media"),
        "BACKUP_DIR": os.path.join(sandbox, "backups"),
        "RECURRING_CHECK_MINUTES": "0",
        "AUTH_RATE_LIMIT_PER_MINUTE": "1000",
        "SMTP_HOST": "",
        "GEMINI_API_KEY": "",
        "OPENAI_API_KEY": "",
        "TESTING_TOOLS": "false",
        "VITE_API_URL": API,
    }
    py = backend_python()
    api_proc = web_proc = None
    try:
        print("+ preparing a sandbox database in", sandbox)
        subprocess.check_call([py, "cli.py", "init-db"], cwd=BACKEND, env=env)
        subprocess.check_call([py, "cli.py", "seed"], cwd=BACKEND, env=env)

        print(f"+ starting the API on {API}")
        api_proc = subprocess.Popen([py, "-m", "uvicorn", "app.main:app", "--port", str(API_PORT),
                                     "--log-level", "warning"], cwd=BACKEND, env=env)
        wait_for(API + "/docs")
        post_json(API + "/api/auth/register/", {"username": USER, "password": PASS,
                                                "first_name": "Demo", "last_name": "Admin",
                                                "email": "accounts@example.com"})
        subprocess.check_call([py, "cli.py", "demo-data"], cwd=BACKEND, env=env)

        print(f"+ starting the web app on {WEB}")
        web_proc = subprocess.Popen([node, vite, "--port", str(WEB_PORT), "--strictPort"],
                                    cwd=FRONTEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        wait_for(WEB + "/login")

        subprocess.check_call([node, "_capture.js"], cwd=DOCS,
                              env={**env, "APP_URL": WEB, "CAPTURE_USER": USER, "CAPTURE_PASS": PASS})
    finally:
        stop(web_proc)
        stop(api_proc)
        time.sleep(1)
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == "__main__":
    main()
