#!/usr/bin/env python3
import json
import os
import time
import urllib.request
import urllib.error
import urllib.parse
import ssl
import secrets
from http import cookies
from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path

try:
    import certifi
except Exception:
    certifi = None

PROJECT_ROOT = Path(__file__).resolve().parent.parent
API_BASE = "https://open.feishu.cn/open-apis"
TENANT_TOKEN_URL = f"{API_BASE}/auth/v3/tenant_access_token/internal"
APP_TOKEN_URL = f"{API_BASE}/auth/v3/app_access_token/internal"
USER_TOKEN_URL = f"{API_BASE}/authen/v1/access_token"
USER_REFRESH_URL = f"{API_BASE}/authen/v1/refresh_access_token"

TOKEN_CACHE = {
    "token": None,
    "expire_at": 0,
}

APP_TOKEN_CACHE = {
    "token": None,
    "expire_at": 0,
}

USER_AUTH_STORE_PATH = PROJECT_ROOT / ".user_auth_store.json"
SESSION_STORE = {}
GUEST_MODE_OVERRIDE = None


def json_response(handler, status, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data)


class FeishuRequestError(RuntimeError):
    def __init__(self, status, detail):
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status
        self.detail = detail


def http_request(url, method="GET", headers=None, body=None):
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    if body is not None:
        req.add_header("Content-Type", "application/json")

    context = None
    if certifi is not None:
        context = ssl.create_default_context(cafile=certifi.where())

    try:
        with urllib.request.urlopen(req, timeout=30, context=context) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise FeishuRequestError(e.code, detail) from e


def get_env(key):
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Missing env: {key}")
    return value


def get_tenant_access_token():
    now = time.time()
    if TOKEN_CACHE["token"] and TOKEN_CACHE["expire_at"] - 60 > now:
        return TOKEN_CACHE["token"]

    payload = {
        "app_id": get_env("FEISHU_APP_ID"),
        "app_secret": get_env("FEISHU_APP_SECRET"),
    }
    res = http_request(TENANT_TOKEN_URL, method="POST", body=payload)
    if res.get("code") != 0:
        raise RuntimeError(f"Token error: {res}")

    TOKEN_CACHE["token"] = res["tenant_access_token"]
    TOKEN_CACHE["expire_at"] = now + int(res.get("expire", 3600))
    return TOKEN_CACHE["token"]


def get_app_access_token():
    now = time.time()
    if APP_TOKEN_CACHE["token"] and APP_TOKEN_CACHE["expire_at"] - 60 > now:
        return APP_TOKEN_CACHE["token"]

    payload = {
        "app_id": get_env("FEISHU_APP_ID"),
        "app_secret": get_env("FEISHU_APP_SECRET"),
    }
    res = http_request(APP_TOKEN_URL, method="POST", body=payload)
    if res.get("code") != 0:
        raise RuntimeError(f"App token error: {res}")

    APP_TOKEN_CACHE["token"] = res["app_access_token"]
    APP_TOKEN_CACHE["expire_at"] = now + int(res.get("expire", 3600))
    return APP_TOKEN_CACHE["token"]


