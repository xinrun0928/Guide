# Ansible Playbook 语法与模块

「Ansible Playbook 怎么写？」——Playbook 是 Ansible 的核心，用 YAML 描述你的基础设施。

如果说 Ad-Hoc 命令是「单条 SQL」，那么 Playbook 就是「存储过程」。Playbook 将多个 Task 组织成 Play，用 YAML 描述完整的基础设施配置流程，让配置管理可复用、可审计、可版本化。

## Playbook 基础

### 第一个 Playbook

```yaml
# site.yml
---
- name: Install and configure web server
  hosts: webservers
  become: true           # 提权
  vars:
    nginx_version: "1.24.0"
    nginx_port: 80

  pre_tasks:
    - name: Update apt cache
      ansible.builtin.apt:
        update_cache: yes
        cache_valid_time: 3600
      when: ansible_os_family == "Debian"

  tasks:
    - name: Install Nginx
      ansible.builtin.apt:
        name: nginx
        state: present

    - name: Configure Nginx
      ansible.builtin.template:
        src: templates/nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        owner: root
        group: root
        mode: '0644'
        validate: nginx -t -c %s
      notify: Reload Nginx

    - name: Start Nginx
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: yes

  handlers:
    - name: Reload Nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

### 执行 Playbook

```bash
# 标准执行
ansible-playbook site.yml

# 详细输出
ansible-playbook site.yml -v

# 指定主机（测试）
ansible-playbook site.yml --limit webserver01

# 检查模式（不实际执行）
ansible-playbook site.yml --check

# 差分模式（显示变更）
ansible-playbook site.yml --diff

# 指定 inventory
ansible-playbook site.yml -i inventory/production

# 标签执行
ansible-playbook site.yml --tags "nginx,config"
ansible-playbook site.yml --skip-tags "database"

# 变量覆盖
ansible-playbook site.yml -e "nginx_version=1.25.0"
```

## Playbook 结构

### 多 Play 设计

```yaml
# site.yml
---
# Play 1: 数据库服务器
- name: Configure database servers
  hosts: dbservers
  become: true
  vars:
    db_port: 5432
    db_version: "15"

  tasks:
    - name: Install PostgreSQL
      ansible.builtin.apt:
        name:
          - postgresql-{{ db_version }}
          - postgresql-contrib
        state: present

    - name: Configure PostgreSQL
      ansible.builtin.template:
        src: templates/postgresql.conf.j2
        dest: /etc/postgresql/{{ db_version }}/main/postgresql.conf
      notify: Restart PostgreSQL

    - name: Start PostgreSQL
      ansible.builtin.service:
        name: postgresql
        state: started
        enabled: yes

  handlers:
    - name: Restart PostgreSQL
      ansible.builtin.service:
        name: postgresql
        state: restarted

# Play 2: Web 服务器
- name: Configure web servers
  hosts: webservers
  become: true

  tasks:
    - name: Install Nginx
      ansible.builtin.apt:
        name: nginx
        state: present

    - name: Deploy application
      ansible.builtin.git:
        repo: "https://github.com/myorg/myapp.git"
        dest: /var/www/myapp
        version: "{{ deploy_version | default('main') }}"
        force: yes
      notify: Reload Nginx

  handlers:
    - name: Reload Nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded

# Play 3: 应用部署（滚动）
- name: Deploy application to all servers
  hosts: webservers:db_servers
  serial: 1   # 每次在 1 台主机上执行（滚动部署）

  tasks:
    - name: Run database migrations
      ansible.builtin.command: /opt/app/venv/bin/alembic upgrade head
      when: "'dbservers' in group_names"

    - name: Restart application
      ansible.builtin.systemd:
        name: myapp
        state: restarted
```

## 变量与 Facts

### 变量定义

```yaml
# 变量定义方式（优先级从低到高）
---
# 1. inventory 中定义
# inventory/production
# [webservers]
# web01 ansible_host=192.168.1.10

# 2. group_vars / host_vars
# group_vars/all.yml
# app_name: myapp
# env: production

# 3. Play 中定义
- name: My play
  hosts: webservers
  vars:
    nginx_version: "1.24.0"
    app_users:
      - alice
      - bob

# 4. 命令行传入
# ansible-playbook site.yml -e "deploy_version=v2.0.0"

# 5. 注册变量（Task 输出）
  tasks:
    - name: Get facts
      ansible.builtin.setup:
        filter: ansible_memtotal_mb
    - name: Show memory
      ansible.builtin.debug:
        msg: "Total memory: {{ ansible_memtotal_mb }} MB"

    - name: Register command output
      ansible.builtin.command: df -h
      register: disk_usage

    - name: Show disk usage
      ansible.builtin.debug:
        var: disk_usage.stdout_lines
