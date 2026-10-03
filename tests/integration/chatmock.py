"""Slack Web API, Microsoft kimlik (token), Bot Framework OpenID/JWKS, Teams Bot
Connector, Google OAuth + Takvim, Microsoft Graph (takvim) ve Zoom API'sinin sahtesi.
Entegrasyon testleri gerçek hesaplar olmadan uçtan uca çalışsın diye.

Çalıştırma (hr360-net ağında, "chatmock" adıyla):
    docker run -d --name chatmock --network hr360-net -v $PWD/tests/integration:/t \
      python:3.11-slim sh -c "pip install -q cryptography pyjwt && python -u /t/chatmock.py"

Test yardımcı uçları:
    GET  /_log            alınan tüm çağrılar (JSON)
    POST /_reset          kaydı temizler
    POST /_fail?path=..&count=N   yolu bu metni içeren sonraki N isteğe 500 döner (yeniden deneme testi)
    GET  /_jwt?aud=..&serviceurl=..&expired=0&wrongkey=0   Bot Framework jetonu üretir
Slack kullanıcıları e-postaya göre: ad.soyad@... -> U_AD (büyük harf).
"""

import base64
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KID = "mock-key-1"
LOG = []
FAILS = {}
LOCK = threading.Lock()
EMAILS = {}  # slack user id -> email
SEQ = [0]
EVENTS = {}  # takvim etkinlikleri: id -> gövde
SHORT = {"ayse": "ayse.yilmaz", "mehmet": "mehmet.demir", "zeynep": "zeynep.kaya"}


def user_of_token(auth: str) -> str:
    # "Bearer gtok-ayse" / "Bearer mstok-mehmet" -> ayse.yilmaz@demo.hr360
    short = (auth or "").split("-", 1)[-1]
    return SHORT.get(short, short) + "@demo.hr360"


def next_id(prefix):
    SEQ[0] += 1
    return f"{prefix}-{SEQ[0]}"


def b64u(n: int) -> str:
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def jwks():
    pub = KEY.public_key().public_numbers()
    return {"keys": [{"kty": "RSA", "use": "sig", "kid": KID, "alg": "RS256", "n": b64u(pub.n), "e": b64u(pub.e),
                      "endorsements": ["msteams"]}]}


