# Ansible Roles 与 Galaxy

「Ansible Role 怎么组织？」——用 Roles 把 Playbook 变成可复用的模块。

当 Playbook 越来越长，你会发现重复的配置越来越多：Nginx 要装、数据仓库也要装、监控也要装……Roles 就是解决这个问题的——把通用的配置抽成独立的 Role，在多个 Playbook 中复用。

## 为什么需要 Roles

```
# 没有 Roles：所有配置堆在一个 Playbook 里
# site.yml (500 行……)

# 有 Roles：每个 Role 专注一件事
# site.yml (20 行，干净利落)
```

Roles 不仅仅是为了复用，更是为了**可维护性**。当你需要修改 Nginx 配置时，去 `roles/nginx/` 目录找，而不是在 500 行的 site.yml 里翻找。

## Role 目录结构

```
roles/
└── nginx/
    ├── defaults/              # 默认变量（最低优先级）
    │   └── main.yml           # 必须有
    ├── files/                 # 静态文件（copy 模块直接引用）
    │   └── nginx.conf
    ├── handlers/              # Handlers
    │   └── main.yml           # 必须有（即使为空）
    ├── meta/                  # Role 元信息（依赖、作者）
    │   └── main.yml
    ├── tasks/                 # 核心任务
    │   └── main.yml           # 必须有
    ├── templates/              # Jinja2 模板（template 模块引用）
    │   └── nginx.conf.j2
    └── vars/                  # 变量（高优先级）
        └── main.yml
```

每个 Role 至少包含 `tasks/main.yml`。其他目录可选，有就引用，没有就不引用。

### defaults/main.yml

```yaml
# roles/nginx/defaults/main.yml
---
# 默认变量（最低优先级，会被 inventory/playbook 中的变量覆盖）
nginx_version: "1.24.0"
nginx_port: 80
nginx_worker_processes: auto
nginx_worker_connections: 1024
nginx_server_names:
  - localhost
  - example.com
nginx_enable_ssl: false
nginx_ssl_cert_path: ""
nginx_ssl_key_path: ""
```

### vars/main.yml

```yaml
# roles/nginx/vars/main.yml
---
# 高优先级变量（不要轻易覆盖）
nginx_packages:
  - nginx
nginx_service_name: nginx
nginx_config_path: /etc/nginx/nginx.conf
nginx_user: www-data
nginx_group: www-data
```

### tasks/main.yml

```yaml
# roles/nginx/tasks/main.yml
---
- name: Install Nginx
  ansible.builtin.package:
    name: nginx
    state: present

- name: Configure Nginx
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: "{{ nginx_config_path }}"
    owner: root
    group: root
    mode: '0644'
    validate: nginx -t -c %s
  notify: Reload Nginx

- name: Enable Nginx service
  ansible.builtin.service:
    name: nginx
    enabled: yes
  when: nginx_service_enabled | default(true)

- name: Ensure Nginx is running
  ansible.builtin.service:
    name: nginx
    state: started
```

### handlers/main.yml

```yaml
# roles/nginx/handlers/main.yml
---
- name: Reload Nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded

- name: Restart Nginx
  ansible.builtin.service:
    name: nginx
    state: restarted
```

### meta/main.yml

```yaml
# roles/nginx/meta/main.yml
---
# Role 依赖声明
dependencies:
  - role: common
    common_packages:
      - curl
      - vim
  # 条件依赖
  # - role: nginx_ssl
  #   when: nginx_enable_ssl | bool

# Galaxy 元信息（用于 ansible-galaxy 分享）
galaxy_info:
  author: yourname
  description: Install and configure Nginx
  company: yourcompany
  license: MIT
  min_ansible_version: "2.9"
  platforms:
    - name: EL
      versions:
        - "8"
    - name: Debian
      versions:
        - buster
        - bullseye
  galaxy_tags:
    - nginx
    - web
    - server
    - http
```

### templates/