```

### Jinja2 模板中的变量

```jinja2
{# templates/nginx.conf.j2 #}
user {{ nginx_user | default('www-data') }};
worker_processes {{ ansible_processor_vcpus }};

events {
    worker_connections {{ max_connections | default(1024) }};
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    {% for upstream in upstream_servers %}
    upstream {{ upstream.name }} {
        {% for server in upstream.backends %}
        server {{ server.host }}:{{ server.port }};
        {% endfor %}
    }
    {% endfor %}

    server {
        listen {{ nginx_port | default(80) }};
        server_name {{ server_name }};

        location / {
            proxy_pass http://{{ upstream_name }};
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
```

## 条件执行

### when 语句

```yaml
tasks:
  # 基础条件
  - name: Install MySQL on Debian
    ansible.builtin.apt:
      name: mysql-server
      state: present
    when: ansible_os_family == "Debian"

  - name: Install MySQL on RedHat
    ansible.builtin.yum:
      name: mysql-server
      state: present
    when: ansible_os_family == "RedHat"

  # 组合条件
  - name: Deploy production config
    ansible.builtin.template:
      src: app.conf.j2
      dest: /etc/myapp.conf
    when:
      - env == "production"
      - enable_feature_x | default(false)

  # 变量存在性检查
  - name: Run backup script
    ansible.builtin.script: /opt/backup.sh
    when: backup_enabled is defined

  # 循环中的条件
  - name: Create databases
    ansible.builtin.postgresql_db:
      name: "{{ item }}"
      state: present
    loop:
      - web_db
      - api_db
      - admin_db
    when: create_databases | bool
```

## 循环

### 循环语句

```yaml
tasks:
  # 标准循环 with_items
  - name: Install packages
    ansible.builtin.apt:
      name: "{{ item }}"
      state: present
    loop:
      - nginx
      - vim
      - curl
      - git

  # 字典列表循环
  - name: Create users
    ansible.builtin.user:
      name: "{{ item.name }}"
      shell: "{{ item.shell | default('/bin/bash') }}"
      groups: "{{ item.groups | default(omit) }}"
    loop:
      - { name: alice, groups: 'wheel,docker' }
      - { name: bob, shell: '/bin/zsh' }
      - { name: carol, groups: 'developers' }

  # with_dict 字典循环
  - name: Configure websites
    ansible.builtin.template:
      src: "{{ item.value.template }}"
      dest: "{{ item.value.dest }}"
    with_dict:
      website1:
        template: site1.conf.j2
        dest: /etc/nginx/sites-available/site1.conf
      website2:
        template: site2.conf.j2
        dest: /etc/nginx/sites-available/site2.conf

  # with_fileglob 文件匹配
  - name: Copy all config files
    ansible.builtin.copy:
      src: "{{ item }}"
      dest: "/etc/myapp/{{ item | basename }}"
    with_fileglob:
      - files/configs/*.conf

  # with_sequence 序列循环
  - name: Create multiple directories
    ansible.builtin.file:
      path: "/data/disk{{ item }}"
      state: directory
    with_sequence: start=1 end=5 format="/dev/vd%h"
```

## 错误处理

### 错误处理机制

```yaml
---
- name: Deploy application
  hosts: webservers

  tasks:
    # 忽略错误
    - name: Run potentially failing command
      ansible.builtin.command: /opt/risky-script.sh
      ignore_errors: yes
      register: result

    # 强制失败（failed_when）
    - name: Check disk space
      ansible.builtin.command: df -h /data
      register: disk_output
      failed_when: "'100%' in disk_output.stdout"

    # 强制改变状态（changed_when）
    - name: Check service status
      ansible.builtin.command: systemctl is-active nginx
      register: nginx_status
      changed_when: false

    # 块（Block）+ 错误处理
    - name: Deploy with rollback
      block:
        - name: Backup current version
          ansible.builtin.copy:
            remote_src: yes
            src: /opt/app/current
            dest: /opt/app/backup-{{ ansible_date_time.epoch }}

        - name: Deploy new version
          ansible.builtin.git:
            repo: "{{ app_repo }}"
            dest: /opt/app/current
            version: "{{ deploy_version }}"

        - name: Restart application
          ansible.builtin.systemd:
            name: myapp
            state: restarted

      rescue:
        - name: Restore from backup
          ansible.builtin.copy:
            remote_src: yes
            src: "/opt/app/backup-{{ ansible_date_time.epoch }}"
            dest: /opt/app/current

        - name: Restart application
          ansible.builtin.systemd:
            name: myapp
            state: restarted

        - name: Notify on failure
          ansible.builtin.debug:
            msg: "Deployment failed, restored to previous version"

      always:
        - name: Clean up temp files
          ansible.builtin.file:
            path: /tmp/app-deploy
            state: absent
```

## Roles：Playbook 的模块化

### Role 目录结构

```
roles/
└── common/
    ├── defaults/         # 默认变量（最低优先级）
    │   └── main.yml
    ├── files/            # 静态文件
    │   └── myapp.conf
    ├── handlers/         # Handlers
    │   └── main.yml
    ├── meta/            # Role 依赖
    │   └── main.yml
    ├── tasks/           # Tasks（核心）
    │   └── main.yml
    ├── templates/        # Jinja2 模板
    │   └── nginx.conf.j2
    └── vars/            # 变量（高优先级）
        └── main.yml
```

### Role 示例

```yaml
# roles/nginx/tasks/main.yml
---
- name: Install Nginx
  ansible.builtin.apt:
    name: nginx
    state: present
  when: ansible_os_family == "Debian"

- name: Install Nginx
  ansible.builtin.yum:
    name: nginx
    state: present
  when: ansible_os_family == "RedHat"

- name: Configure Nginx
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    validate: nginx -t -c %s
  notify: Reload Nginx

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

### Playbook 中使用 Roles

```yaml
# site.yml
---
- name: Configure all servers
  hosts: all
  become: true

  roles:
    - role: common
      tags: common
    - role: users
      tags: users
      when: manage_users | default(true)

- name: Configure web servers
  hosts: webservers
  become: true

  roles:
    - role: nginx
      tags: nginx
    - role: app
      tags: app
      vars:
        app_version: "{{ deploy_version | default('v1.0.0') }}"

- name: Configure database servers
  hosts: dbservers
  become: true

  roles:
    - role: postgresql
      tags: postgres
      vars:
        pg_version: 15
```

### Role 依赖

```yaml
# roles/webserver/meta/main.yml
---
dependencies:
  - role: common
  - role: nginx
    version: "1.24.0"
```

## 高级特性

### 异步与轮询

```yaml
tasks:
  # 异步执行（长时间运行任务）
  - name: Run long backup
    ansible.builtin.command: /opt/long-backup.sh
    async: 3600          # 最大运行时间（秒）
    poll: 0               # 0 表示不等待，立即返回
    register: backup_job

  # 后续轮询检查状态
  - name: Check backup status
    ansible.builtin.async_status:
      jid: "{{ backup_job.ansible_job_id }}"
    register: job_result
    until: job_result.finished
    retries: 100
    delay: 30
    when: backup_job.ansible_job_id is defined
```

### 委托（Delegation）

```yaml
tasks:
  # 在本地执行（主机上执行）
  - name: Add to load balancer
    ansible.builtin.uri:
      url: "https://lb.example.com/api/servers/{{ inventory_hostname }}"
      method: POST
      body: "state=enabled"
    delegate_to: localhost

  # 委托到特定主机
  - name: Update DNS
    ansible.builtin.route53:
      record: "{{ inventory_hostname }}.{{ domain }}"
      type: A
      value: "{{ ansible_host }}"
      zone: "{{ domain }}"
      ttl: 300
    delegate_to: "{{ delegate_host | default('localhost') }}"

  # 在所有主机执行后，在负载均衡器上执行
  - name: Wait for server to be ready
    ansible.builtin.wait_for:
      host: "{{ inventory_hostname }}"
      port: 8080
      delay: 10
      timeout: 60
    delegate_to: localhost
    run_once: true
```

### 查找（Lookups）

```yaml
tasks:
  # 读取文件
  - name: Read file
    ansible.builtin.set_fact:
      file_content: "{{ lookup('ansible.builtin.file', '/path/to/file.txt') }}"

  # 读取 env 变量
  - name: Get env variable
    ansible.builtin.debug:
      msg: "{{ lookup('ansible.builtin.env', 'PATH') }}"

  # 读取密码（vault）
  - name: Get vault password
    ansible.builtin.debug:
      msg: "{{ lookup('ansible.builtin.vars', 'vault_password') }}"

  # 读取 template
  - name: Render template
    ansible.builtin.debug:
      msg: "{{ lookup('ansible.builtin.template', 'app.conf.j2') }}"
```

## 面试追问方向

1. **Ansible Playbook 和 Shell 脚本的区别是什么？**
   答：Shell 脚本是过程式的，每一步都要写命令；Playbook 是声明式的，描述「目标状态」而非「操作步骤」。Ansible 会计算当前状态和目标状态的差异，自动决定需要执行什么操作。Playbook 天然幂等——多次执行结果一致；Shell 脚本需要额外处理幂等性。

2. **Ansible 的执行流程是什么？**
   答：1. 加载 inventory；2. 加载 Playbook；3. 解析变量；4. 连接远程主机（SSH）；5. 收集 Facts；6. 按 Play 执行：按 Task 顺序执行每个 Play，每个 Task 在所有目标主机上并行执行；7. Handler 触发（按 name 匹配，Task 执行完后触发）。

3. **Ansible 如何保证安全性？**
   答：敏感信息放在 Ansible Vault 中加密存储；使用 `--ask-vault-pass` 或 `--vault-password-file` 解密；不将密码写在 Playbook 或 inventory 中；SSH 密钥认证优于密码认证；通过 RBAC 控制 Ansible Tower/AWX 的执行权限。

4. **Ansible 的性能优化怎么做？**
   答：开启 SSH 持久连接（`ssh_args = -o ControlMaster=auto -o ControlPersist=60s`）；使用 `gathering = smart` 减少 Facts 收集；使用 `serial` 控制并行度；使用 `strategy: free` 让任务尽快完成；合理使用 `delegate_to: localhost` 减少网络往返。

Playbook 是 Ansible 的精髓——用 YAML 写出可复用、可审计的基础设施即代码，才是 Ansible 的正确打开方式。
