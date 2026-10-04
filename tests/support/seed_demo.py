"""Temiz kurulumda (install.sh) demo şirketine test verisini ürünün kendi API'leriyle oluşturur.

Repo seed verisi içermez. install.sh demo.admin ve platform.admin'i, tenant-service ise ilk
açılışta "demo" şirketini (Keycloak organizasyonu + şirket kaydı) oluşturur. Bu betik üstüne:

  - demo.admin'e hr-admin rolü (İK + şirket yöneticisi), şirkete çalışan kotası
  - Mühendislik departmanı; Mehmet Demir (yönetici, departman başı), Ayşe Yılmaz (çalışan,
    "Yazılım Mühendisi"), Zeynep Kaya (departmansız, giriş hesabı yok)
  - Ayşe ve Mehmet için davet (Keycloak hesabı + organizasyon üyeliği), kalıcı parola
  - Maaş kayıtları, yıllık izin bakiyesi, Ayşe'nin bir yıllık izin talebi, resmî tatiller, örnek masalar, örnek bilgi bankası makaleleri
  - tests/credentials.json (yoksa; parolalar rastgele üretilir, ekrana basılmaz)

Tekrar çalıştırılabilir: var olan kayıtlar yeniden oluşturulmaz. Sonda testlerdeki sabit
kimliklerin bu ortamdaki değerlerini yazar (tests/integration/common.py'ye işlenir).

Kullanım: python3 tests/support/seed_demo.py   (proje kökünden, kurulum çalışırken)
"""

import datetime as dt
import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CRED = ROOT / "tests" / "credentials.json"
sys.path.insert(0, str(Path(__file__).resolve().parent))


def env():
    out = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def ensure_credentials():
    if CRED.exists():
        return json.loads(CRED.read_text())
    e = env()
    creds = {
        "admin": ["demo.admin", e["DEMO_ADMIN_PASSWORD"]],
        "platform": ["platform.admin", e["PLATFORM_ADMIN_PASSWORD"]],
        "mehmet": ["mehmet.demir@demo.hr360", "Hr360-" + secrets.token_urlsafe(12)],
        "ayse": ["ayse.yilmaz@demo.hr360", "Hr360-" + secrets.token_urlsafe(12)],
    }
    CRED.write_text(json.dumps(creds, indent=2) + "\n")
    os.chmod(CRED, 0o600)
    print("tests/credentials.json yazıldı")
    return creds


CREDS = ensure_credentials()
import hr360_login as login  # noqa: E402  (credentials.json'dan sonra)


def drop_token(who):
    Path(f"/tmp/hr360-tok-{who}.json").unlink(missing_ok=True)


