"""Slack uygulaması ve Microsoft Teams botu uçtan uca testi (sahte Slack/Teams ile).

Ön koşullar:
  * HR360 çalışıyor; governance-service deploy/testing/chat-mock.yml ile başlatıldı
  * chatmock konteyneri hr360-net'te (bkz. chatmock.py)
  * tests/credentials.json ya da HR360_TEST_USERS (jetonlar tarayıcıyla otomatik alınır)
Çalıştırma: python3 tests/integration/test_chat.py
"""

import hashlib
import hmac
import json
import sys
import time
import urllib.parse
import urllib.request
import uuid

from common import AYSE, BASE, FAIL, api, check, http, mock, mock_calls, tok, wait_for  # noqa: E402

G = "/api/governance"
SIGNING = "slack-signing-secret"


def slack_post(app_id, kind, form=None, raw=None, secret=SIGNING, ts=None):
    body = raw if raw is not None else urllib.parse.urlencode(form)
    ts = str(ts or int(time.time()))
    sig = "v0=" + hmac.new(secret.encode(), f"v0:{ts}:{body}".encode(), hashlib.sha256).hexdigest()
    ctype = "application/json" if raw is not None else "application/x-www-form-urlencoded"
    return http("POST", f"{G}/chat/slack/{app_id}/{kind}", raw_body=body,
                headers={"X-Slack-Request-Timestamp": ts, "X-Slack-Signature": sig, "Content-Type": ctype})


RUN_WEEK = __import__("random").randint(0, 150)


def new_leave(day, reason):
    # Ücretsiz izin (bakiye kontrolü yok). Tarihler her çalıştırmada farklı bir haftaya
    # düşer ki önceki çalıştırmaların izinleriyle çakışmasın (Pzt + day%3 gün).
    import datetime as _dt
    start = (_dt.date(2028, 1, 3) + _dt.timedelta(weeks=RUN_WEEK, days=day % 3)).isoformat()
    code, r = api("ayse", "POST", "/api/leave/leave-requests",
                  {"employeeId": AYSE, "type": "Unpaid", "startDate": start, "endDate": start, "days": 0, "reason": reason})
    check(f"izin talebi oluşturuldu ({reason})", code in (200, 201), r)
    return r["workflowRequestId"]


def wf_status(wf):
    return api("ayse", "GET", f"/api/workflow/workflows/{wf}")[1]


# ====================================================================== SLACK
mock("/_reset", "POST")
code, apps = api("admin", "GET", f"{G}/chat-apps")
for a in apps or []:
    api("admin", "DELETE", f"{G}/chat-apps/{a['id']}")

code, r = api("admin", "POST", f"{G}/chat-apps", {"platform": "Slack", "name": "HR360 Slack", "isEnabled": True, "notifyApprovals": True,
                                                   "notifyRequesters": True, "slackBotToken": "xoxb-wrong", "slackSigningSecret": SIGNING})
check("Slack: geçersiz jeton reddedilir", code == 400 and "invalid_auth" in json.dumps(r, ensure_ascii=False), r)
code, r = api("admin", "POST", f"{G}/chat-apps", {"platform": "Slack", "name": "HR360 Slack", "isEnabled": True, "notifyApprovals": True,
                                                   "notifyRequesters": True, "slackBotToken": "xoxb-test-token", "slackSigningSecret": SIGNING})
check("Slack uygulaması eklendi (auth.test)", code == 200 and r.get("slackTeamName") == "Demo Workspace", r)
slack_id = r["id"]
check("yanıtta sır yok", "xoxb" not in json.dumps(r) and SIGNING not in json.dumps(r), r)
code, man = api("admin", "GET", f"{G}/chat-apps/{slack_id}/slack-manifest")
check("Slack manifesti", code == 200 and man["settings"]["interactivity"]["request_url"].endswith(f"/chat/slack/{slack_id}/interactions"), man)

# imza
code, _ = slack_post(slack_id, "commands", {"user_id": "U_AYSE", "text": "bakiye"}, secret="yanlis")
check("Slack: yanlış imza 401", code == 401, code)
code, _ = slack_post(slack_id, "commands", {"user_id": "U_AYSE", "text": "bakiye"}, ts=int(time.time()) - 900)
check("Slack: eski zaman damgası 401", code == 401, code)