```jinja2
{# roles/nginx/templates/nginx.conf.j2 #}
user {{ nginx_user }};
worker_processes {{ nginx_worker_processes }};

events {
    worker_connections {{ nginx_worker_connections }};
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    sendfile on;
    tcp_nopush on;
    keepalive_timeout {{ nginx_keepalive_timeout | default(65) }};

    {% for server_name in nginx_server_names %}
    server {
        listen {{ nginx_port }};
        server_name {{ server_name }};

        location / {
            root /var/www/html;
            index index.html index.htm;
        }
    }
    {% endfor %}

    {% if nginx_enable_ssl | bool %}
    server {
        listen 443 ssl http2;
        server_name {{ nginx_server_names[0] }};

        ssl_certificate {{ nginx_ssl_cert_path }};
        ssl_certificate_key {{ nginx_ssl_key_path }};
        ssl_protocols TLSv1.2 TLSv1.3;
    }
    {% endif %}
}
```

## 使用 Role

### 在 Playbook 中引用

```yaml
# site.yml
---
- name: Configure all servers
  hosts: all
  become: true

  roles:
    - role: common
      tags: [common, base]

    - role: users
      tags: [users]
      when: manage_users | default(true)

- name: Configure web servers
  hosts: webservers
  become: true

  roles:
    - role: nginx
      tags: [nginx]
      vars:
        nginx_version: "1.25.0"  # 覆盖默认版本

    - role: app
      tags: [app]
      vars:
        app_version: "{{ deploy_version }}"

- name: Configure database servers
  hosts: dbservers
  become: true

  roles:
    - role: postgresql
      tags: [postgres]
      vars:
        pg_version: 15
```

### Role 导入方式对比

```yaml
# 方式一：roles 关键字（推荐，role 中的 tasks 先执行）
roles:
  - role: nginx
  - role: app

# 方式二：import_role 任务（在 tasks 中导入）
tasks:
  - name: Install nginx
    import_role:
      name: nginx

  - name: Do something else
    # ...

# 方式三：include_role 任务（动态包含，支持 when 条件）
tasks:
  - name: Conditionally install nginx
    include_role:
      name: nginx
    when: install_nginx | bool
```

`import_role` vs `include_role` 的区别：前者是静态导入（在解析阶段展开），后者是动态包含（在执行阶段展开）。简单场景用 `roles:`，复杂流程控制用 `include_role`。

## Ansible Galaxy

### Galaxy 生态

```bash
# 搜索 Role
ansible-galaxy role search "kubernetes" --author=geerlingguy

# 查看 Role 详情
ansible-galaxy role info geerlingguy.redis

# 安装 Role
ansible-galaxy role install geerlingguy.redis
ansible-galaxy role install geerlingguy.nginx

# 安装多个 Role
ansible-galaxy role install -r requirements.yml

# 列出已安装的 Role
ansible-galaxy role list

# 删除 Role
ansible-galaxy role remove geerlingguy.redis
```

### requirements.yml

```yaml
# requirements.yml
---
# 从 Galaxy 安装
roles:
  - name: geerlingguy.redis
    version: "3.3.0"           # 指定版本
  - name: nginx_ubuntu
    src: nginx_ubuntu
  - name: nginx_from_git
    src: https://github.com/username/ansible-role-nginx
    scm: git
    version: "1.0.0"

# 从 Galaxy 安装 Collection
collections:
  - name: community.kubernetes
  - name: community.general
  - name: ansible.posix
```

### 初始化 Role

```bash
# 初始化目录结构
ansible-galaxy role init my_role
# 生成：
# my_role/
#   ├── defaults/
#   │   └── main.yml
#   ├── handlers/
#   │   └── main.yml
#   ├── meta/
#   │   └── main.yml
#   ├── README.md
#   ├── tasks/
#   │   └── main.yml
#   ├── tests/
#   │   ├── inventory
#   │   └── test.yml
#   └── vars/
#       └── main.yml

# 初始化 Collection
ansible-galaxy collection init myorg.mycollection
# 生成：
# myorg/mycollection/
#   ├── docs/
#   ├── galaxy.yml
#   ├── plugins/
#   │   ├── README.md
#   │   └── lookup/
#   ├── roles/
#   └── tests/
```

