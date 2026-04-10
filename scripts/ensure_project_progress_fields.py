#!/usr/bin/env python3
import json
import os
import ssl
import sys
import urllib.error
import urllib.request

try:
    import certifi
except Exception:
    certifi = None

API_BASE = "https://open.feishu.cn/open-apis"
TOKEN_URL = f"{API_BASE}/auth/v3/tenant_access_token/internal"
FIELD_NAMES = ["当前进展", "下一步计划", "相关材料"]


def read_env(key):
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Missing env: {key}")
    return value


def http_request(url, method="GET", headers=None, body=None):
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    if body is not None:
        req.add_header("Content-Type", "application/json; charset=utf-8")
    context = ssl.create_default_context(cafile=certifi.where()) if certifi is not None else None
    try:
        with urllib.request.urlopen(req, timeout=30, context=context) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e


def get_tenant_access_token():
    res = http_request(TOKEN_URL, method="POST", body={
        "app_id": read_env("FEISHU_APP_ID"),
        "app_secret": read_env("FEISHU_APP_SECRET"),
    })
    if res.get("code") != 0:
        raise RuntimeError(f"Token error: {res}")
    return res["tenant_access_token"]


def list_fields(app_token, table_id, token):
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/fields?page_size=200"
    res = http_request(url, headers={"Authorization": f"Bearer {token}"})
    if res.get("code") != 0:
        raise RuntimeError(f"List fields error: {res}")
    return res.get("data", {}).get("items", [])


def create_text_field(app_token, table_id, token, field_name):
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/fields"
    res = http_request(
        url,
        method="POST",
        headers={"Authorization": f"Bearer {token}"},
        body={"field_name": field_name, "type": 1},
    )
    if res.get("code") != 0:
        raise RuntimeError(f"Create field error: {res}")
    return res.get("data", {}).get("field", {})


def main():
    app_token = read_env("FEISHU_BITABLE_APP_TOKEN")
    table_id = read_env("FEISHU_PROJECTS_TABLE_ID")
    token = get_tenant_access_token()
    existing_fields = {item.get("field_name"): item for item in list_fields(app_token, table_id, token)}
    created = []

    for field_name in FIELD_NAMES:
        if field_name in existing_fields:
            continue
        created.append(create_text_field(app_token, table_id, token, field_name))

    print(json.dumps({
        "created_count": len(created),
        "created_fields": [
            {"field_name": field.get("field_name"), "field_id": field.get("field_id")}
            for field in created
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
