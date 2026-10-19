"""Control API for the regtest stack (e2e/stack.sh), on 127.0.0.1:7899 only.

Stands in for the borrower's own Zcash wallet and for block production:
  POST /fund {"payments": [{"address": "<unified address>", "zec": 0.01}, ...]}
       regtest: the ths faucet, one payment per address
       testnet: the test wallet (e2e/testnet-wallet.sh), ONE transaction with one output
                per address, as a wallet pays a ZIP 321 request
       ({"address", "zec"} alone is one payment)
  POST /mine {"blocks": 1}  -> ths mine on regtest; nothing on testnet (real miners)
And hosts the parties' key shares, one hypothec-party process per loan and role:
  POST /party {"role": "lender", "loan": "0x<64 hex>"}      -> {"url": "http://127.0.0.1:78xx"}
A party service holds one vault, so each loan gets its own four (fresh identities per loan,
so two loans cannot be linked through their key holders). In the product each role runs
its own host on its own device; the demo runs all four here. Asking again for the same
loan and role returns the same service.
Commands run without a shell, with validated arguments.
"""
import json
import os
import urllib.request
import re
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TESTNET = os.environ.get("ZAFE_NETWORK") == "test"
THS = os.environ.get("THS_BIN", "")
NAME = os.environ.get("ZAFE_REGTEST_NAME", "")
PARTY_BIN = os.environ["PARTY_BIN"]
STATE = os.environ["STACK_STATE"]
ADDRESS = re.compile(r"^%s[02-9ac-hj-np-z]{20,400}$" % ("utest1" if TESTNET else "uregtest1"))
# The test wallet's two key shares (e2e/testnet-wallet.sh).
WALLET = ("http://127.0.0.1:7891", "http://127.0.0.1:7892")
ROLES = {"borrower", "lender", "refereeA", "refereeB"}
LOAN = re.compile(r"^0x[0-9a-f]{64}$")
FIRST_PORT = 7810

parties = {}  # (loan, role) -> port
lock = threading.Lock()


def port_open(port):
    with socket.socket() as s:
        s.settimeout(0.2)
        return s.connect_ex(("127.0.0.1", port)) == 0


def party(loan, role):
    with lock:
        if (loan, role) in parties:
            return parties[(loan, role)]
        port = FIRST_PORT + len(parties)
        home = os.path.join(STATE, "parties", loan[2:18], role)
        os.makedirs(home, exist_ok=True)
        log = open(os.path.join(home, "party.log"), "ab")
        p = subprocess.Popen([PARTY_BIN, "--home", home, "--listen", f"127.0.0.1:{port}"], stdout=log, stderr=log)
        # stack.sh stops these with everything else.
        with open(os.path.join(STATE, "party-pids"), "a") as f:
            f.write(f"{p.pid}\n")
        for _ in range(100):
            if port_open(port):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError(f"party {role} for {loan} did not start")
        parties[(loan, role)] = port
        return port


def party_call(base, method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{path}: {e.read().decode()[:500]}") from None


def pay_from_test_wallet(payments):
    """One spend from the 2-of-2 test wallet, both shares signing, then broadcast."""
    outputs = [{"address": a, "amount_zat": round(z * 1e8)} for a, z in payments]
    spend = party_call(WALLET[0], "POST", "/spends", {"outputs": outputs, "memo": "Hypothec: lock"})["id"]
    for w in WALLET:
        party_call(w, "POST", f"/spends/{spend}/approve")
    return party_call(WALLET[0], "POST", f"/spends/{spend}/send")["txid"]


class Handler(BaseHTTPRequestHandler):
    def _reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        try:
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/party":
                loan, role = str(body.get("loan", "")).lower(), str(body.get("role", ""))
                if not LOAN.match(loan) or role not in ROLES:
                    return self._reply(400, {"error": "need a loan id (0x + 64 hex) and a role"})
                return self._reply(200, {"ok": True, "url": f"http://127.0.0.1:{party(loan, role)}"})
            if self.path == "/fund":
                raw = body["payments"] if "payments" in body else [body]
                payments = [(str(p["address"]), float(p["zec"])) for p in raw]
                if not payments or len(payments) > 8 or any(not ADDRESS.match(a) or not 0 < z <= 5 for a, z in payments):
                    return self._reply(400, {"error": "need 1 to 8 payments, each a unified address on this chain and 0 < zec <= 5"})
                if TESTNET:
                    return self._reply(200, {"ok": True, "txid": pay_from_test_wallet(payments)})
                for a, z in payments[:-1]:
                    r = subprocess.run([THS, "--name", NAME, "faucet", a, "--amount", f"{z:.8f}".rstrip("0").rstrip(".")], capture_output=True, text=True, timeout=120)
                    if r.returncode != 0:
                        return self._reply(500, {"ok": False, "err": r.stderr[-2000:]})
                a, z = payments[-1]
                cmd = [THS, "--name", NAME, "faucet", a, "--amount", f"{z:.8f}".rstrip("0").rstrip(".")]
            elif self.path == "/mine":
                if TESTNET:
                    return self._reply(200, {"ok": True, "out": "testnet: blocks come from real miners"})
                blocks = int(body.get("blocks", 1))
                if not 1 <= blocks <= 200:
                    return self._reply(400, {"error": "1 <= blocks <= 200"})
                cmd = [THS, "--name", NAME, "mine", str(blocks)]
            else:
                return self._reply(404, {"error": "unknown path"})
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            status = 200 if r.returncode == 0 else 500
            self._reply(status, {"ok": r.returncode == 0, "out": r.stdout[-2000:], "err": r.stderr[-2000:]})
        except Exception as e:  # noqa: BLE001 - report any failure to the caller
            self._reply(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


ThreadingHTTPServer(("127.0.0.1", 7899), Handler).serve_forever()
