"""Cognee 1.5.4 本地启动/匿名拒绝探针，不构图、不调用模型。"""
import json
import os
import secrets
import sys
import socket
from hashlib import sha256
from uuid import uuid4

# 在 import cognee 前由调用方清空继承环境并设置独立数据根。
for name in ("DATA_ROOT_DIRECTORY", "SYSTEM_ROOT_DIRECTORY", "CACHE_ROOT_DIRECTORY"):
    if not os.environ.get(name):
        raise RuntimeError("explicit isolated storage is required")
if os.environ.get("TELEMETRY_DISABLED") != "1" or os.environ.get("PYTHON_DOTENV_DISABLED") != "true":
    raise RuntimeError("telemetry and dotenv must be disabled")
if os.environ.get("ENABLE_BACKEND_ACCESS_CONTROL") != "true":
    raise RuntimeError("backend access control must be enabled")
# 仅用于同进程 TestClient 的临时签名密钥；不继承上游公开默认值。
# 正式部署应使用稳定 SecretRef，不能每次启动轮换。
os.environ["FASTAPI_USERS_JWT_SECRET"] = secrets.token_urlsafe(48)

def deny_network(event, args):
    if event == "socket.connect" and args[0].family in (socket.AF_INET, socket.AF_INET6):
        raise RuntimeError("offline probe forbids network connections")

sys.addaudithook(deny_network)
if "--ingest" in sys.argv:
    os.environ["COGNEE_SKIP_CONNECTION_TEST"] = "true"
    os.environ["GRAPH_DATABASE_SUBPROCESS_ENABLED"] = "false"
    # 只通过配置存在性检查；网络 guard 保证这些占位值不能产生远端请求。
    os.environ["LLM_API_KEY"] = "offline-probe-not-a-real-key"
    os.environ["EMBEDDING_API_KEY"] = "offline-probe-not-a-real-key"

    # Cognee 1.5.4 未暴露 Ladybug home_directory。仅在实验进程内包装连接，
    # 证明使用数据库支持的连接级设置即可隔离扩展；不得作为生产补丁。
    import ladybug
    _LadybugConnection = ladybug.Connection
    _ladybug_home = os.environ["CACHE_ROOT_DIRECTORY"].replace("'", "''")

    def isolated_ladybug_connection(*args, **kwargs):
        connection = _LadybugConnection(*args, **kwargs)
        connection.execute(f"CALL home_directory = '{_ladybug_home}'")
        return connection

    ladybug.Connection = isolated_ladybug_connection

from fastapi.testclient import TestClient
from cognee.api.client import app
from cognee import __version__

assert __version__ == "1.5.4"
with TestClient(app) as client:
    schema = client.get("/openapi.json")
    assert schema.status_code == 200
    paths = schema.json()["paths"]
    required = ["/api/v1/add", "/api/v1/cognify", "/api/v1/search", "/api/v1/datasets"]
    assert all(path in paths for path in required)
    anonymous = client.get("/api/v1/datasets")
    assert anonymous.status_code in (401, 403)
    if "--acl" in sys.argv or "--ingest" in sys.argv:
        # 真实注册、登录与数据库 ACL；只创建本次合成用户/空 dataset。
        headers = []
        for _ in range(2):
            email = f"probe-{uuid4().hex}@example.com"
            password = secrets.token_urlsafe(32)
            registered = client.post("/api/v1/auth/register", json={"email": email, "password": password})
            assert registered.status_code == 201, ("register", registered.status_code)
            logged_in = client.post("/api/v1/auth/login", data={"username": email, "password": password})
            assert logged_in.status_code == 200, ("login", logged_in.status_code)
            headers.append({"Authorization": f"Bearer {logged_in.json()['access_token']}"})
            client.cookies.clear()
        dataset_name = f"synthetic-acl-{uuid4().hex}"
        datasets = []
        for auth in headers:
            created = client.post("/api/v1/datasets", headers=auth, json={"name": dataset_name})
            assert created.status_code == 200, ("create", created.status_code)
            datasets.append(created.json()["id"])
        assert datasets[0] != datasets[1], "same name must not collapse users"
        outcomes = []
        for index, auth in enumerate(headers):
            listed = client.get("/api/v1/datasets", headers=auth)
            assert listed.status_code == 200
            ids = {item["id"] for item in listed.json()}
            assert datasets[index] in ids and datasets[1-index] not in ids
            own = client.get(f"/api/v1/datasets/{datasets[index]}/data", headers=auth)
            foreign = client.get(f"/api/v1/datasets/{datasets[1-index]}/data", headers=auth)
            assert own.status_code == 200 and own.json() == []
            assert foreign.status_code in (403, 404), ("foreign read", foreign.status_code)
            outcomes.append({"own_read": own.status_code, "foreign_read": foreign.status_code})
        print(json.dumps({"acl": "passed", "same_name_isolated": True, "users": outcomes}))
        if "--ingest" in sys.argv:
            content = "# 合成经验\n\n现象：缓存配置变更后测试页面仍显示旧值。\n处理：清理测试缓存并重新验证。\n".encode()
            metadata = {"experience_id": "synthetic-cache", "revision": "1", "content_hash": sha256(content).hexdigest()}
            added = client.post("/api/v1/add", headers=headers[0],
                                data={"datasetId": datasets[0], "external_metadata": json.dumps([metadata]), "run_in_background": "false"},
                                files={"data": ("synthetic-cache.md", content, "text/markdown")})
            assert added.status_code == 200, ("add", added.status_code)
            listed = client.get(f"/api/v1/datasets/{datasets[0]}/data", headers=headers[0])
            assert listed.status_code == 200 and len(listed.json()) == 1
            item = listed.json()[0]
            returned_metadata = item.get("externalMetadata")
            assert isinstance(returned_metadata, dict)
            assert all(returned_metadata.get(key) == value for key, value in metadata.items())
            raw_path = f"/api/v1/datasets/{datasets[0]}/data/{item['id']}/raw"
            raw = client.get(raw_path, headers=headers[0])
            assert raw.status_code == 200 and raw.content == content
            foreign = client.get(raw_path, headers=headers[1])
            assert foreign.status_code in (403, 404)
            print(json.dumps({"ingestion": "passed", "metadata_preserved": True, "raw_bytes_match": True,
                              "foreign_raw_status": foreign.status_code, "add_response_keys": sorted(added.json()),
                              "data_response_keys": sorted(item)}))
        # 不调用全库删除。合成用户与空 dataset 留在专用临时存储供调查。
    print(json.dumps({"version": __version__, "startup": "passed", "anonymous_datasets_status": anonymous.status_code,
                      "required_routes": required}, ensure_ascii=False))
