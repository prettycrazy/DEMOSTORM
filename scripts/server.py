#!/usr/bin/env python3
import json
import os
import socket
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

    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30, context=context) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")
            raise FeishuRequestError(e.code, detail) from e
        except (urllib.error.URLError, ConnectionResetError, socket.timeout, OSError) as e:
            last_error = e
            if attempt == 2:
                break
            time.sleep(0.35 * (attempt + 1))
    raise last_error


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


def fetch_records(table_id, text_field_as_array=False):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    token = get_tenant_access_token()
    records = []
    page_token = None
    while True:
        url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=200"
        if text_field_as_array:
            url += "&text_field_as_array=true"
        if page_token:
            url += f"&page_token={page_token}"
        res = http_request(url, headers={"Authorization": f"Bearer {token}"})
        if res.get("code") != 0:
            raise RuntimeError(f"Fetch error: {res}")
        data = res.get("data", {})
        for item in data.get("items", []):
            records.append({
                "id": item.get("record_id", ""),
                "created_time": item.get("created_time", ""),
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
        "状态": "OPEN POOL",
    }

    if payload.get("tag"):
        fields["标签"] = payload["tag"].strip()
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
        "状态": "OPEN POOL",
    }

    if payload.get("tag"):
        fields["标签"] = payload["tag"].strip()
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
COMMENT_TABLE_ID = os.getenv("FEISHU_COMMENTS_TABLE_ID", "tblc9a0rQHutXXHu")
COMMENT_FIELD_ALIASES = {
    "content": ["评论内容", "内容", "Comment", "评论"],
    "target_type": ["目标类型", "Target Type", "type"],
    "target_record_id": ["目标记录ID", "目标记录Id", "Target Record ID", "record_id"],
    "parent_id": ["父评论ID", "Parent Comment ID", "parent_id"],
    "likes": ["点赞数", "点赞", "Likes", "likes"],
    "status": ["状态", "Status", "status"],
    "creator": ["创建人", "作者名和OpenID"],
    "created_at": ["创建时间", "Created Time", "created_at"],
}


def pick_alias(fields, aliases):
    for key in aliases:
        if key in fields and fields[key] is not None:
            return fields[key]
    return ""


def normalize_creator_name(value):
    if isinstance(value, list) and value:
        first = value[0] or {}
        if isinstance(first, dict):
            return first.get("name") or first.get("en_name") or first.get("id") or "Unknown"
        return str(first)
    if isinstance(value, dict):
        return value.get("name") or value.get("en_name") or value.get("id") or "Unknown"
    if isinstance(value, str) and value.strip():
        return value.strip()
    return "Unknown"


def normalize_comment_record(record):
    fields = record.get("fields") or {}
    return {
        "id": record.get("id") or record.get("record_id") or "",
        "content": str(pick_alias(fields, COMMENT_FIELD_ALIASES["content"]) or "").strip(),
        "target_type": str(pick_alias(fields, COMMENT_FIELD_ALIASES["target_type"]) or "").strip().lower(),
        "target_record_id": str(pick_alias(fields, COMMENT_FIELD_ALIASES["target_record_id"]) or "").strip(),
        "parent_id": str(pick_alias(fields, COMMENT_FIELD_ALIASES["parent_id"]) or "").strip(),
        "likes": extract_like_count({"点赞数": pick_alias(fields, COMMENT_FIELD_ALIASES["likes"])}),
        "status": str(pick_alias(fields, COMMENT_FIELD_ALIASES["status"]) or "active").strip().lower(),
        "author_name": normalize_creator_name(pick_alias(fields, COMMENT_FIELD_ALIASES["creator"])),
        "created_at": pick_alias(fields, COMMENT_FIELD_ALIASES["created_at"]) or "",
    }


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


def get_comments_table_id():
    return os.getenv("FEISHU_COMMENTS_TABLE_ID", COMMENT_TABLE_ID)


def get_record(table_id, record_id, token):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
    res = http_request(url, method="GET", headers={"Authorization": f"Bearer {token}"})
    if res.get("code") != 0:
        raise RuntimeError(f"Fetch record error: {res}")
    return (res.get("data") or {}).get("record") or {}


def update_record_fields(table_id, record_id, fields, token):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
    res = http_request(url, method="PUT", headers={"Authorization": f"Bearer {token}"}, body={"fields": fields})
    if res.get("code") != 0:
        raise RuntimeError(f"Update record error: {res}")
    return res


def create_record(table_id, fields, token):
    app_token = get_env("FEISHU_BITABLE_APP_TOKEN")
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records"
    res = http_request(url, method="POST", headers={"Authorization": f"Bearer {token}"}, body={"fields": fields})
    if res.get("code") != 0:
        raise RuntimeError(f"Create record error: {res}")
    record = (res.get("data") or {}).get("record") or {}
    return {
        "id": record.get("record_id") or "",
        "fields": record.get("fields") or fields
    }


