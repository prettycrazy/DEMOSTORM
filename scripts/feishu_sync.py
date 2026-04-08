#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
import ssl

try:
    import certifi
except Exception:
    certifi = None

API_BASE = "https://open.feishu.cn/open-apis"
TOKEN_URL = f"{API_BASE}/auth/v3/tenant_access_token/internal"


def read_env(key, required=True):
    value = os.getenv(key)
    if required and not value:
        print(f"Missing env: {key}", file=sys.stderr)
        sys.exit(1)
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


def get_tenant_access_token(app_id, app_secret):
    payload = {"app_id": app_id, "app_secret": app_secret}
    res = http_request(TOKEN_URL, method="POST", body=payload)
    if res.get("code") != 0:
        raise RuntimeError(f"Token error: {res}")
    return res["tenant_access_token"]


def fetch_records(app_token, table_id, access_token, page_size=200, text_field_as_array=False):
    records = []
    page_token = None
    while True:
        url = f"{API_BASE}/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size={page_size}"
        if text_field_as_array:
            url += "&text_field_as_array=true"
        if page_token:
            url += f"&page_token={page_token}"
        res = http_request(url, headers={"Authorization": f"Bearer {access_token}"})
        if res.get("code") != 0:
            raise RuntimeError(f"Fetch error: {res}")
        data = res.get("data", {})
        items = data.get("items", [])
        for item in items:
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


def main():
    parser = argparse.ArgumentParser(description="Sync Feishu Bitable tables to local JSON for the board UI.")
    parser.add_argument("--output-dir", default="./data", help="Output directory for JSON files")
    parser.add_argument("--page-size", type=int, default=200, help="Records per page")
    args = parser.parse_args()

    app_id = read_env("FEISHU_APP_ID")
    app_secret = read_env("FEISHU_APP_SECRET")
    app_token = read_env("FEISHU_BITABLE_APP_TOKEN")
    projects_table_id = read_env("FEISHU_PROJECTS_TABLE_ID")
    ideas_table_id = read_env("FEISHU_IDEAS_TABLE_ID")

    os.makedirs(args.output_dir, exist_ok=True)

    access_token = get_tenant_access_token(app_id, app_secret)
    projects = fetch_records(app_token, projects_table_id, access_token, args.page_size, text_field_as_array=True)
    ideas = fetch_records(app_token, ideas_table_id, access_token, args.page_size, text_field_as_array=True)

    now = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    with open(os.path.join(args.output_dir, "projects.json"), "w", encoding="utf-8") as f:
        json.dump({"updated_at": now, "records": projects}, f, ensure_ascii=False, indent=2)

    with open(os.path.join(args.output_dir, "ideas.json"), "w", encoding="utf-8") as f:
        json.dump({"updated_at": now, "records": ideas}, f, ensure_ascii=False, indent=2)

    print("Synced projects and ideas successfully.")


if __name__ == "__main__":
    main()
