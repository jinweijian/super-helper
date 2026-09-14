# Docker 多实例部署

本文说明在一台服务器上运行多个 `super-helper` 实例的方式。每个实例对应一个独立部署目录，并通过 Nginx 对外提供受限访问。

## 部署模型

一个镜像可以复制为多个部署目录。每个目录只运行一个 Compose 服务，拥有自己的配置、Case/session 数据、知识库、Claude home 和本地端口：

```text
/srv/super-helper/project-a  -> 127.0.0.1:4417
/srv/super-helper/project-b  -> 127.0.0.1:4418
```

项目源码以只读方式挂载到容器内 `/workspace/project`。两个容器虽然使用相同的容器路径，但挂载命名空间彼此隔离。

## 构建镜像

在仓库根目录执行：

```bash
docker build -f docker/Dockerfile -t docker.example.invalid/super-helper:VERSION .
```

生产环境应固定镜像版本，并在部署目录的 `.env` 中填写镜像地址和标签。不要把凭证写入仓库、镜像层、`config.json` 或文档。

## 初始化部署目录

```bash
./scripts/init-site.sh \
  --site-dir /srv/super-helper/project-a \
  --project-root /srv/projects/project-a \
  --port 4417 \
  --name project-a \
  --image docker.example.invalid/super-helper:VERSION
```

脚本会创建 `compose.yml`、`.env`、`config.json`、`data/`、`knowledge/` 和 `claude-home/`。初始化后，在服务器上创建 `.env` 中声明的 Secret 文件，再启动：

```bash
cd /srv/super-helper/project-a
docker compose config
docker compose up -d
docker compose ps
```

Secret 文件内容只应由服务器的 Secret 管理流程写入。本文不包含任何真实凭证或示例密钥。

## 复制第二个实例

```bash
./scripts/copy-site.sh \
  --source /srv/super-helper/project-a \
  --target /srv/super-helper/project-b \
  --project-root /srv/projects/project-b \
  --port 4418 \
  --name project-b
```

复制脚本只复制部署模板和基础配置，不复制 `data/`、`knowledge/`、`claude-home/` 或 Secret。目标实例启动前必须准备自己的 Secret 文件。

## Claude 配置

容器内安装 Claude Code CLI，并由当前 `src/workers/claude/` 通过 `claude` 命令调用。API 凭证通过 Compose secret 文件在容器启动时注入，配置文件只保存非敏感设置。

每个实例必须使用独立的 `claude-home` 目录。可以使用不同的 API 凭证；即使共用同一个账户，也不能共用该目录。个人交互式登录态不应直接复制到服务器。

当前只读策略由应用配置和 Worker 同时约束，默认允许 `Read`、`Glob`、`Grep`，禁止写文件、执行命令和联网工具。项目源码挂载为只读。

## Nginx

Docker 端口只绑定本地回环地址，外部不能直接访问：

```yaml
ports:
  - "127.0.0.1:${EXPOSE_PORT}:4317"
```

Nginx 使用不同域名代理到不同端口，并负责 HTTPS、Basic Auth/OIDC 或 IP 白名单。示例：

```nginx
server {
    listen 443 ssl;
    server_name helper-a.example.com;

    location / {
        auth_basic "Restricted";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:4417;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30m;
        client_max_body_size 10m;
    }
}
```

第二个域名将 `server_name` 和 `proxy_pass` 改为 `helper-b.example.com` 与 `127.0.0.1:4418`。防火墙只开放 Nginx 所需端口和管理用 SSH 端口。

## 升级与验收

```bash
./scripts/upgrade-site.sh \
  --site-dir /srv/super-helper/project-b \
  --version docker.example.invalid/super-helper:VERSION
```

升级前后运行 `docker compose config`，并确认健康检查通过。双实例验收至少包括：A 只能读取项目 A，B 只能读取项目 B；Case、knowledge 和 Claude 状态不串；A 的重启或升级不影响 B；本地端口不能从公网直接访问；Nginx 认证后才能访问两个域名。