def fetch_comments():
    return [normalize_comment_record(item) for item in fetch_records(get_comments_table_id())]


def like_comment_with_token(record_id, token):
    record = get_record(get_comments_table_id(), record_id, token)
    fields = record.get("fields") or {}
    like_field = "点赞数"
    for key in COMMENT_FIELD_ALIASES["likes"]:
        if key in fields:
            like_field = key
            break
    next_likes = extract_like_count({"点赞数": pick_alias(fields, COMMENT_FIELD_ALIASES["likes"])}) + 1
    update_record_fields(get_comments_table_id(), record_id, {like_field: next_likes}, token)
    return next_likes


def create_comment_with_token(payload, token):
    fields = {
        "评论内容": str(payload.get("content", "")).strip(),
        "目标类型": str(payload.get("target_type", "")).strip().lower(),
        "目标记录ID": str(payload.get("target_record_id", "")).strip(),
        "点赞数": 0,
        "状态": "active",
    }
    parent_id = str(payload.get("parent_id", "")).strip()
    if parent_id:
        fields["父评论ID"] = parent_id
    record = create_record(get_comments_table_id(), fields, token)
    return normalize_comment_record(record)


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
            scope = os.getenv("FEISHU_OAUTH_SCOPE", "auth:user.id:read bitable:app base:record:create base:record:read base:record:update")
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
                records = fetch_records(get_env("FEISHU_PROJECTS_TABLE_ID"), text_field_as_array=True)
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
                records = fetch_records(get_env("FEISHU_IDEAS_TABLE_ID"), text_field_as_array=True)
                json_response(self, 200, {
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "records": records
                })
            except Exception as e:
                print("Error fetching ideas:", e)
                status = e.status if isinstance(e, FeishuRequestError) else 500
                json_response(self, status, {"message": str(e)})
            return

        if self.path.startswith("/api/comments"):
            try:
                parsed = urllib.parse.urlparse(self.path)
                query = urllib.parse.parse_qs(parsed.query)
                target_type = (query.get("target_type", [""])[0] or "").strip().lower()
                target_record_id = (query.get("target_record_id", [""])[0] or "").strip()
                summary = (query.get("summary", [""])[0] or "").strip().lower() in ("1", "true", "yes")
                comments = [
                    item for item in fetch_comments()
                    if item.get("status") != "deleted"
                ]
                if summary:
                    summary_map = {}
                    for comment in comments:
                        if comment.get("status") == "hidden":
                            continue
                        key = f"{comment.get('target_type')}:{comment.get('target_record_id')}"
                        if key == ":":
                            continue
                        summary_map[key] = summary_map.get(key, 0) + 1
                    json_response(self, 200, {
                        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        "summary": summary_map
                    })
                    return
                filtered = [
                    item for item in comments
                    if (not target_type or item.get("target_type") == target_type)
                    and (not target_record_id or item.get("target_record_id") == target_record_id)
                    and item.get("status") != "hidden"
                ]
                filtered.sort(key=lambda item: str(item.get("created_at") or ""))
                json_response(self, 200, {
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "comments": filtered
                })
            except Exception as e:
                print("Error fetching comments:", e)
                status = e.status if isinstance(e, FeishuRequestError) else 500
                json_response(self, status, {"message": str(e)})
            return

        if self.path.startswith("/api/progress"):
            try:
                table_id = os.getenv("FEISHU_PROGRESS_TABLE_ID", "").strip()
                if not table_id:
                    json_response(self, 200, {
                        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        "records": []
                    })
                    return
                records = fetch_records(table_id, text_field_as_array=True)
                json_response(self, 200, {
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "records": records
                })
            except Exception as e:
                print("Error fetching progress:", e)
                status = e.status if isinstance(e, FeishuRequestError) else 500
                json_response(self, status, {"message": str(e)})
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/progress"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                user_auth = self.current_user()
                payload = json.loads(body.decode("utf-8"))
                if not user_auth:
                    json_response(self, 401, {"message": "请先授权飞书账号"})
                    return

                table_id = os.getenv("FEISHU_PROGRESS_TABLE_ID", "").strip()
                if not table_id:
                    json_response(self, 500, {"message": "Missing FEISHU_PROGRESS_TABLE_ID"})
                    return

                record_id = str(payload.get("id", "")).strip()
                current_update = str(payload.get("current_update", "")).strip()
                next_step = str(payload.get("next_step", "")).strip()
                materials = str(payload.get("materials", "")).strip()
                try:
                    progress = int(round(float(payload.get("progress"))))
                except (TypeError, ValueError):
                    progress = None

                if not record_id:
                    json_response(self, 400, {"message": "缺少 project id"})
                    return
                if progress is None or progress < 0 or progress > 100:
                    json_response(self, 400, {"message": "进度必须是 0 到 100 之间的数字"})
                    return
                if not current_update or not next_step or not materials:
                    json_response(self, 400, {"message": "请完整填写当前进展、下一步计划和相关材料"})
                    return

                progress_record = create_record(table_id, {
                    "目标记录ID": record_id,
                    "进度": str(progress),
                    "当前进展": current_update,
                    "下一步计划": next_step,
                    "相关材料": materials,
                }, get_tenant_access_token())
                projects_table_id = os.getenv("FEISHU_PROJECTS_TABLE_ID", "").strip()
                if projects_table_id:
                    update_record_fields(projects_table_id, record_id, {
                        "进度": progress,
                    }, get_tenant_access_token())
                progress_record["created_time"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
                json_response(self, 200, {"message": "ok", "progress": progress_record})
            except Exception as e:
                print("Error creating progress record:", e)
                status = e.status if isinstance(e, FeishuRequestError) else 500
                json_response(self, status, {"message": str(e)})
            return

        if self.path.startswith("/api/projects"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                user_auth = self.current_user()
                payload = json.loads(body.decode("utf-8"))

                if payload.get("action") != "update_progress":
                    json_response(self, 400, {"message": "Unsupported project action"})
                    return

                if not user_auth:
                    json_response(self, 401, {"message": "请先授权飞书账号"})
                    return

                record_id = str(payload.get("id", "")).strip()
                current_update = str(payload.get("current_update", "")).strip()
                next_step = str(payload.get("next_step", "")).strip()
                materials = str(payload.get("materials", "")).strip()
                try:
                    progress = int(round(float(payload.get("progress"))))
                except (TypeError, ValueError):
                    progress = None

                if not record_id:
                    json_response(self, 400, {"message": "缺少 project id"})
                    return
                if progress is None or progress < 0 or progress > 100:
                    json_response(self, 400, {"message": "进度必须是 0 到 100 之间的数字"})
                    return
                if not current_update or not next_step or not materials:
                    json_response(self, 400, {"message": "请完整填写当前进展、下一步计划和相关材料"})
                    return

                token_value = get_user_access_token(user_auth)
                if isinstance(token_value, tuple):
                    token, refreshed = token_value
                    user_auth.update(refreshed)
                    self.save_user_auth(user_auth)
                else:
                    token = token_value

                update_record_fields(get_env("FEISHU_PROJECTS_TABLE_ID"), record_id, {
                    "进度": progress,
                    "当前进展": current_update,
                    "下一步计划": next_step,
                    "相关材料": materials,
                }, token)
                json_response(self, 200, {"message": "ok"})
            except Exception as e:
                print("Error updating project progress:", e)
                status = e.status if isinstance(e, FeishuRequestError) else 500
                json_response(self, status, {"message": str(e)})
            return

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

        if self.path.startswith("/api/comments"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                user_auth = self.current_user()
                payload = json.loads(body.decode("utf-8"))
                submit_mode = str(payload.get("submit_mode", "")).strip().lower()
                guest_enabled = guest_mode_enabled()

                def resolve_token():
                    if submit_mode == "guest":
                        if not guest_enabled:
                            raise FeishuRequestError(400, "当前未开启游客提交")
                        return get_tenant_access_token()
                    if submit_mode == "auth":
                        if not user_auth:
                            raise FeishuRequestError(401, "请先授权飞书账号")
                        token_value = get_user_access_token(user_auth)
                        if isinstance(token_value, tuple):
                            token, refreshed = token_value
                            user_auth.update(refreshed)
                            self.save_user_auth(user_auth)
                            return token
                        return token_value
                    if user_auth:
                        token_value = get_user_access_token(user_auth)
                        if isinstance(token_value, tuple):
                            token, refreshed = token_value
                            user_auth.update(refreshed)
                            self.save_user_auth(user_auth)
                            return token
                        return token_value
                    if guest_enabled:
                        return get_tenant_access_token()
                    raise FeishuRequestError(401, "需要先登录授权")

                if payload.get("action") == "like":
                    record_id = str(payload.get("id", "")).strip()
                    if not record_id:
                        json_response(self, 400, {"message": "缺少 comment id"})
                        return
                    next_likes = like_comment_with_token(record_id, resolve_token())
                    json_response(self, 200, {"message": "ok", "likes": next_likes})
                    return

                content = str(payload.get("content", "")).strip()
                target_type = str(payload.get("target_type", "")).strip().lower()
                target_record_id = str(payload.get("target_record_id", "")).strip()
                if not content:
                    json_response(self, 400, {"message": "评论内容不能为空"})
                    return
                if target_type not in ("project", "idea") or not target_record_id:
                    json_response(self, 400, {"message": "目标记录参数无效"})
                    return

                comment = create_comment_with_token(payload, resolve_token())
                json_response(self, 200, {"message": "ok", "comment": comment})
            except Exception as e:
                print("Error handling comment:", e)
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
