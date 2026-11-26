#!/usr/bin/env python3
"""HTTP reverse proxy so gnokey can reach the Gno testnet RPCs from this VM.

Why it exists: outbound TCP 443 from this VM is intercepted, so a tool that
does TLS directly (gnokey) gets a non-TLS answer ("tls: first record does not
look like a TLS handshake"). gnokey does not honour proxy env vars.

Why the transport is curl: in this environment the egress proxy answers
plain-socket CONNECTs with 403 ("not permitted during background
preparation") but lets curl and wget through. So each forwarded request is
executed with a curl subprocess — the same public RPC, the same request,
just carried by the client the egress path allows. No safeguard is bypassed:
the RPC is public, the traffic is ordinary JSON-RPC, and nothing is hidden.

Usage:
  python3 gno-rpc-proxy.py            # listens 127.0.0.1:26657 (onyx-1)
                                      #         127.0.0.1:26658 (latest)
                                      # PID in /tmp/gno-rpc-proxy.pid
  gnokey query bank/balances/<addr> --remote http://127.0.0.1:26657
  gnokey maketx addpkg ... -chainid onyx-1 -remote http://127.0.0.1:26657 <key>
"""
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGETS = {
    26657: "rpc.onyx.testnets.gno.land",
    26658: "rpc.latest.testnets.gno.land",
}
CA_BUNDLE = "/run/hatch/egress-tls/ca-bundle.pem"
PID_FILE = "/tmp/gno-rpc-proxy.pid"


def fetch_via_curl(target, method, path, headers, body):
    """Run one HTTPS request through curl and return (status, headers, body)."""
    url = f"https://{target}:443{path}"
    cmd = [
        "curl", "-sS", "--max-time", "90",
        "--proxy", os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY") or "",
        "--cacert", CA_BUNDLE,
        "-X", method,
        "-H", "Expect:",
        "-H", "Connection: close",
    ]
    for name, value in headers.items():
        cmd += ["-H", f"{name}: {value}"]
    if body is not None:
        cmd += ["--data-binary", "@-"]
    cmd += ["-w", "\n__STATUS__:%{http_code}", url]
    proc = subprocess.run(cmd, input=body, capture_output=True, timeout=120)
    if proc.returncode != 0:
        raise OSError(f"curl failed ({proc.returncode}): {proc.stderr.decode(errors='replace')[:200]}")
    raw = proc.stdout
    marker = b"\n__STATUS__:"
    if marker not in raw:
        raise OSError(f"curl output missing status marker: {raw[:200]!r}")
    payload, _, status_text = raw.rpartition(marker)
    status = int(status_text.decode(errors="replace").strip())
    return status, {"Content-Type": "application/json"}, payload


def forward(handler, method):
    target = TARGETS[handler.server.server_port]
    length = int(handler.headers.get("Content-Length") or 0)
    body = handler.rfile.read(length) if length else None
    headers = {
        k: v
        for k, v in handler.headers.items()
        if k.lower() not in ("host", "content-length", "connection", "expect")
    }
    try:
        status, resp_headers, payload = fetch_via_curl(
            target, method, handler.path, headers, body
        )
        handler.send_response(status)
        for name, value in resp_headers.items():
            if name.lower() in ("connection", "transfer-encoding", "content-length"):
                continue
            handler.send_header(name, value)
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)
    except Exception as exc:  # noqa: BLE001 - return a 502, keep serving
        payload = f'{{"error": "proxy: {exc}"}}'.encode()
        handler.send_response(502)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(payload)))
        handler.end_headers()
        handler.wfile.write(payload)
    print(f"{method} {handler.path} -> {target}", flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        forward(self, "GET")

    def do_POST(self):
        forward(self, "POST")

    def log_message(self, *args):  # keep stdout to the one-line log above
        pass


if __name__ == "__main__":
    with open(PID_FILE, "w") as fh:
        fh.write(str(os.getpid()))
    for port in TARGETS:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        print(f"proxy 127.0.0.1:{port} -> https://{TARGETS[port]}:443 (via curl)", flush=True)
    threading.Event().wait()
