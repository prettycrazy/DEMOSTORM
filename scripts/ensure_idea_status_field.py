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
DEFAULT_STATUS = "OPEN POOL"
FIELD_NAME = "状态"


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
    payload = {
        "app_id": read_env("FEISHU_APP_ID"),
        "app_secret": read_env("FEISHU_APP_SECRET"),
    }
    res = http_request(TOKEN_URL, method="POST", body=payload)
    if res.get("code") != 0:
        raise RuntimeError(f"Token error: {res}")
    return res["tenant_access_token"]


def get_table_fields(app_token, table_id, token):
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


def fetch_records(app_token, table_id, token):
    records = []
    page_token = None
    while True:
        url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=200&text_field_as_array=true"
        if page_token:
            url += f"&page_token={page_token}"
        res = http_request(url, headers={"Authorization": f"Bearer {token}"})
        if res.get("code") != 0:
            raise RuntimeError(f"Fetch records error: {res}")
        data = res.get("data", {})
        records.extend(data.get("items", []))
        if not data.get("has_more") or not data.get("page_token"):
            break
        page_token = data.get("page_token")
    return records


def has_meaningful_fields(fields):
    if not isinstance(fields, dict) or not fields:
        return False
    for value in fields.values():
        if value not in ("", None, [], {}):
            return True
    return False


def update_record_fields(app_token, table_id, record_id, token, fields):
    url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"
    res = http_request(
        url,
        method="PUT",
        headers={"Authorization": f"Bearer {token}"},
        body={"fields": fields},
    )
    if res.get("code") != 0:
        raise RuntimeError(f"Update record error: {res}")


def main():
    app_token = read_env("FEISHU_BITABLE_APP_TOKEN")
    table_id = read_env("FEISHU_IDEAS_TABLE_ID")
    token = get_tenant_access_token()

    fields = get_table_fields(app_token, table_id, token)
    field = next((item for item in fields if item.get("field_name") == FIELD_NAME), None)
    created = False
    if not field:
        field = create_text_field(app_token, table_id, token, FIELD_NAME)
        created = True

    updated_records = 0
    for item in fetch_records(app_token, table_id, token):
        record_id = item.get("record_id")
        record_fields = item.get("fields") or {}
        if not record_id or not has_meaningful_fields(record_fields):
            continue
        if str(record_fields.get(FIELD_NAME) or "").strip():
            continue
        update_record_fields(app_token, table_id, record_id, token, {FIELD_NAME: DEFAULT_STATUS})
        updated_records += 1

    print(json.dumps({
        "field_name": FIELD_NAME,
        "created": created,
        "field_id": field.get("field_id"),
        "default_status": DEFAULT_STATUS,
        "updated_records": updated_records,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