### 知名 Galaxy Roles 推荐

| Role | 说明 |
|------|------|
| geerlingguy.redis | Redis 安装配置 |
| geerlingguy.postgresql | PostgreSQL 安装配置 |
| geerlingguy.nginx | Nginx 安装配置 |
| geerlingguy.docker | Docker 安装配置 |
| geerlingguy.kubernetes | Kubernetes 安装 |
| elastic.elasticsearch | Elasticsearch 安装 |
| ansible-zookeeper | Zookeeper 集群 |

## Role 设计最佳实践

### 单一职责

```yaml
# 好：每个 Role 只做一件事
roles:
  - common           # 系统基础配置
  - nginx            # Nginx 安装和配置
  - app              # 应用部署
  - monitoring       # 监控 Agent 部署

# 不好：Nginx + MySQL + Docker + Kafka 都在一个 Role 里
roles:
  - everything        # 天哪不要这样
```

### 变量命名规范

```yaml
# 使用前缀避免命名冲突
# roles/nginx/defaults/main.yml
nginx_version: "1.24.0"
nginx_port: 80

# roles/postgresql/defaults/main.yml
postgresql_version: "15"
postgresql_port: 5432
```

### 处理平台差异

```yaml
# roles/nginx/tasks/main.yml
---
- name: Install Nginx
  ansible.builtin.package:
    name: nginx
    state: present
  when: ansible_os_family != "Flatcar"   # Flatcar 默认不含 nginx 包

- name: Install Nginx on Flatcar
  ansible.builtin.shell: |
    # Flatcar 使用 flatcar-linux-update-operator 等特殊处理
    echo "Special handling for Flatcar"
  when: ansible_os_family == "Flatcar"
```

## 面试追问方向

1. **Ansible Role 和 Include/Import 的区别是什么？**
   答：Role 是 Ansible 推荐的代码组织方式，它强制了目录结构（tasks、handlers、vars 等），且支持 `meta/main.yml` 定义依赖。Include/Import 是任务级别的包含，更灵活但缺少这些约束。简单场景用 `roles:`，需要条件判断或动态行为时用 `include_role`。

2. **Role 依赖的执行顺序是什么？**
   答：在 `meta/main.yml` 中声明的依赖，会在当前 Role 之前执行。如果 A 依赖 B，B 依赖 C，则执行顺序是 C → B → A。被依赖的 Role 只会执行一次（即使被多个 Role 依赖）。

3. **defaults 和 vars 的区别是什么？**
   答：`defaults/main.yml` 中的变量优先级最低，容易被覆盖，适合定义「默认值」；`vars/main.yml` 中的变量优先级较高，不容易被覆盖，适合定义「不应该被改写」的配置（如包名、服务名等内部常量）。

Ansible Roles 把配置管理从「写命令」升级为「搭积木」——好的 Role 设计，让基础设施代码也能像业务代码一样复用和维护。

## 附录：常用 Role 模板

```yaml
# roles/<role-name>/tasks/main.yml
---
- name: Validate prerequisites
  ansible.builtin.assert:
    that:
      - required_variable is defined
    fail_msg: "required_variable must be defined"
    success_msg: "Prerequisites validated"

- name: Ensure prerequisites are installed
  ansible.builtin.package:
    name: "{{ role_packages }}"
    state: present

- name: Configure application
  ansible.builtin.template:
    src: "{{ role_template }}"
    dest: "{{ role_config_path }}"
    mode: '0644'
    validate: "{{ role_validate_command }}"
  notify: Restart {{ role_name }}

- name: Ensure service is running
  ansible.builtin.service:
    name: "{{ role_service_name }}"
    state: started
    enabled: yes
```

```yaml
# roles/<role-name>/handlers/main.yml
---
- name: Restart {{ role_name }}
  ansible.builtin.service:
    name: "{{ role_service_name }}"
    state: restarted

- name: Reload {{ role_name }}
  ansible.builtin.service:
    name: "{{ role_service_name }}"
    state: reloaded
```
