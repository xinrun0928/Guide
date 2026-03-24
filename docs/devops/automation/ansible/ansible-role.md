# Ansible Roles 进阶

「Ansible Roles 怎么组织？」——Role 是 Ansible 的代码复用单元。

随着基础设施扩大，Playbook 会越来越长、越来越难维护。Roles 解决这个问题——将 Playbook 拆分成独立的、可复用的组件，每个 Role 做一件事，做到极致。好的 Role 设计，让配置管理变得像搭积木一样简单。

## Role 最佳实践

### 目录结构

```
provisioning/
├── playbooks/
│   ├── site.yml              # 主入口
│   ├── dbservers.yml         # 数据库服务器
│   └── webservers.yml        # Web 服务器
├── roles/
│   ├── common/               # 通用角色（所有服务器）
│   │   ├── defaults/         # 默认变量（最低优先级，可被覆盖）
│   │   │   └── main.yml
│   │   ├── files/            # 静态文件（copy 资源）
│   │   │   └── limits.conf
│   │   ├── handlers/
│   │   │   └── main.yml
│   │   ├── meta/             # Role 依赖（Galaxy）
│   │   │   └── main.yml
│   │   ├── tasks/
│   │   │   └── main.yml      # 主任务列表
│   │   ├── templates/         # Jinja2 模板（template 资源）
│   │   │   └── sysctl.conf.j2
│   │   └── vars/              # Role 私有变量（高优先级）
│   │       └── main.yml
│   ├── nginx/
│   ├── postgresql/
│   └── redis/
└── inventory/
    ├── production
    └── staging
```

### defaults/main.yml（最低优先级变量）

```yaml
# roles/common/defaults/main.yml
---
# 基础包
common_packages:
  - vim
  - curl
  - wget
  - git
  - htop
  - tmux

# 时区
common_timezone: "Asia/Shanghai"

# 系统优化参数
common_sysctl_params:
  net.ipv4.tcp_fin_timeout: 30
  net.ipv4.tcp_keepalive_time: 1200
  net.ipv4.ip_local_port_range: "1024 65535"
  vm.swappiness: 10

# 日志保留天数
common_log_retention_days: 30
```

### vars/main.yml（高优先级变量）

```yaml
# roles/nginx/vars/main.yml
---
# 这些变量不应该被轻易覆盖
nginx_user: www-data
nginx_group: www-data
nginx_conf_dir: /etc/nginx
nginx_confd_dir: /etc/nginx/conf.d
nginx_default_conf: /etc/nginx/sites-enabled/default
```

### tasks/main.yml（核心逻辑）

```yaml
# roles/common/tasks/main.yml
---
- name: Ensure common packages are installed
  ansible.builtin.apt:
    name: "{{ common_packages }}"
    state: present
    update_cache: yes
    cache_valid_time: 3600
  when: ansible_os_family == "Debian"

- name: Set timezone
  community.general.timezone:
    name: "{{ common_timezone }}"
  when: common_timezone is defined

- name: Apply sysctl parameters
  ansible.posix.sysctl:
    name: "{{ item.key }}"
    value: "{{ item.value }}"
    state: present
    reload: yes
    sysctl_file: /etc/sysctl.d/99-custom.conf
  loop: "{{ common_sysctl_params | dict2items }}"
  when: common_sysctl_params is defined

- name: Disable unnecessary services
  ansible.builtin.systemd:
    name: "{{ item }}"
    state: stopped
    enabled: no
  loop:
    - snapd
    - avahi-daemon
  failed_when: false
  when: disable_unnecessary_services | default(false) | bool
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

- name: Validate Nginx config
  ansible.builtin.command: nginx -t
  changed_when: false
  register: nginx_config_validation

- name: Reload systemd
  ansible.builtin.systemd:
    daemon_reload: yes
  listen: "Daemon reload"
```

### meta/main.yml（依赖声明）

```yaml
# roles/postgresql/meta/main.yml
---
dependencies:
  - role: common
  - role: hostname
    hostname_type: fqdn

galaxy_info:
  author: yourname
  description: PostgreSQL database server role
  company: MyOrg
  license: MIT
  min_ansible_version: "2.9"
  platforms:
    - name: Debian
      versions:
        - buster
        - bullseye
    - name: Ubuntu
      versions:
        - focal
        - jammy
    - name: EL
      versions:
        - "8"
        - "9"
  galaxy_tags:
    - database
    - postgresql
    - postgres
```

### templates（模板）

```jinja2
{# roles/nginx/templates/nginx.conf.j2 #}
user {{ nginx_user }};
worker_processes {{ ansible_processor_vcpus | default('auto') }};
pid /run/nginx.pid;
error_log /var/log/nginx/error.log {{ nginx_error_log_level | default('warn') }};

events {
    worker_connections {{ nginx_worker_connections | default(1024) }};
    use {{ nginx_event_mode | default('epoll') }};
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile {{ nginx_sendfile | default('on') }};
    tcp_nopush {{ nginx_tcp_nopush | default('on') }};
    tcp_nodelay {{ nginx_tcp_nodelay | default('on') }};
    keepalive_timeout {{ nginx_keepalive_timeout | default(65) }};
    types_hash_max_size {{ nginx_types_hash_max_size | default(2048) }};

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level {{ nginx_gzip_comp_level | default(6) }};
    gzip_types text/plain text/css application/json application/javascript;

    # Buffer settings
    client_body_buffer_size {{ nginx_client_body_buffer_size | default('128k') }};
    client_max_body_size {{ nginx_client_max_body_size | default('10m') }};

    include {{ nginx_confd_dir }}/*.conf;
}
```

