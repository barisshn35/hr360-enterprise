#!/usr/bin/env python3
"""Demo ve yönetim parolalarını yeniler (güvenlik dalgası 1).

Parolalar bir yerde açığa çıktığında (sohbet, ekran paylaşımı, e-posta) kullanılır. Yeni parolalar
rastgele üretilir ve EKRANA BASILMAZ; yalnızca şu dosyalara yazılır (hepsi gitignore'da):
  - tests/credentials.json  (demo.admin, platform.admin, Mehmet, Ayşe, Elif)
  - .env                    (DEMO_ADMIN_PASSWORD, PLATFORM_ADMIN_PASSWORD, --keycloak-admin ile KEYCLOAK_ADMIN_PASSWORD)
  - deploy/keycloak/realm-export.json (ilk kurulum içe aktarımı; eski parola kalmasın)

Kullanım:
  python3 scripts/rotate-passwords.py                    # hr360 alanındaki tüm demo kullanıcıları
  python3 scripts/rotate-passwords.py ayse mehmet        # yalnızca seçilenler (credentials.json anahtarları)
  python3 scripts/rotate-passwords.py --keycloak-admin   # Keycloak master yöneticisi de (tenant-service yeniden başlar)
  Test ortamında: COMPOSE_ARGS="-f docker-compose.yml -f deploy/testing/chat-mock.yml --profile ldaptest" python3 ...

Yeni parolayı görmek için: python3 -c "import json;print(json.load(open('tests/credentials.json'))['admin'][1])"
"""
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"
CRED = ROOT / "tests" / "credentials.json"
REALM = ROOT / "deploy" / "keycloak" / "realm-export.json"
ENV_KEYS = {"admin": "DEMO_ADMIN_PASSWORD", "platform": "PLATFORM_ADMIN_PASSWORD"}


def read_env():
    out = {}
    for line in ENV.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def set_env(key, value):
    lines = ENV.read_text().splitlines()
    done = False
    for i, line in enumerate(lines):
        if line.split("=", 1)[0].strip() == key and not line.lstrip().startswith("#"):
            lines[i] = f"{key}={value}"
            done = True
    if not done:
        lines.append(f"{key}={value}")
    ENV.write_text("\n".join(lines) + "\n")
    os.chmod(ENV, 0o600)


def new_password():
    # Keycloak parola politikası: büyük/küçük harf, rakam ve özel karakter garanti edilir.
    return "Hr360-" + secrets.token_urlsafe(15) + "9a"


def kcadm(admin_user, admin_password, realm, *args):
    # Parolalar komut satırında görünmesin diye ortam değişkeniyle aktarılır.
    script = ('/opt/keycloak/bin/kcadm.sh config credentials --config /tmp/kc-rotate.cfg --server http://localhost:8080/auth '
              '--realm master --user "$RU" --password "$RP" >/dev/null 2>&1 || exit 97; '
              f'/opt/keycloak/bin/kcadm.sh "$@" --config /tmp/kc-rotate.cfg -r {realm}; rc=$?; rm -f /tmp/kc-rotate.cfg; exit $rc')
    out = subprocess.run(["docker", "exec", "-e", "RU", "-e", "RP", "hr360-keycloak-1", "sh", "-c", script, "kcadm", *args],
                         capture_output=True, text=True, env={**os.environ, "RU": admin_user, "RP": admin_password})
    if out.returncode == 97:
        raise SystemExit("Keycloak yöneticisiyle oturum açılamadı (.env KEYCLOAK_ADMIN_USER/KEYCLOAK_ADMIN_PASSWORD).")
    if out.returncode != 0:
        raise SystemExit(f"kcadm {args[0]}: {out.stderr.strip()[:300]}")
    return out.stdout


def main(argv):
    rotate_master = "--keycloak-admin" in argv
    wanted = [a for a in argv if not a.startswith("--")]
    env = read_env()
    admin_user, admin_pw = env["KEYCLOAK_ADMIN_USER"], env["KEYCLOAK_ADMIN_PASSWORD"]
    creds = json.loads(CRED.read_text()) if CRED.exists() else {}
    keys = wanted or list(creds)
    unknown = [k for k in keys if k not in creds]
    if unknown:
        raise SystemExit("credentials.json'da yok: " + ", ".join(unknown))

    realm_text = REALM.read_text() if REALM.exists() else None
    for key in keys:
        username, old = creds[key]
        users = json.loads(kcadm(admin_user, admin_pw, "hr360", "get", "users", "-q", f"username={username}", "-q", "exact=true",
                                 "--fields", "id") or "[]")
        if not users:
            print(f"  {key}: Keycloak'ta {username} yok, atlandı")
            continue
        pw = new_password()
        kcadm(admin_user, admin_pw, "hr360", "set-password", "--userid", users[0]["id"], "--new-password", pw)
        creds[key] = [username, pw]
        CRED.write_text(json.dumps(creds, indent=2) + "\n")
        os.chmod(CRED, 0o600)
        if key in ENV_KEYS:
            set_env(ENV_KEYS[key], pw)
        if realm_text and old and json.dumps(old) in realm_text:
            realm_text = realm_text.replace(json.dumps(old), json.dumps(pw))
        Path(f"/tmp/hr360-tok-{key}.json").unlink(missing_ok=True)
        print(f"  {key} ({username}): parola yenilendi")
    if realm_text is not None:
        REALM.write_text(realm_text)

    if rotate_master:
        pw = new_password()
        kcadm(admin_user, admin_pw, "master", "set-password", "--username", admin_user, "--new-password", pw)
        set_env("KEYCLOAK_ADMIN_PASSWORD", pw)
        # tenant-service Keycloak yönetim API'sini bu parolayla kullanır; yeni değerle yeniden oluşturulur.
        # Test ortamında ek compose dosyaları kullanılıyorsa (ör. deploy/testing/chat-mock.yml) COMPOSE_ARGS ile verilir.
        extra = os.environ.get("COMPOSE_ARGS", "").split()
        subprocess.run(["docker", "compose", *extra, "up", "-d", "--no-deps", "--no-build", "tenant-service"], cwd=ROOT, check=True,
                       capture_output=True)
        print(f"  Keycloak master yöneticisi ({admin_user}): parola yenilendi, tenant-service yeniden başlatıldı")

    print("Yeni parolalar ekrana basılmadı: tests/credentials.json ve .env dosyalarında.")


if __name__ == "__main__":
    main(sys.argv[1:])
