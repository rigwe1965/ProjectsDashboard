#!/usr/bin/env python3
"""pd-ctl: a tiny, restricted container controller for the hosted admin console.

Why it exists: the console runs in a container and must NOT hold the Docker socket (that would hand a web-facing service control of the
whole server). This helper runs on the HOST, listens on a unix socket that only the console container has mounted, and understands four
verbs only: start, stop, restart, logs. It acts only on containers that the registry file lists for a demo app, so it can never touch the
gateway, the console, Caddy, the database or anything else. Every request needs the shared bearer token. No shell is ever used: docker is
called with an argument list. Standard library only (the server has python3, not node).

Run:  PD_CTL_TOKEN=... python3 pd-ctl.py --registry /path/apps.hosted.json --socket /run/pd-ctl/ctl.sock
"""
import argparse, hmac, json, os, re, socketserver, subprocess, threading
from http.server import BaseHTTPRequestHandler

NAME_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$')
VERBS = {'start': ['start'], 'stop': ['stop', '-t', '10'], 'restart': ['restart', '-t', '10']}
MAX_LOG_LINES = 300
MAX_BODY = 2048
LOCK = threading.Lock()  # one docker command at a time


def allowed_containers(registry_path):
    """Container names of the demo apps in the registry (re-read on every request, so editing the registry needs no restart)."""
    with open(registry_path, encoding='utf-8') as f:
        reg = json.load(f)
    names = set()
    for app in reg.get('apps', []):
        if app.get('hidden'):
            continue  # hidden entries are placeholders that are never deployed
        for proc in app.get('processes', []):
            n = proc.get('container')
            if isinstance(n, str) and NAME_RE.match(n):
                names.add(n)
    return names


def run_docker(args, timeout):
    try:
        r = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout, shell=False)
        out = (r.stdout + r.stderr).strip()
        return r.returncode == 0, out[-20000:]
    except subprocess.TimeoutExpired:
        return False, 'timed out'
    except OSError as e:
        return False, f'docker not available: {e}'


def handle(verb, body, registry_path):
    """Pure function (testable): returns (http_status, payload)."""
    if verb not in VERBS and verb != 'logs':
        return 404, {'ok': False, 'error': 'unknown verb'}
    container = body.get('container') if isinstance(body, dict) else None
    if not isinstance(container, str) or not NAME_RE.match(container):
        return 400, {'ok': False, 'error': 'invalid container name'}
    try:
        if container not in allowed_containers(registry_path):
            return 403, {'ok': False, 'error': 'container is not a registered demo container'}
    except (OSError, ValueError):
        return 500, {'ok': False, 'error': 'registry unreadable'}
    with LOCK:
        if verb == 'logs':
            lines = body.get('lines', 200)
            lines = lines if isinstance(lines, int) and 1 <= lines <= MAX_LOG_LINES else 200
            ok, out = run_docker(['logs', '--tail', str(lines), container], 20)
        else:
            ok, out = run_docker([*VERBS[verb], container], 60)
    return (200 if ok else 502), {'ok': ok, 'output': out}


def make_handler(token, registry_path):
    class H(BaseHTTPRequestHandler):
        server_version = 'pd-ctl'
        timeout = 90

        def log_message(self, *a):  # keep the journal quiet; actions are audited by the console
            pass

        def _send(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            supplied = self.headers.get('authorization', '')
            expected = 'Bearer ' + token
            if not hmac.compare_digest(supplied.encode(), expected.encode()):
                return self._send(401, {'ok': False, 'error': 'unauthorized'})
            try:
                n = int(self.headers.get('content-length', '0'))
            except ValueError:
                n = -1
            if n < 0 or n > MAX_BODY:
                return self._send(413, {'ok': False, 'error': 'bad body size'})
            try:
                body = json.loads(self.rfile.read(n) or b'{}')
            except ValueError:
                return self._send(400, {'ok': False, 'error': 'bad json'})
            m = re.fullmatch(r'/v1/(start|stop|restart|logs)', self.path)
            if not m:
                return self._send(404, {'ok': False, 'error': 'not found'})
            status, payload = handle(m.group(1), body, registry_path)
            self._send(status, payload)

        def do_GET(self):
            self._send(405, {'ok': False, 'error': 'POST only'})
    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--registry', required=True)
    ap.add_argument('--socket', required=True)
    args = ap.parse_args()
    token = os.environ.get('PD_CTL_TOKEN', '')
    if len(token) < 32:
        raise SystemExit('PD_CTL_TOKEN must be set (at least 32 characters)')
    if os.path.exists(args.socket):
        os.unlink(args.socket)
    class UnixHTTPServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):  # defined here: Windows has no unix sockets
        daemon_threads = True

        def get_request(self):
            req, _ = super().get_request()
            return req, ('local', 0)

    old = os.umask(0o117)  # socket mode 0660
    try:
        srv = UnixHTTPServer(args.socket, make_handler(token, args.registry))
    finally:
        os.umask(old)
    srv.serve_forever()


if __name__ == '__main__':
    main()