# komutlar
code, r = slack_post(slack_id, "commands", {"user_id": "U_AYSE", "text": "bakiye"})
check("Slack /hr360 bakiye", code == 200 and "izin bakiyeniz" in r["text"], r)
code, r = slack_post(slack_id, "commands", {"user_id": "U_AYSE", "text": "ben"})
check("Slack /hr360 ben (eşleşme)", code == 200 and "Ayşe" in r["text"], r)
code, r = slack_post(slack_id, "commands", {"user_id": "U_BILINMEYEN", "text": "bakiye"})
check("Slack: eşleşmeyen kullanıcı uyarılır", code == 200 and "eşleşmedi" in r["text"], r)
code, r = slack_post(slack_id, "commands", {"user_id": "U_AYSE", "text": "saçma"})
check("Slack: bilinmeyen komut yardım gösterir", code == 200 and "Komutlar" in r["text"], r)
code, r = slack_post(slack_id, "events", raw=json.dumps({"type": "url_verification", "challenge": "abc123"}))
check("Slack Events URL doğrulaması", code == 200 and r.get("challenge") == "abc123", r)

# onay akışı
t0 = time.time()
wf = new_leave(12, "slack-onay-testi")
posts = wait_for("/api/chat.postMessage", lambda c: "D_U_MEHMET" in c["body"] and wf in urllib.parse.unquote_plus(c["body"]), t0)
check("Slack: onaycıya düğmeli DM gitti", bool(posts), mock_calls("/api/", t0))
if posts:
    msg = urllib.parse.parse_qs(posts[0]["body"])
    blocks = json.loads(msg["blocks"][0])
    acts = [e for b in blocks if b["type"] == "actions" for e in b["elements"]]
    check("Slack: Onayla/Reddet/HR360'ta aç düğmeleri", {e.get("action_id") for e in acts} >= {"hr360_approve", "hr360_reject", "hr360_open"}, acts)
    value = next(e["value"] for e in acts if e["action_id"] == "hr360_approve")
    ts = msg.get("ts", ["1700000000.000001"])[0]

    # yanlış kişi (Ayşe kendi talebine basar) -> reddedilir
    t1 = time.time()
    payload = {"type": "block_actions", "user": {"id": "U_AYSE"}, "actions": [{"action_id": "hr360_approve", "value": value}],
               "response_url": "http://chatmock:8000/slack-response/1", "channel": {"id": "D_U_MEHMET"}}
    code, _ = slack_post(slack_id, "interactions", {"payload": json.dumps(payload)})
    check("Slack: etkileşim 200", code == 200, code)
    resp = wait_for("/slack-response/1", since=t1)
    check("Slack: kendi talebini onaylayamaz (uyarı)", bool(resp) and "onaylayamazsınız" in json.loads(resp[0]["body"])["text"], resp)
    check("Slack: talep hâlâ bekliyor", wf_status(wf)["status"] == "Pending")

    # doğru kişi onaylar
    t2 = time.time()
    payload["user"]["id"] = "U_MEHMET"
    payload["response_url"] = "http://chatmock:8000/slack-response/2"
    code, _ = slack_post(slack_id, "interactions", {"payload": json.dumps(payload)})
    upd = wait_for("/api/chat.update", lambda c: "Onayladınız" in urllib.parse.unquote_plus(c["body"]), t2)
    check("Slack: mesaj 'Onayladınız' olarak güncellendi (düğmeler kalktı)", bool(upd) and "hr360_approve" not in urllib.parse.unquote_plus(upd[0]["body"]), upd)
    time.sleep(2)
    st = wf_status(wf)
    check("Slack: iş akışı onaylandı", st["status"] == "Approved", st.get("status"))
    check("Slack: karar notu kanalı belirtir", any("Slack" in (s.get("comment") or "") for s in st["steps"]), st["steps"])
    req_dm = wait_for("/api/chat.postMessage", lambda c: "D_U_AYSE" in c["body"] and "onaylandı" in urllib.parse.unquote_plus(c["body"]), t2)
    check("Slack: talep sahibine 'onaylandı' DM'i", bool(req_dm), mock_calls("chat.postMessage", t2))

    # ikinci tıklama -> zaten karara bağlanmış
    t3 = time.time()
    payload["response_url"] = "http://chatmock:8000/slack-response/3"
    slack_post(slack_id, "interactions", {"payload": json.dumps(payload)})
    resp = wait_for("/slack-response/3", since=t3)
    check("Slack: tekrar tıklama 'zaten karara bağlanmış'", bool(resp) and "karara" in json.loads(resp[0]["body"])["text"], resp)

