#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
import ssl
from pathlib import Path

try:
    import certifi
except Exception:
    certifi = None

API_BASE = "https://open.feishu.cn/open-apis"
APP_TOKEN_URL = f"{API_BASE}/auth/v3/app_access_token/internal"
USER_TOKEN_URL = f"{API_BASE}/authen/v1/access_token"
USER_REFRESH_URL = f"{API_BASE}/authen/v1/refresh_access_token"
AUTH_INDEX_URL = f"{API_BASE}/authen/v1/index"


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
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e


def read_env(path):
    if not path:
        return
    if not os.path.exists(path):
        print(f"Env file not found: {path}", file=sys.stderr)
        sys.exit(1)
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def get_env(key):
    value = os.getenv(key)
    if not value:
        print(f"Missing env: {key}", file=sys.stderr)
        sys.exit(1)
    return value


def get_app_access_token():
    payload = {
        "app_id": get_env("FEISHU_APP_ID"),
        "app_secret": get_env("FEISHU_APP_SECRET"),
    }
    res = http_request(APP_TOKEN_URL, method="POST", body=payload)
    if res.get("code") != 0:
        raise RuntimeError(f"App token error: {res}")
    return res["app_access_token"]


def print_auth_url(redirect_uri, scope, state):
    params = {
        "app_id": get_env("FEISHU_APP_ID"),
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
    }
    url = f"{AUTH_INDEX_URL}?{urllib.parse.urlencode(params)}"
    print(url)


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
    auth = {
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
    return auth


def refresh_token(refresh_token_value):
    app_token = get_app_access_token()
    payload = {
        "grant_type": "refresh_token",
        "client_id": get_env("FEISHU_APP_ID"),
        "client_secret": get_env("FEISHU_APP_SECRET"),
        "refresh_token": refresh_token_value,
    }
    res = http_request(USER_REFRESH_URL, method="POST", headers={"Authorization": f"Bearer {app_token}"}, body=payload)
    if res.get("code") != 0:
        raise RuntimeError(f"Refresh token error: {res}")
    data = res.get("data", {})
    expires_at = int(time.time()) + int(data.get("expires_in", 0))
    refresh_expires_at = int(time.time()) + int(data.get("refresh_expires_in", 0))
    auth = {
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token", refresh_token_value),
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
    return auth


def main():
    parser = argparse.ArgumentParser(description="Feishu user OAuth helper")
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--redirect-uri", required=True)
    parser.add_argument("--print-auth-url", action="store_true")
    parser.add_argument("--scope", default="auth:user.id:read bitable:app base:record:create base:record:read")
    parser.add_argument("--state", default="workboard")
    parser.add_argument("--exchange-redirect-url")
    parser.add_argument("--code")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--auth-file", default=".user_auth.json")
    args = parser.parse_args()

    read_env(args.env_file)

    if args.print_auth_url:
        print_auth_url(args.redirect_uri, args.scope, args.state)
        return

    if args.exchange_redirect_url:
        parsed = urllib.parse.urlparse(args.exchange_redirect_url)
        query = urllib.parse.parse_qs(parsed.query)
        code = query.get("code", [None])[0]
        if not code:
            print("No code in redirect URL", file=sys.stderr)
            sys.exit(1)
        auth = exchange_code(code, args.redirect_uri)
        Path(args.auth_file).write_text(json.dumps(auth, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Saved user auth to {args.auth_file}")
        return

    if args.code:
        auth = exchange_code(args.code, args.redirect_uri)
        Path(args.auth_file).write_text(json.dumps(auth, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Saved user auth to {args.auth_file}")
        return

    if args.refresh:
        auth_path = Path(args.auth_file)
        if not auth_path.exists():
            print("No auth file to refresh", file=sys.stderr)
            sys.exit(1)
        auth = json.loads(auth_path.read_text(encoding="utf-8"))
        token = auth.get("refresh_token")
        if not token:
            print("Missing refresh_token", file=sys.stderr)
            sys.exit(1)
        refreshed = refresh_token(token)
        auth_path.write_text(json.dumps(refreshed, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Refreshed user token")
        return

    print("No action specified. Use --print-auth-url, --exchange-redirect-url, --code, or --refresh", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
