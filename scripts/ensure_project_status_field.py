#!/usr/bin/env python3
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

try:
    import certifi
except Exception:
    certifi = None

API_BASE = "https://open.feishu.cn/open-apis"
TOKEN_URL = f"{API_BASE}/auth/v3/tenant_access_token/internal"
FIELD_NAME = "状态"
STATUS_BY_TITLE = {
    "组合柜Agent": "Experiment",
    "组合空间布局推理": "Experiment",
    "模型库检索实验": "Experiment",
    "模型修改实验": "Experiment",
    "衣柜空间cad识别和还原": "Productization",
    "衣柜布局模板+模型匹配": "Proposal",
    "内空设计agent": "Proposal",
    "模型动画Agent": "Productization",
    "模拟动画": "Productization",
    "AI编排": "Productization",
    "内参原始编排数据结构对接": "Productization",
    "工具编排（编排结果可视化）": "Productization",
    "工具编排（AI微调数据）": "Productization",
    "工具编排（AI规则）": "Productization",
    "一键三轴标注": "Terminated",
    "Coohom安装宝": "Productization",
    "柜体查看及爆炸图": "Productization",
    "商品快速生成-未产先销": "Proposal",
    "模型搭配小程序": "Experiment",
    "ai硬装助手": "Terminated",
}


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
            url += f"&page_token={urllib.parse.quote(page_token)}"
        res = http_request(url, headers={"Authorization": f"Bearer {token}"})
        if res.get("code") != 0:
            raise RuntimeError(f"Fetch records error: {res}")
        data = res.get("data", {})
        records.extend(data.get("items", []))
        if not data.get("has_more") or not data.get("page_token"):
            break
        page_token = data.get("page_token")
    return records


def extract_text(value):
    if isinstance(value, list):
        return "".join(item.get("text", "") if isinstance(item, dict) else str(item) for item in value)
    if value is None:
        return ""
    return str(value)


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
    table_id = read_env("FEISHU_PROJECTS_TABLE_ID")
    token = get_tenant_access_token()

    fields = get_table_fields(app_token, table_id, token)
    field = next((item for item in fields if item.get("field_name") == FIELD_NAME), None)
    created = False
    if not field:
      field = create_text_field(app_token, table_id, token, FIELD_NAME)
      created = True

    updated = []
    for item in fetch_records(app_token, table_id, token):
        record_id = item.get("record_id")
        fields = item.get("fields") or {}
        title = extract_text(fields.get("DEMO名称") or fields.get("项目名称") or fields.get("Title") or fields.get("标题")).strip()
        if not record_id or not title:
            continue
        next_status = STATUS_BY_TITLE.get(title)
        if not next_status:
            continue
        update_record_fields(app_token, table_id, record_id, token, {FIELD_NAME: next_status})
        updated.append({"record_id": record_id, "title": title, "status": next_status})

    print(json.dumps({
        "field_name": FIELD_NAME,
        "created": created,
        "field_id": field.get("field_id"),
        "updated_records": len(updated),
        "updates": updated,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