## Playbook 中组合 Roles

### site.yml（主入口）

```yaml
# playbooks/site.yml
---
- name: Apply common role to all servers
  hosts: all
  become: true
  roles:
    - role: common

- name: Configure web tier
  hosts: webservers
  become: true
  roles:
    - role: nginx
      vars:
        nginx_worker_processes: auto
        nginx_worker_connections: 2048
    - role: app
      vars:
        app_user: www-data
        app_path: /opt/myapp

- name: Configure database tier
  hosts: dbservers
  become: true
  roles:
    - role: postgresql
      vars:
        pg_version: 15
        pg_max_connections: 200
        pg_shared_buffers: "256MB"

- name: Configure cache tier
  hosts: cacheservers
  become: true
  roles:
    - role: redis
      vars:
        redis_bind: "{{ ansible_host }}"
        redis_maxmemory: "2gb"
```

### 环境特定配置

```yaml
# playbooks/deploy-production.yml
---
- name: Deploy to production
  hosts: webservers:db_servers
  become: true

  vars:
    env: production
    app_version: "{{ lookup('env', 'DEPLOY_VERSION') | default('main') }}"
    enable_monitoring: true
    enable_alerting: true
    ssl_enabled: true

  pre_tasks:
    - name: Verify deployment prerequisites
      ansible.builtin.assert:
        that:
          - deploy_version is defined
          - app_version | length > 0
        fail_msg: "Deployment prerequisites not met"

  roles:
    - role: common
    - role: app
    - role: monitoring
      when: enable_monitoring | bool

  post_tasks:
    - name: Verify deployment
      ansible.builtin.uri:
        url: "https://{{ ansible_host }}/health"
        validate_certs: "{{ ssl_enabled }}"
      register: health_check
      until: health_check.status == 200
      retries: 5
      delay: 10
```

## 复用与继承

### Role 继承（Pre/Post Task）

```yaml
# Playbook 中使用 pre_tasks / post_tasks
- name: Deploy application
  hosts: webservers
  become: true

  pre_tasks:
    - name: Notify start
      ansible.builtin.debug:
        msg: "Starting deployment to {{ inventory_hostname }}"

  roles:
    - role: app

  tasks:
    - name: Additional configuration
      ansible.builtin.template:
        src: local.conf.j2
        dest: /etc/myapp/local.conf

  post_tasks:
    - name: Notify completion
      ansible.builtin.debug:
        msg: "Deployment completed on {{ inventory_hostname }}"
```

### 条件 Role（import_role / include_role）

```yaml
tasks:
  - name: Include database role
    ansible.builtin.include_role:
      name: postgresql
    vars:
      pg_version: 15
    when: "'dbservers' in group_names"

  - name: Import monitoring role
    ansible.builtin.import_role:
      name: prometheus
    vars:
      prometheus_port: 9090
```

## Galaxy：Ansible 社区角色

```bash
# 搜索角色
ansible-galaxy search postgresql

# 查看角色详情
ansible-galaxy info geerlingguy.postgresql

# 安装角色
ansible-galaxy role install geerlingguy.postgresql
ansible-galaxy role install -r requirements.yml

# requirements.yml
# ---
# roles:
#   - name: geerlingguy.postgresql
#   - name: geerlingguy.redis
#   - name: nginxinc.nginx

# 初始化新角色
ansible-galaxy role init my_role
ansible-galaxy collection init myorg.mycollection
```

### requirements.yml

```yaml
# requirements.yml
---
roles:
  - name: geerlingguy.postgresql
    version: "4.0.0"
  - name: geerlingguy.redis
    version: "3.0.0"
  - name: geerlingguy.certbot
    version: "2.4.0"

collections:
  - name: community.general
    version: "8.0.0"
  - name: community.postgresql
    version: "1.0.0"
```

```bash
# 安装所有依赖
ansible-galaxy install -r requirements.yml

# 或通过 ansible.cfg 指定
# [defaults]
# roles_path = roles:vendor/roles
```

## Role 测试

### Molecule 测试

```yaml
# molecule/default/converge.yml
---
- name: Converge
  hosts: all
  become: true

  vars:
    test_message: "Hello from molecule"

  tasks:
    - name: Include my_role
      ansible.builtin.include_role:
        name: my_role
```

```bash
# 安装 Molecule
pip install molecule molecule-docker

# 初始化测试
molecule init role --role-name my_role

# 运行测试
cd roles/my_role
molecule test              # 完整测试
molecule converge          # 本地测试
molecule verify            # 验证
molecule destroy           # 清理
```