# onaylarım komutu düğmeli liste verir; buradan reddedilir
wf2 = new_leave(13, "slack-komuttan-red")
time.sleep(4)
code, r = slack_post(slack_id, "commands", {"user_id": "U_MEHMET", "text": "onaylarım"})
btns = [e for b in (r or {}).get("blocks", []) if b.get("type") == "actions" for e in b["elements"] if e.get("action_id") == "hr360_reject"]
check("Slack /hr360 onaylarım düğmeli liste", code == 200 and any(wf2 in e["value"] for e in btns), r)
val = next((e["value"] for e in btns if wf2 in e["value"]), None)
if val:
    t4 = time.time()
    payload = {"type": "block_actions", "user": {"id": "U_MEHMET"}, "actions": [{"action_id": "hr360_reject", "value": val}],
               "response_url": "http://chatmock:8000/slack-response/4"}
    slack_post(slack_id, "interactions", {"payload": json.dumps(payload)})
    time.sleep(4)
    check("Slack: komuttan reddedildi", wf_status(wf2)["status"] == "Rejected")
    rej = wait_for("/api/chat.postMessage", lambda c: "D_U_AYSE" in c["body"] and "reddedildi" in urllib.parse.unquote_plus(c["body"]), t4)
    check("Slack: talep sahibine 'reddedildi' DM'i", bool(rej))

code, ids = api("admin", "GET", f"{G}/chat-apps/{slack_id}/identities")
check("Slack: eşleşen kullanıcılar listelenir", code == 200 and {i.get("employeeName") for i in ids} >= {"Mehmet Demir", "Ayşe Yılmaz"}, ids)
api("admin", "PUT", f"{G}/chat-apps/{slack_id}", {"platform": "Slack", "name": "HR360 Slack", "isEnabled": False, "notifyApprovals": True,
                                                  "notifyRequesters": True})
code, _ = slack_post(slack_id, "commands", {"user_id": "U_AYSE", "text": "bakiye"})
check("Slack: devre dışı uygulama 401", code == 401, code)

# ====================================================================== TEAMS
APP = str(uuid.uuid4())
MSTENANT = str(uuid.uuid4())
SVC = "http://chatmock:8000/teams/"
code, r = api("admin", "POST", f"{G}/chat-apps", {"platform": "Teams", "name": "HR360 Teams", "isEnabled": True, "notifyApprovals": True,
                                                   "notifyRequesters": True, "teamsAppId": APP, "teamsAppPassword": "wrong", "teamsAzureTenantId": MSTENANT})
check("Teams: yanlış gizli anahtar reddedilir", code == 400 and "Invalid client secret" in json.dumps(r, ensure_ascii=False), r)
code, r = api("admin", "POST", f"{G}/chat-apps", {"platform": "Teams", "name": "HR360 Teams", "isEnabled": True, "notifyApprovals": True,
                                                   "notifyRequesters": True, "teamsAppId": APP, "teamsAppPassword": "s3cret", "teamsAzureTenantId": MSTENANT})
check("Teams botu eklendi", code == 200 and r["endpoints"]["messaging"].endswith(f"/chat/teams/{r['id']}/messages"), r)
teams_id = r["id"]
req = urllib.request.Request(BASE + f"{G}/chat-apps/{teams_id}/teams-package", headers={"Authorization": "Bearer " + tok("admin")})
with urllib.request.urlopen(req) as resp:
    pkg = resp.read()
import io, zipfile  # noqa: E402
z = zipfile.ZipFile(io.BytesIO(pkg))
man = json.loads(z.read("manifest.json"))
check("Teams paketi (manifest + simgeler)", set(z.namelist()) == {"manifest.json", "color.png", "outline.png"} and man["bots"][0]["botId"] == APP
      and z.read("color.png")[:4] == b"\x89PNG", z.namelist())


def teams_post(activity, aud=APP, serviceurl=SVC, **jwt_opts):
    q = urllib.parse.urlencode({"aud": aud, "serviceurl": serviceurl, **jwt_opts})
    token = mock(f"/_jwt?{q}")["token"]
    return http("POST", f"{G}/chat/teams/{teams_id}/messages", activity, {"Authorization": "Bearer " + token})


def act(user, text=None, value=None, typ="message", reply_to=None, tenant=MSTENANT, conv=None):
    a = {"type": typ, "id": "in-" + uuid.uuid4().hex[:6], "serviceUrl": SVC, "channelId": "msteams",
         "from": {"id": f"29:{user}", "name": user}, "recipient": {"id": f"28:{APP}", "name": "HR360"},
         "conversation": {"id": conv or f"a:conv-{user}", "conversationType": "personal", "tenantId": tenant}}
    if text is not None:
        a["text"] = text
    if value is not None:
        a["value"] = value
    if reply_to:
        a["replyToId"] = reply_to
    if typ == "conversationUpdate":
        a["membersAdded"] = [{"id": f"28:{APP}"}]
    return a