def slack_user_for(email: str) -> str:
    uid = "U_" + email.split("@")[0].split(".")[0].upper()
    EMAILS[uid] = email
    return uid


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # sessiz
        pass

    def _send(self, code, obj=None):
        body = b"" if obj is None else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        # .NET JsonContent / PostAsJsonAsync gövdeyi "chunked" gönderir.
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            out = b""
            while True:
                size = int(self.rfile.readline().strip().split(b";")[0], 16)
                if size == 0:
                    self.rfile.readline()
                    break
                out += self.rfile.read(size)
                self.rfile.readline()
            return out.decode()
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n).decode() if n else ""

    def _record(self, body):
        with LOCK:
            LOG.append({"method": self.command, "path": unquote(self.path), "auth": self.headers.get("Authorization"),
                        "body": body, "at": time.time()})

    # ------------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/_log":
            with LOCK:
                return self._send(200, LOG)
        if u.path == "/botframework/openid":
            return self._send(200, {"issuer": "https://api.botframework.com",
                                    "jwks_uri": "http://chatmock:8000/botframework/jwks",
                                    "id_token_signing_alg_values_supported": ["RS256"]})
        if u.path == "/botframework/jwks":
            return self._send(200, jwks())
        if u.path == "/_jwt":
            now = int(time.time())
            claims = {"iss": "https://api.botframework.com", "aud": q["aud"], "serviceurl": q.get("serviceurl"),
                      "nbf": now - 10, "iat": now - 10, "exp": now - 60 if q.get("expired") == "1" else now + 600}
            key = OTHER_KEY if q.get("wrongkey") == "1" else KEY
            tok = jwt.encode(claims, key, algorithm="RS256", headers={"kid": KID})
            return self._send(200, {"token": tok})
        if u.path == "/googleapis/oauth2/v3/userinfo":
            self._record("")
            return self._send(200, {"email": user_of_token(self.headers.get("Authorization"))})
        if u.path == "/graph/v1.0/me":
            self._record("")
            return self._send(200, {"mail": user_of_token(self.headers.get("Authorization")), "userPrincipalName": "x"})
        if u.path == "/google/auth" or u.path.endswith("/oauth2/v2.0/authorize"):
            return self._send(200, {"note": "test: authorize"})
        if "/v3/conversations/" in u.path and "/members/" in u.path:
            self._record("")
            uid = unquote(u.path.rsplit("/", 1)[1])
            # Teams kullanıcı kimliği "29:<e-posta yerel kısmı>" biçiminde verilir (testte).
            local = uid.split(":", 1)[-1]
            return self._send(200, {"id": uid, "name": local, "email": f"{local}@demo.hr360",
                                    "userPrincipalName": f"{local}@demo.hr360", "aadObjectId": str(uuid.uuid5(uuid.NAMESPACE_DNS, local))})
        self._send(404, {"error": "not_found"})

    # ------------------------------------------------------------------ POST
    def do_POST(self):
        body = self._body()
        self._record(body)
        u = urlparse(self.path)
        if u.path == "/_reset":
            with LOCK:
                LOG.clear()
                FAILS.clear()
            return self._send(200, {"ok": True})
        if u.path == "/_fail":
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            with LOCK:
                FAILS[q["path"]] = int(q.get("count", "1"))
            return self._send(200, {"ok": True})
        with LOCK:
            hit = next((k for k, n in FAILS.items() if n > 0 and k in u.path), None)
            if hit:
                FAILS[hit] -= 1
        if hit:
            return self._send(500, {"ok": False, "error": "injected_failure"})
        if u.path.endswith("/oauth2/v2.0/token") or u.path == "/google/token":
            f = {k: v[0] for k, v in parse_qs(body).items()}
            if f.get("client_secret") == "wrong":
                return self._send(401, {"error": "invalid_client", "error_description": "AADSTS7000215: Invalid client secret provided."})
            google = u.path == "/google/token"
            pre = "g" if google else "ms"
            grant = f.get("grant_type")
            if grant == "client_credentials":
                return self._send(200, {"token_type": "Bearer", "expires_in": 3599, "access_token": "teams-bot-token"})
            if grant == "authorization_code":
                if not f.get("code_verifier"):
                    return self._send(400, {"error": "invalid_request", "error_description": "PKCE code_verifier eksik"})
                who = f["code"].split("-", 1)[-1]
                return self._send(200, {"access_token": f"{pre}tok-{who}", "refresh_token": f"{pre}refresh-{who}", "expires_in": 3600})
            if grant == "refresh_token":
                if f["refresh_token"].endswith("revoked"):
                    return self._send(400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
                who = f["refresh_token"].split("-", 1)[-1]
                return self._send(200, {"access_token": f"{pre}tok-{who}", "expires_in": 3600})
            return self._send(400, {"error": "unsupported_grant_type"})
        if u.path == "/anthropic/v1/messages":
            q = json.loads(body)
            if self.headers.get("x-api-key") != "test" or not self.headers.get("anthropic-version"):
                return self._send(401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
            user = q["messages"][0]["content"]
            text = f"MOCK-LLM[{q['model']}] Çalışan için yanıt. Girdi: {user[:120]}"
            return self._send(200, {"type": "message", "role": "assistant", "model": q["model"],
                                    "content": [{"type": "text", "text": text}], "usage": {"input_tokens": len(user) // 4, "output_tokens": 42}})
        if u.path == "/openai/v1/chat/completions":
            q = json.loads(body)
            user = q["messages"][-1]["content"]
            return self._send(200, {"choices": [{"message": {"role": "assistant", "content": f"MOCK-OPENAI {user[:80]}"}}],
                                    "usage": {"prompt_tokens": 10, "completion_tokens": 5}})
        if u.path == "/zoom/oauth/token":
            auth = base64.b64decode((self.headers.get("Authorization") or "Basic Og==")[6:]).decode()
            if not auth.endswith(":zsecret"):
                return self._send(401, {"reason": "Invalid client_id or client_secret", "error": "invalid_client"})
            return self._send(200, {"access_token": "zoom-token", "expires_in": 3599})
        if u.path.startswith("/zoomapi/v2/users/") and u.path.endswith("/meetings"):
            user = unquote(u.path.split("/")[4])
            if user.startswith("zeynep"):
                return self._send(404, {"code": 1001, "message": "User does not exist."})
            mid = 83100000000 + SEQ[0]
            SEQ[0] += 1
            return self._send(201, {"id": mid, "join_url": f"https://zoom.us/j/{mid}?pwd=test", "host_email": user})
        if u.path == "/googleapis/calendar/v3/calendars/primary/events":
            ev = json.loads(body)
            eid = next_id("gev")
            EVENTS[eid] = ev
            out = {"id": eid, "htmlLink": f"https://calendar.google.com/event?eid={eid}"}
            if ev.get("conferenceData"):
                out["hangoutLink"] = f"https://meet.google.com/abc-{eid}"
            return self._send(200, out)
        if u.path == "/graph/v1.0/me/events":
            ev = json.loads(body)
            eid = next_id("msev")
            EVENTS[eid] = ev
            out = {"id": eid, "webLink": f"https://outlook.office.com/calendar/item/{eid}"}
            if ev.get("isOnlineMeeting"):
                out["onlineMeeting"] = {"joinUrl": f"https://teams.microsoft.com/l/meetup-join/{eid}"}
            return self._send(201, out)
        if u.path == "/googleapis/calendar/v3/freeBusy":
            q = json.loads(body)
            day = q["timeMin"][:10]
            return self._send(200, {"calendars": {"primary": {"busy": [{"start": f"{day}T07:00:00Z", "end": f"{day}T08:00:00Z"}]}}})
        if u.path == "/graph/v1.0/me/calendar/getSchedule":
            q = json.loads(body)
            day = q["startTime"]["dateTime"][:10]
            return self._send(200, {"value": [{"scheduleItems": [{"status": "busy", "start": {"dateTime": f"{day}T08:00:00.0000000"}, "end": {"dateTime": f"{day}T09:00:00.0000000"}},
                                                                 {"status": "free", "start": {"dateTime": f"{day}T12:00:00"}, "end": {"dateTime": f"{day}T13:00:00"}}]}]})
        if u.path.startswith("/api/"):
            return self._slack(u.path[5:], {k: v[0] for k, v in parse_qs(body).items()})
        if u.path.startswith("/slack-response/"):
            return self._send(200, {"ok": True})
        if "/v3/conversations/" in u.path and u.path.endswith("/activities"):
            SEQ[0] += 1
            return self._send(201, {"id": f"act-{SEQ[0]}"})
        if "/v3/conversations/" in u.path and "/activities/" in u.path:
            return self._send(200, {"id": u.path.rsplit("/", 1)[1]})
        self._send(404, {"error": "not_found"})

    def do_DELETE(self):
        self._record("")
        u = urlparse(self.path)
        if u.path.startswith("/googleapis/calendar/v3/calendars/primary/events/") or u.path.startswith("/graph/v1.0/me/events/"):
            eid = unquote(u.path.rsplit("/", 1)[1])
            return self._send(204 if EVENTS.pop(eid, None) is not None else 404)
        if u.path.startswith("/zoomapi/v2/meetings/"):
            return self._send(204)
        self._send(404, {})

    def do_PUT(self):
        body = self._body()
        self._record(body)
        if "/v3/conversations/" in self.path:
            return self._send(200, {"id": self.path.rsplit("/", 1)[1]})
        self._send(404, {})

    def _slack(self, method, f):
        auth = self.headers.get("Authorization", "")
        if auth != "Bearer xoxb-test-token":
            return self._send(200, {"ok": False, "error": "invalid_auth"})
        if method == "auth.test":
            return self._send(200, {"ok": True, "team_id": "T_DEMO", "team": "Demo Workspace", "user_id": "U_BOT"})
        if method == "users.lookupByEmail":
            email = f.get("email", "")
            if email.endswith("@demo.hr360"):
                return self._send(200, {"ok": True, "user": {"id": slack_user_for(email)}})
            return self._send(200, {"ok": False, "error": "users_not_found"})
        if method == "users.info":
            uid = f["user"]
            email = EMAILS.get(uid) or f"{uid[2:].lower()}.x@demo.hr360"
            return self._send(200, {"ok": True, "user": {"id": uid, "name": uid.lower(), "profile": {"email": email, "real_name": uid}}})
        if method == "conversations.open":
            return self._send(200, {"ok": True, "channel": {"id": "D_" + f["users"]}})
        if method == "chat.postMessage":
            SEQ[0] += 1
            return self._send(200, {"ok": True, "channel": f["channel"], "ts": f"1700000000.{SEQ[0]:06d}"})
        if method == "chat.update":
            return self._send(200, {"ok": True, "channel": f["channel"], "ts": f["ts"]})
        if method == "views.open":
            if not f.get("trigger_id"):
                return self._send(200, {"ok": False, "error": "invalid_trigger_id"})
            return self._send(200, {"ok": True, "view": {"id": "V_" + f["trigger_id"]}})
        if method == "views.publish":
            return self._send(200, {"ok": True, "view": {"id": "V_HOME_" + f.get("user_id", "")}})
        self._send(200, {"ok": False, "error": "unknown_method"})


if __name__ == "__main__":
    # Bilinen test kullanıcıları önceden kaydedilir (users.info e-postası için).
    for e in ("mehmet.demir@demo.hr360", "ayse.yilmaz@demo.hr360", "zeynep.kaya@demo.hr360"):
        slack_user_for(e)
    print("chatmock :8000", flush=True)
    ThreadingHTTPServer(("", 8000), H).serve_forever()