```yaml
# molecule/default/molecule.yml
---
dependency:
  name: galaxy
driver:
  name: docker
platforms:
  - name: instance
    image: docker.io/pycontribs/ubuntu:latest
    pre_build_image: yes
    command: /lib/systemd/systemd
provisioner:
  name: ansible
  inventory:
    group_vars:
      all:
        ansible_python_interpreter: /usr/bin/python3
verifier:
  name: ansible
```

## 组织大型 Role 库

### 分类策略

```
roles/
├── _infrastructure/        # 以下划线开头，表示内部使用
│   ├── _common/            # 通用逻辑
│   ├── _firewall/          # 防火墙抽象
│   └── _monitoring/        # 监控代理抽象
├── nginx/                  # 应用服务器
├── postgresql/             # 数据库
├── redis/                  # 缓存
├── monitoring/             # 监控
│   ├── prometheus/
│   ├── grafana/
│   └── alertmanager/
└── _bootstrap/             # 初始化（最先执行）
    ├── hostname/
    ├── timezone/
    └── ssh-keys/
```

### 分层设计

```
Layer 1: 基础层（所有机器）
└── common, users, security, logging

Layer 2: 中间件层
└── nginx, redis, elasticsearch

Layer 3: 应用层
└── app, monitoring

Layer 4: 业务层
└── custom application roles
```

## 常见模式

### 模式一：数据库服务器

```yaml
# roles/postgresql/tasks/main.yml
---
- name: Ensure PostgreSQL packages are installed
  ansible.builtin.apt:
    name:
      - "postgresql-{{ pg_version }}"
      - "postgresql-contrib-{{ pg_version }}"
      - "postgresql-{{ pg_version }}-debversion"
    state: present
  when: ansible_os_family == "Debian"

- name: Ensure PostgreSQL is running
  ansible.builtin.service:
    name: postgresql
    state: started
    enabled: yes

- name: Create application database
  community.postgresql.postgresql_db:
    name: "{{ pg_database }}"
    encoding: UTF8
    lc_collate: en_US.UTF-8
    lc_ctype: en_US.UTF-8
    state: present
  become: true
  become_user: postgres

- name: Create application user
  community.postgresql.postgresql_user:
    name: "{{ pg_user }}"
    password: "{{ pg_password }}"
    priv: "{{ pg_database }}:ALL"
    state: present
  become: true
  become_user: postgres
```

### 模式二：应用部署

```yaml
# roles/app/tasks/main.yml
---
- name: Create application directory
  ansible.builtin.file:
    path: "{{ app_path }}"
    state: directory
    owner: "{{ app_user }}"
    group: "{{ app_group }}"
    mode: '0755'

- name: Deploy application code
  ansible.builtin.git:
    repo: "{{ app_repo }}"
    dest: "{{ app_path }}/releases/{{ deploy_version }}"
    version: "{{ deploy_version }}"
    force: yes
  register: app_deploy

- name: Create symlink to current version
  ansible.builtin.file:
    src: "{{ app_path }}/releases/{{ deploy_version }}"
    dest: "{{ app_path }}/current"
    state: link
    force: yes
  when: app_deploy is changed

- name: Install dependencies
  ansible.builtin.command: "{{ app_path }}/current/bin/install-deps.sh"
  when: app_deploy is changed
  notify: Restart application

- name: Run database migrations
  ansible.builtin.command: "{{ app_path }}/current/bin/migrate.sh"
  when: run_migrations | default(true) | bool
  register: migration_result

- name: Restart application
  ansible.builtin.systemd:
    name: "{{ app_service }}"
    state: restarted
  when: app_deploy is changed or migration_result is changed
```

## 面试追问方向

1. **Ansible Role 和 Playbook 的区别是什么？**
   答：Playbook 是入口，描述完整的部署流程，可以直接写 Task；Role 是 Playbook 的模块化封装，将 Task、Handler、Template、Variable 等组织成独立单元。Role 是可复用的，Playbook 是编排者。一个 Playbook 可以引入多个 Role，Role 可以被多个 Playbook 使用。

2. **defaults 和 vars 变量的优先级有什么区别？**
   答：vars 中的变量优先级高于 defaults。defaults 中的变量是「默认配置」，可以被任何层级覆盖（inventory、Play、命令行）；vars 中的变量通常用于「不可变的内部配置」，不应该被外部覆盖。

3. **如何测试 Ansible Roles？**
   答：使用 Molecule（官方推荐）进行自动化测试；使用 `ansible-playbook --check --diff` 进行 dry-run 检查；使用 `ansible-lint` 检查代码质量；使用 Testinfra（Python）或 InSpec（Chef）进行集成测试。

4. **Ansible Galaxy 和 Collections 的区别是什么？**
   答：Galaxy 是共享 Roles 的平台；Collections 是 Ansible 2.10+ 引入的新一代打包格式，可以包含 Roles、Modules、Plugins、Playbooks。Collections 比 Galaxy Roles 更丰富，适合分发复杂的功能模块。

好的 Role 设计，是基础设施即代码的核心。每一个 Role 都应该职责单一、可独立测试、可在多个 Playbook 中复用。