code, _ = http("POST", f"{G}/chat/teams/{teams_id}/messages", act("mehmet.demir", "bakiye"), {"Authorization": "Bearer x.y.z"})
check("Teams: geçersiz jeton 401", code == 401, code)
code, _ = teams_post(act("mehmet.demir", "bakiye"), wrongkey="1")
check("Teams: yanlış anahtarla imzalı jeton 401", code == 401, code)
code, _ = teams_post(act("mehmet.demir", "bakiye"), aud=str(uuid.uuid4()))
check("Teams: farklı hedef kitle (aud) 401", code == 401, code)
code, _ = teams_post(act("mehmet.demir", "bakiye"), expired="1")
check("Teams: süresi dolmuş jeton 401", code == 401, code)
code, _ = teams_post(act("mehmet.demir", "bakiye"), serviceurl="http://evil.example/")
check("Teams: serviceUrl uyuşmazlığı 401", code == 401, code)
code, _ = teams_post(act("mehmet.demir", "bakiye", tenant=str(uuid.uuid4())))
check("Teams: başka Microsoft 365 kiracısı 403", code == 403, code)

t5 = time.time()
for u in ("mehmet.demir", "ayse.yilmaz"):
    code, _ = teams_post(act(u, typ="conversationUpdate"))
    check(f"Teams: {u} botu ekledi", code == 200, code)
welcome = wait_for("/teams/v3/conversations/a:conv-mehmet.demir/activities", since=t5)
check("Teams: hoş geldin mesajı", bool(welcome) and "Onay talepleriniz" in welcome[0]["body"], welcome)
check("Teams: bot jetonuyla gönderim", bool(welcome) and welcome[0]["auth"] == "Bearer teams-bot-token", welcome)

t6 = time.time()
teams_post(act("ayse.yilmaz", "bakiye"))
rep = wait_for("/teams/v3/conversations/a:conv-ayse.yilmaz/activities", since=t6)
check("Teams: 'bakiye' komutu yanıtlandı", bool(rep) and "izin bakiyeniz" in rep[0]["body"], rep)

t7 = time.time()
wf3 = new_leave(14, "teams-red-testi")
card = wait_for("/teams/v3/conversations/a:conv-mehmet.demir/activities", lambda c: wf3 in c["body"], t7)
check("Teams: onaycıya Adaptive Card gitti", bool(card) and "Action.Submit" in card[0]["body"], card)
if card:
    body = json.loads(card[0]["body"])
    data = next(a["data"] for a in body["attachments"][0]["content"]["actions"] if a.get("title") == "Reddet")
    acts_before = [c for c in mock_calls("/activities", t7)]
    card_id = f"act-{len([c for c in mock('/_log') if c['method'] == 'POST' and c['path'].endswith('/activities')])}"
    t8 = time.time()
    code, _ = teams_post(act("mehmet.demir", value=data, reply_to=card_id))
    check("Teams: karar isteği 200", code == 200, code)
    time.sleep(3)
    st = wf_status(wf3)
    check("Teams: iş akışı reddedildi", st["status"] == "Rejected", st.get("status"))
    put = wait_for("/teams/v3/conversations/a:conv-mehmet.demir/activities/", lambda c: c["method"] == "PUT" and "Reddettiniz" in c["body"], t8)
    check("Teams: kart 'Reddettiniz' olarak güncellendi", bool(put) and "Action.Submit" not in put[0]["body"], put)
    dm = wait_for("/teams/v3/conversations/a:conv-ayse.yilmaz/activities", lambda c: "reddedildi" in c["body"], t8)
    check("Teams: talep sahibine 'reddedildi' bildirimi", bool(dm), dm)

code, ids = api("admin", "GET", f"{G}/chat-apps/{teams_id}/identities")
check("Teams: eşleşen kullanıcılar", code == 200 and sum(1 for i in ids if i["employeeId"] and i["canReceive"]) >= 2, ids)

# yetki: çalışan sohbet uygulamalarını yönetemez
code, _ = api("ayse", "GET", f"{G}/chat-apps")
check("Yetki: çalışan sohbet uygulamalarını göremez", code == 403, code)

for a in (slack_id, teams_id):
    api("admin", "DELETE", f"{G}/chat-apps/{a}")
print(f"\nFAILS: {len(FAIL)}")
for f in FAIL:
    print("  -", f)
sys.exit(1 if FAIL else 0)