def load_user_store():
    if not USER_AUTH_STORE_PATH.exists():
        return {}
    try:
        return json.loads(USER_AUTH_STORE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_user_store(store):
    USER_AUTH_STORE_PATH.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def refresh_user_access_token(refresh_token):
    app_token = get_app_access_token()
    payload = {
        "grant_type": "refresh_token",
        "client_id": get_env("FEISHU_APP_ID"),
        "client_secret": get_env("FEISHU_APP_SECRET"),
        "refresh_token": refresh_token,
    }
    res = http_request(
        USER_REFRESH_URL,
        method="POST",
        headers={"Authorization": f"Bearer {app_token}"},
        body=payload,
    )
    if res.get("code") != 0:
        raise RuntimeError(f"Refresh user token error: {res}")
    data = res.get("data", {})
    expires_at = int(time.time()) + int(data.get("expires_in", 0))
    refresh_expires_at = int(time.time()) + int(data.get("refresh_expires_in", 0))
    new_auth = {
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token", refresh_token),
        "expires_at": expires_at,
        "refresh_expires_at": refresh_expires_at,
        "user": {
            "name": data.get("name"),
            "en_name": data.get("en_name"),
            "open_id": data.get("open_id"),
            "union_id": data.get("union_id"),
            "email": data.get("email"),
        },
    }
    return new_auth


def get_user_access_token(user_auth):
    now = int(time.time())
    if user_auth.get("access_token") and user_auth.get("expires_at", 0) - 60 > now:
        return user_auth["access_token"]
    refresh_token = user_auth.get("refresh_token")
    if not refresh_token:
        raise RuntimeError("Missing refresh_token in user auth.")
    refreshed = refresh_user_access_token(refresh_token)
    return refreshed["access_token"], refreshed


def fetch_records(table_id):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    token = get_tenant_access_token()
    records = []
    page_token = None
    while True:
        url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=200"
        if page_token:
            url += f"&page_token={page_token}"
        res = http_request(url, headers={"Authorization": f"Bearer {token}"})
        if res.get("code") != 0:
            raise RuntimeError(f"Fetch error: {res}")
        data = res.get("data", {})
        for item in data.get("items", []):
            records.append({
                "id": item.get("record_id", ""),
                "fields": item.get("fields", {})
            })
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
        if not page_token:
            break
    return records


def create_idea(payload, user_auth):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    table_id = get_env("FEISHU_IDEAS_TABLE_ID")
    token_value = get_user_access_token(user_auth)
    if isinstance(token_value, tuple):
        token, refreshed = token_value
        user_auth.update(refreshed)
    else:
        token = token_value

    fields = {
        "IDEA标题": payload.get("title", "").strip(),
    }

    if payload.get("problem"):
        fields["解决的问题（必填）"] = payload["problem"].strip()
    if payload.get("plan"):
        fields["demo的思路（非必填）"] = payload["plan"].strip()
    if payload.get("owner_open_id"):
        fields["填写人"] = [{"id": payload["owner_open_id"].strip(), "type": "open_id"}]

    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records"
    res = http_request(url, method="POST", headers={"Authorization": f"Bearer {token}"}, body={"fields": fields})
    if res.get("code") != 0:
        raise RuntimeError(f"Create error: {res}")
    return res


def create_idea_as_app(payload):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    table_id = get_env("FEISHU_IDEAS_TABLE_ID")
    token = get_tenant_access_token()

    fields = {
        "IDEA标题": payload.get("title", "").strip(),
    }

    if payload.get("problem"):
        fields["解决的问题（必填）"] = payload["problem"].strip()
    if payload.get("plan"):
        fields["demo的思路（非必填）"] = payload["plan"].strip()

    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records"
    res = http_request(url, method="POST", headers={"Authorization": f"Bearer {token}"}, body={"fields": fields})
    if res.get("code") != 0:
        raise RuntimeError(f"Create error: {res}")
    return res


LIKE_FIELD_CANDIDATES = ["点赞", "点赞数", "Likes", "likes", "Votes", "votes"]


def extract_like_count(fields):
    for key in [os.getenv("FEISHU_IDEAS_LIKES_FIELD"), *LIKE_FIELD_CANDIDATES]:
        if not key:
            continue
        value = fields.get(key)
        try:
            return max(0, int(round(float(value))))
        except (TypeError, ValueError):
            continue
    return 0


def resolve_like_field_name(fields):
    configured = os.getenv("FEISHU_IDEAS_LIKES_FIELD")
    if configured:
        return configured
    for key in LIKE_FIELD_CANDIDATES:
        if key in fields:
            return key
    return "点赞"


def get_idea_record(record_id, token):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    table_id = get_env("FEISHU_IDEAS_TABLE_ID")
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
    res = http_request(url, method="GET", headers={"Authorization": f"Bearer {token}"})
    if res.get("code") != 0:
        raise RuntimeError(f"Fetch record error: {res}")
    return (res.get("data") or {}).get("record") or {}


def update_idea_fields(record_id, fields, token):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    table_id = get_env("FEISHU_IDEAS_TABLE_ID")
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
    res = http_request(url, method="PUT", headers={"Authorization": f"Bearer {token}"}, body={"fields": fields})
    if res.get("code") != 0:
        raise RuntimeError(f"Update record error: {res}")
    return res


def like_idea_with_token(record_id, token):
    record = get_idea_record(record_id, token)
    fields = record.get("fields") or {}
    like_field = resolve_like_field_name(fields)
    next_likes = extract_like_count(fields) + 1
    update_idea_fields(record_id, {like_field: next_likes}, token)
    return next_likes


def guest_mode_enabled():
    if GUEST_MODE_OVERRIDE is not None:
        return bool(GUEST_MODE_OVERRIDE)
    return os.getenv("FEISHU_GUEST_MODE", "false").lower() in ("1", "true", "yes", "on")


def update_env_file(key, value):
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    lines = env_path.read_text(encoding="utf-8").splitlines()
    updated = False
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            updated = True
            break
    if not updated:
        lines.append(f"{key}={value}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_auth_url(redirect_uri, scope, state):
    params = {
        "app_id": get_env("FEISHU_APP_ID"),
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
    }
    query = urllib.parse.urlencode(params)
    return f"{API_BASE}/authen/v1/index?{query}"


def exchange_code(code, redirect_uri):
    app_token = get_app_access_token()
    payload = {
        "grant_type": "authorization_code",
        "client_id": get_env("FEISHU_APP_ID"),
        "client_secret": get_env("FEISHU_APP_SECRET"),
        "code": code,
        "redirect_uri": redirect_uri,
    }
    res = http_request(USER_TOKEN_URL, method="POST", headers={"Authorization": f"Bearer {app_token}"}, body=payload)
    if res.get("code") != 0:
        raise RuntimeError(f"Token error: {res}")
    data = res.get("data", {})
    expires_at = int(time.time()) + int(data.get("expires_in", 0))
    refresh_expires_at = int(time.time()) + int(data.get("refresh_expires_in", 0))
    return {
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token"),
        "expires_at": expires_at,
        "refresh_expires_at": refresh_expires_at,
        "user": {
            "name": data.get("name"),
            "en_name": data.get("en_name"),
            "open_id": data.get("open_id"),
            "union_id": data.get("union_id"),
            "email": data.get("email"),
        },
    }


class WorkboardHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        rel = path.lstrip("/") or "index.html"
        return str(PROJECT_ROOT / rel)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/oauth/callback") or self.path.startswith("/api/oauth/callback"):
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            self.do_GET_auth_callback(query)
            return

        if self.path.startswith("/api/config"):
            guest_enabled = guest_mode_enabled()
            json_response(self, 200, {
                "guest_mode": guest_enabled,
                "projects_table_url": os.getenv("FEISHU_PROJECTS_TABLE_URL", "https://lq9n5lvfn2i.feishu.cn/wiki/CZBWwReNHic9m4kUV95cWKJwnRe?table=tblvIoMdw5nslGsy&view=vewRk0ObQk"),
                "ideas_table_url": os.getenv("FEISHU_IDEAS_TABLE_URL", "https://lq9n5lvfn2i.feishu.cn/wiki/CZBWwReNHic9m4kUV95cWKJwnRe?table=tblPk1wR2xYSztdL&view=vewCeUkPfz")
            })
            return

        if self.path.startswith("/api/guest"):
            if self.command != "POST":
                json_response(self, 405, {"message": "Method Not Allowed"})
                return
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(body.decode("utf-8"))
                enabled = bool(payload.get("enabled"))
                global GUEST_MODE_OVERRIDE
                GUEST_MODE_OVERRIDE = enabled
                update_env_file("FEISHU_GUEST_MODE", "true" if enabled else "false")
                json_response(self, 200, {"guest_mode": enabled})
            except Exception as e:
                json_response(self, 500, {"message": str(e)})
            return

        if self.path.startswith("/api/login"):
            redirect_uri = os.getenv("FEISHU_REDIRECT_URI", "http://localhost:8004/api/oauth/callback")
            scope = os.getenv("FEISHU_OAUTH_SCOPE", "auth:user.id:read bitable:app base:record:create base:record:read")
            state = secrets.token_hex(8)
            auth_url = build_auth_url(redirect_uri, scope, state)
            json_response(self, 200, {"auth_url": auth_url})
            return

        if self.path.startswith("/api/me"):
            user = self.current_user()
            if not user:
                guest_enabled = guest_mode_enabled()
                if guest_enabled:
                    json_response(self, 200, {"user": None, "guest": True})
                else:
                    json_response(self, 401, {"message": "Unauthorized"})
                return
            json_response(self, 200, {"user": user.get("user"), "guest": False})
            return

        if self.path.startswith("/api/projects"):
            try:
                records = fetch_records(get_env("FEISHU_PROJECTS_TABLE_ID"))
                json_response(self, 200, {
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "records": records
                })
            except Exception as e:
                print("Error fetching projects:", e)
                status = e.status if isinstance(e, FeishuRequestError) else 500
                json_response(self, status, {"message": str(e)})
            return

        if self.path.startswith("/api/ideas"):
            try:
                records = fetch_records(get_env("FEISHU_IDEAS_TABLE_ID"))
                json_response(self, 200, {
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "records": records
                })
            except Exception as e:
                print("Error fetching ideas:", e)
                status = e.status if isinstance(e, FeishuRequestError) else 500
                json_response(self, status, {"message": str(e)})
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/ideas"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                user_auth = self.current_user()
                payload = json.loads(body.decode("utf-8"))
                submit_mode = str(payload.get("submit_mode", "")).strip().lower()
                guest_enabled = guest_mode_enabled()

                if payload.get("action") == "like":
                    record_id = str(payload.get("id", "")).strip()
                    if not record_id:
                        json_response(self, 400, {"message": "缺少 idea id"})
                        return

                    if submit_mode == "guest":
                        if not guest_enabled:
                            json_response(self, 400, {"message": "当前未开启游客提交"})
                            return
                        next_likes = like_idea_with_token(record_id, get_tenant_access_token())
                    elif submit_mode == "auth":
                        if not user_auth:
                            json_response(self, 401, {"message": "请先授权飞书账号"})
                            return
                        token_value = get_user_access_token(user_auth)
                        if isinstance(token_value, tuple):
                            token, refreshed = token_value
                            user_auth.update(refreshed)
                            self.save_user_auth(user_auth)
                        else:
                            token = token_value
                        next_likes = like_idea_with_token(record_id, token)
                    elif user_auth:
                        token_value = get_user_access_token(user_auth)
                        if isinstance(token_value, tuple):
                            token, refreshed = token_value
                            user_auth.update(refreshed)
                            self.save_user_auth(user_auth)
                        else:
                            token = token_value
                        next_likes = like_idea_with_token(record_id, token)
                    else:
                        if not guest_enabled:
                            json_response(self, 401, {"message": "需要先登录授权"})
                            return
                        next_likes = like_idea_with_token(record_id, get_tenant_access_token())
                    json_response(self, 200, {"message": "ok", "likes": next_likes})
                    return

                if not payload.get("title"):
                    json_response(self, 400, {"message": "IDEA标题必填"})
                    return

                if submit_mode == "guest":
                    if not guest_enabled:
                        json_response(self, 400, {"message": "当前未开启游客提交"})
                        return
                    create_idea_as_app(payload)
                elif submit_mode == "auth":
                    if not user_auth:
                        json_response(self, 401, {"message": "请先授权飞书账号"})
                        return
                    create_idea(payload, user_auth)
                    self.save_user_auth(user_auth)
                else:
                    if user_auth:
                        create_idea(payload, user_auth)
                        self.save_user_auth(user_auth)
                    else:
                        if not guest_enabled:
                            json_response(self, 401, {"message": "需要先登录授权"})
                            return
                        create_idea_as_app(payload)
                json_response(self, 200, {"message": "ok"})
            except Exception as e:
                print("Error creating idea:", e)
                status = e.status if isinstance(e, FeishuRequestError) else 500
                json_response(self, status, {"message": str(e)})
            return

        json_response(self, 404, {"message": "Not Found"})

    def current_user(self):
        cookie = cookies.SimpleCookie(self.headers.get("Cookie"))
        sid = cookie.get("wb_session")
        if not sid:
            return None
        return SESSION_STORE.get(sid.value)

    def save_user_auth(self, auth):
        store = load_user_store()
        user_key = auth.get("user", {}).get("open_id") or auth.get("user", {}).get("union_id")
        if user_key:
            store[user_key] = auth
            save_user_store(store)

    def do_GET_auth_callback(self, query):
        redirect_uri = os.getenv("FEISHU_REDIRECT_URI", "http://localhost:8004/api/oauth/callback")
        code = query.get("code", [None])[0]
        if not code:
            json_response(self, 400, {"message": "Missing code"})
            return
        auth = exchange_code(code, redirect_uri)
        sid = secrets.token_hex(16)
        SESSION_STORE[sid] = auth
        self.save_user_auth(auth)
        self.send_response(302)
        self.send_header("Set-Cookie", f"wb_session={sid}; Path=/; HttpOnly")
        self.send_header("Location", "/")
        self.end_headers()

    # do_GET handled above


def main():
    port = int(os.getenv("PORT", "8000"))
    os.chdir(PROJECT_ROOT)
    server = HTTPServer(("", port), WorkboardHandler)
    print(f"Workboard server running at http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
