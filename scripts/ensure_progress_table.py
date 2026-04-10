#!/usr/bin/env python3
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import certifi
except Exception:
    certifi = None

API_BASE = "https://open.feishu.cn/open-apis"
TOKEN_URL = f"{API_BASE}/auth/v3/tenant_access_token/internal"
TABLE_NAME = "项目进展"
FIELD_NAMES = ["目标记录ID", "进度", "当前进展", "下一步计划", "相关材料"]


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
    last_error = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30, context=context) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"HTTP {e.code}: {detail}") from e
        except (urllib.error.URLError, ConnectionResetError, socket.timeout, OSError) as e:
            last_error = e
            if attempt == 5:
                break
            time.sleep(0.6 * (attempt + 1))
    raise last_error


def get_tenant_access_token():
    res = http_request(TOKEN_URL, method="POST", body={
        "app_id": read_env("FEISHU_APP_ID"),
        "app_secret": read_env("FEISHU_APP_SECRET"),
    })
    if res.get("code") != 0:
        raise RuntimeError(f"Token error: {res}")
    return res["tenant_access_token"]


def list_tables(app_token, token):
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables?page_size=200"
    res = http_request(url, headers={"Authorization": f"Bearer {token}"})
    if res.get("code") != 0:
        raise RuntimeError(f"List tables error: {res}")
    return res.get("data", {}).get("items", [])


def create_table(app_token, token, table_name):
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables"
    res = http_request(
        url,
        method="POST",
        headers={"Authorization": f"Bearer {token}"},
        body={"table": {"name": table_name}},
    )
    if res.get("code") != 0:
        raise RuntimeError(f"Create table error: {res}")
    return res.get("data", {}).get("table_id") or res.get("data", {}).get("table", {}).get("table_id")


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
    token = get_tenant_access_token()

    existing_tables = list_tables(app_token, token)
    table = next((item for item in existing_tables if item.get("name") == TABLE_NAME), None)
    created_table = False
    table_id = os.getenv("FEISHU_PROGRESS_TABLE_ID", "").strip()
    if table_id:
        table = {"table_id": table_id, "name": TABLE_NAME}
    if not table:
        table_id = create_table(app_token, token, TABLE_NAME)
        created_table = True
    else:
        table_id = table.get("table_id")

    existing_fields = {item.get("field_name"): item for item in list_fields(app_token, table_id, token)}
    created_fields = []
    for field_name in FIELD_NAMES:
        if field_name in existing_fields:
            continue
        created_fields.append(create_text_field(app_token, table_id, token, field_name))

    print(json.dumps({
        "created_table": created_table,
        "table_id": table_id,
        "created_fields": [
            {"field_name": field.get("field_name"), "field_id": field.get("field_id")}
            for field in created_fields
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