def api(who, method, path, body=None, ok=(200, 201, 204)):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(login.BASE_URL + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + login.token(who), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            code, txt = r.status, r.read().decode()
    except urllib.error.HTTPError as ex:
        code, txt = ex.code, ex.read().decode()
    try:
        res = json.loads(txt) if txt else None
    except ValueError:
        res = txt
    if ok and code not in ok:
        raise SystemExit(f"{method} {path} -> {code}: {str(res)[:300]}")
    return code, res


def psql(sql, db="hr360_operational"):
    out = subprocess.run(["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "hr360admin", "-d", db, "-Atc", sql],
                         capture_output=True, text=True, cwd=ROOT)
    return out.stdout.strip()


def kcadm(*args, check=True):
    script = ('/opt/keycloak/bin/kcadm.sh config credentials --config /tmp/kc-seed.cfg --server http://localhost:8080/auth '
              '--realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1 && '
              '/opt/keycloak/bin/kcadm.sh "$@" --config /tmp/kc-seed.cfg -r hr360')
    out = subprocess.run(["docker", "exec", "hr360-keycloak-1", "sh", "-c", script, "kcadm", *args], capture_output=True, text=True)
    if check and out.returncode != 0:
        raise SystemExit(f"kcadm {args[0]} {args[1] if len(args) > 1 else ''}: {out.stderr.strip()[:300]}")
    return out.stdout


def kc_user_id(username):
    return json.loads(kcadm("get", "users", "-q", f"username={username}", "-q", "exact=true", "--fields", "id") or "[]")[0]["id"]


today = dt.date.today()
year = today.year

# --- Şirket: kota ve rol --------------------------------------------------------------------
_, tenants = api("platform", "GET", "/api/tenant/tenants")
items = tenants.get("items", tenants) if isinstance(tenants, dict) else tenants
demo = next(t for t in items if t.get("slug") == "demo")
if (demo.get("maxEmployees") or 0) < 500:
    api("platform", "POST", f"/api/tenant/tenants/{demo['id']}/plan", {"plan": "Enterprise", "maxEmployees": 500})
    print("demo: Enterprise, 500 çalışan")

admin_kc = kc_user_id("demo.admin")
roles = kcadm("get-roles", "--uid", admin_kc, "--effective", "--fields", "name")
if '"hr-admin"' not in roles:
    kcadm("add-roles", "--uid", admin_kc, "--rolename", "hr-admin")
    drop_token("admin")
    print("demo.admin: hr-admin rolü eklendi")

# --- Departman ------------------------------------------------------------------------------
_, companies = api("admin", "GET", "/api/organization/companies")
company_id = (companies.get("items", companies) if isinstance(companies, dict) else companies)[0]["id"]
eng = psql("""SELECT "Id" FROM organization_departments WHERE "TenantSlug"='demo' AND "Name"='Mühendislik' LIMIT 1""")
if not eng:
    _, d = api("admin", "POST", "/api/organization/departments", {"name": "Mühendislik", "companyId": company_id, "parentDepartmentId": None})
    eng = d["id"]
    print("Mühendislik departmanı oluşturuldu")

# --- Çalışanlar -----------------------------------------------------------------------------
PEOPLE = [
    ("mehmet", "Mehmet", "Demir", "mehmet.demir@demo.hr360", "2019-03-01", "Mühendislik Müdürü"),
    ("ayse", "Ayşe", "Yılmaz", "ayse.yilmaz@demo.hr360", "2022-09-12", "Yazılım Mühendisi"),
    ("zeynep", "Zeynep", "Kaya", "zeynep.kaya@demo.hr360", "2023-02-06", None),
]
ids = {}
for key, first, last, email, hired, title in PEOPLE:
    eid = psql(f"""SELECT "Id" FROM employee_employees WHERE "TenantSlug"='demo' AND "Email"='{email}' LIMIT 1""")
    if not eid:
        _, e = api("admin", "POST", "/api/employee/employees",
                   {"firstName": first, "lastName": last, "email": email, "phone": None, "hireDate": hired})
        eid = e["id"]
        print(f"çalışan oluşturuldu: {first} {last}")
    ids[key] = eid
    if title and not psql(f"""SELECT 1 FROM employee_assignments WHERE "EmployeeId"='{eid}' AND "EffectiveTo" IS NULL"""):
        api("admin", "POST", f"/api/employee/employees/{eid}/assignments",
            {"departmentId": eng, "positionTitle": title, "effectiveFrom": hired})

if psql(f"""SELECT "HeadEmployeeId" FROM organization_departments WHERE "Id"='{eng}'""") != ids["mehmet"]:
    api("admin", "PUT", f"/api/organization/departments/{eng}", {"name": "Mühendislik", "headEmployeeId": ids["mehmet"]})
    print("Mühendislik başı: Mehmet")

# --- Giriş hesapları (davet) ------------------------------------------------------------------
kc = {}
for key in ("mehmet", "ayse"):
    username, password = CREDS[key]
    _, r = api("admin", "POST", f"/api/tenant/my-tenant/members/{ids[key]}/invite")
    kc[key] = r["keycloakUserId"]
    kcadm("update", f"users/{kc[key]}", "-s", "emailVerified=true", "-s", "requiredActions=[]")
    kcadm("set-password", "--userid", kc[key], "--new-password", password)
    drop_token(key)
kcadm("add-roles", "--uid", kc["mehmet"], "--rolename", "manager")

# --- Maaş, izin, tatil, masa ----------------------------------------------------------------
for key, salary in (("ayse", 85000), ("mehmet", 140000)):
    if not psql(f"""SELECT 1 FROM compensation_records WHERE "EmployeeId"='{ids[key]}' AND "EffectiveTo" IS NULL"""):
        api("admin", "POST", "/api/compensation/compensation/records",
            {"employeeId": ids[key], "baseSalary": salary, "currency": "TRY", "grade": None, "reason": "Hire",
             "effectiveFrom": f"{year}-01-01", "note": "demo"})
for key in ("ayse", "mehmet"):
    api("admin", "POST", "/api/leave/leave-balances", {"employeeId": ids[key], "year": year, "type": "Annual", "entitledDays": 14})
for y in (year, year + 1):
    api("admin", "POST", f"/api/leave/public-holidays/seed-tr?year={y}", ok=None)
if not psql(f"""SELECT 1 FROM leave_requests WHERE "EmployeeId"='{ids['ayse']}' AND "Type"='Annual' LIMIT 1"""):
    start = today + dt.timedelta(days=60)
    while start.weekday() != 0:
        start += dt.timedelta(days=1)
    api("ayse", "POST", "/api/leave/leave-requests",
        {"employeeId": ids["ayse"], "type": "Annual", "startDate": start.isoformat(),
         "endDate": (start + dt.timedelta(days=1)).isoformat(), "days": 2, "reason": "demo", "workflowRequestId": None})
    print("Ayşe: yıllık izin talebi")
if not psql("""SELECT 1 FROM engagement_desks WHERE "TenantSlug"='demo' AND "IsActive" LIMIT 1"""):
    api("admin", "POST", "/api/engagement/workplace/desks/sample")
# İK asistanı örnek bilgi bankası makaleleri (ör. "Uzaktan çalışma"); var olanlar atlanır.
api("admin", "POST", "/api/governance/insights/kb/samples")

print(json.dumps({"AYSE": ids["ayse"], "MEHMET": ids["mehmet"], "ZEYNEP": ids["zeynep"], "ENG": eng, "AYSE_KC": kc["ayse"]}))
