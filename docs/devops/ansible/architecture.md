# Ansible 架构：控制节点、被管节点、Inventory、Playbook

「Ansible 怎么工作的？」——SSH 无代理，幂等执行。

Ansible 是运维自动化的利器。它的设计哲学简单而强大：无代理（Agentless）、幂等性（Idempotent）、声明式（YAML）。理解它的架构，是用好 Ansible 的前提。

## Ansible 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ansible 架构                                   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Ansible 主机（Control Node）               │  │
│  │                                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │                    Ansible Engine                      │  │  │
│  │  │                                                     │  │  │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │  │  │
│  │  │  │  Inventory  │  │   Modules   │  │   Plugins  │ │  │  │
│  │  │  │ (主机清单)  │  │ (任务执行)  │  │ (扩展功能) │ │  │  │
│  │  │  └─────────────┘  └─────────────┘  └────────────┘ │  │  │
│  │  │         │              │               │          │  │  │
│  │  │         └──────────────┴───────────────┘          │  │  │
│  │  │                        │                          │  │  │
│  │  │  ┌─────────────────────┴────────────────────────┐ │  │  │
│  │  │  │                 Playbook                     │ │  │  │
│  │  │  │           (YAML 任务定义)                   │ │  │  │
│  │  │  └─────────────────────────────────────────────┘ │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │                                        │
│                             │ SSH / API / PowerShell               │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    目标主机（Managed Nodes）                   │  │
│  │                                                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │  │
│  │  │   Server A  │  │   Server B  │  │   Server C  │          │  │
│  │  │   (Ubuntu)  │  │   (CentOS) │  │  (Windows)  │          │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │  │
│  │                                                             │  │
│  │  无需安装 Agent！Ansible 通过 SSH 直接连接执行               │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 核心组件

### Inventory（主机清单）

```ini
# inventory/hosts.ini
# 简单主机列表
web1.example.com
web2.example.com
db1.example.com

# 主机组
[webservers]
web1.example.com ansible_user=ubuntu ansible_port=22
web2.example.com ansible_user=ubuntu ansible_port=22
web3.example.com ansible_user=admin ansible_port=2222

[dbservers]
db1.example.com ansible_user=root
db2.example.com ansible_user=root

[production:children]
webservers
dbservers

# 主机变量
[webservers]
web1.example.com http_port=8080 max_connections=1000
web2.example.com http_port=9090 max_connections=2000

# 主机组变量
[webservers:vars]
ansible_user=ubuntu
ansible_python_interpreter=/usr/bin/python3
```

```yaml
# inventory/hosts.yml (YAML 格式)
all:
  children:
    webservers:
      hosts:
        web1.example.com:
          ansible_user: ubuntu
          http_port: 8080
        web2.example.com:
          ansible_user: ubuntu
          http_port: 9090
      vars:
        ansible_python_interpreter: /usr/bin/python3
    dbservers:
      hosts:
        db1.example.com:
          ansible_user: root
    production:
      children:
        webservers:
        dbservers:
```

### Dynamic Inventory（动态主机清单）

```python
#!/usr/bin/env python3
# inventory/aws_ec2.py
import boto3
import json

def get_ec2_inventory():
    ec2 = boto3.resource('ec2', region_name='us-east-1')

    inventory = {
        'webservers': {'hosts': []},
        'dbservers': {'hosts': []},
        '_meta': {'hostvars': {}}
    }

    for instance in ec2.instances.all():
        if instance.state['Name'] != 'running':
            continue

        tags = {t['Key']: t['Value'] for t in instance.tags or []}
        host_data = {
            'ansible_host': instance.public_ip_address,
            'ansible_user': 'ubuntu',
            'instance_type': instance.instance_type,
            'region': instance.placement['AvailabilityZone']
        }

        role = tags.get('Role', 'webservers')
        if role not in inventory:
            inventory[role] = {'hosts': []}

        ip = instance.public_ip_address or instance.private_ip_address
        inventory[role]['hosts'].append(ip)
        inventory['_meta']['hostvars'][ip] = host_data

    print(json.dumps(inventory))

if __name__ == '__main__':
    get_ec2_inventory()
```

```bash
# 使用动态主机清单
ansible-playbook -i inventory/aws_ec2.py site.yml
```

### Configuration（配置文件）

```ini
# ansible.cfg
[defaults]
inventory = ./inventory/hosts
forks = 10
remote_user = ubuntu
host_key_checking = False
timeout = 10

# Facts 缓存
gathering = smart
fact_caching = jsonfile
fact_caching_connection = /tmp/ansible_facts
fact_caching_timeout = 86400

# 模块路径
library = ./library
module_utils = ./module_utils
log_path = /var/log/ansible.log

[privilege_escalation]
become = True
become_method = sudo
become_user = root
become_ask_pass = False

[ssh_connection]
pipelining = True
ssh_args = -o ControlMaster=auto -o ControlPersist=60s
```

### Modules（模块）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ansible 模块分类                                │
│                                                                  │
│  系统模块（System）                                              │
│  - user: 用户管理    - group: 组管理    - service: 服务管理      │
│  - cron: 定时任务   - systemd: Systemd 管理                      │
│                                                                  │
│  命令模块（Commands）                                            │
│  - command: 执行命令    - shell: 执行 shell 命令                  │
│  - script: 远程脚本    - expect: 交互式命令                       │
│                                                                  │
│  文件模块（Files）                                               │
│  - copy: 复制文件    - template: 模板渲染    - file: 文件属性      │
│  - synchronize: rsync 同步                                        │
│                                                                  │
│  包管理模块（Packaging）                                         │
│  - yum: RPM 包    - apt: DEB 包    - pip: Python 包              │
│                                                                  │
│  云模块（Cloud）                                                 │
│  - ec2: AWS    - k8s: Kubernetes    - azure: Azure    - docker   │
│                                                                  │
│  数据库模块（Database）                                          │
│  - mysql_db: MySQL    - postgresql_db: PostgreSQL    - redis     │
└─────────────────────────────────────────────────────────────────┘
```

### Plugins（插件）

```python
# plugins/callback/custom_callback.py
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    """
    自定义回调插件：任务成功/失败时发送通知
    """
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = 'notification'

    def __init__(self, *args, **kwargs):
        super(CallbackModule, self).__init__(*args, **kwargs)
        self.task_results = []

    def v2_runner_on_ok(self, result, **kwargs):
        self.task_results.append({
            'host': result._host.get_name(),
            'task': result.task_name,
            'status': 'ok',
            'changed': result._result.get('changed', False)
        })

    def v2_runner_on_failed(self, result, **kwargs):
        self.task_results.append({
            'host': result._host.get_name(),
            'task': result.task_name,
            'status': 'failed',
            'msg': result._result.get('msg', '')
        })

    def v2_playbook_on_stats(self, stats):
        # 生成汇总报告，可接入 Slack/Webhook
        pass
```

### Playbooks（任务剧本）

```yaml
# site.yml
---
- name: Configure production servers
  hosts: production
  become: yes
  vars:
    nginx_version: "1.24.0"
    app_port: 8080

  pre_tasks:
    - name: Update apt cache
      apt:
        update_cache: yes
      when: ansible_os_family == "Debian"

  handlers:
    - name: Restart nginx
      service:
        name: nginx
        state: restarted

    - name: Reload nginx
      service:
        name: nginx
        state: reloaded

  tasks:
    - name: Install nginx
      apt:
        name: nginx
        state: present
      notify: Restart nginx

    - name: Copy nginx configuration
      template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
      notify: Reload nginx

    - name: Ensure nginx is running
      service:
        name: nginx
        state: started
        enabled: yes

    - name: Deploy application
      git:
        repo: "https://github.com/example/app.git"
        dest: /opt/app
        version: "{{ app_version | default('main') }}"
      register: app_deploy

    - name: Restart application
      systemd:
        name: app
        state: restarted
      when: app_deploy.changed

  post_tasks:
    - name: Verify deployment
      uri:
        url: "http://localhost:{{ app_port }}/health"
        status_code: 200
      register: health_check

    - name: Send notification
      debug:
        msg: "Deployment completed. Health check: {{ health_check.status }}"
```

## 执行流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ansible 执行流程                               │
│                                                                  │
│  1. 加载配置文件                                                  │
│     ansible.cfg → Inventory → Playbook                          │
│                                                                  │
│  2. 加载 Inventory                                               │
│     解析主机/主机组 → 获取主机变量                                │
│                                                                  │
│  3. 执行 Pre_tasks                                              │
│     任务（SSH 连接前）                                            │
│                                                                  │
│  4. 加载 Roles/Tasks                                            │
│     解析 Playbook → 展开 Roles → 排序 Tasks                      │
│                                                                  │
│  5. 收集 Facts                                                  │
│     远程主机信息（ansible_facts）                                │
│                                                                  │
│  6. 执行 Tasks（幂等执行）                                      │
│     SSH 连接 → 执行 Module → 返回结果                             │
│     是否 Changed？→ 触发 Handlers                                │
│                                                                  │
│  7. 执行 Post_tasks                                            │
│     清理/验证任务                                                │
│                                                                  │
│  8. 执行 Handlers                                               │
│     按依赖顺序执行通知的 Handler                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Ansible Galaxy

```bash
# 下载 Role
ansible-galaxy role install geerlingguy.redis

# 搜索 Role
ansible-galaxy role search "kubernetes"

# 初始化 Role
ansible-galaxy role init my_role

# 初始化 Collection
ansible-galaxy collection init myorg.mycollection

# 安装 requirements.yml 中的 Role
ansible-galaxy role install -r requirements.yml
```

```yaml
# requirements.yml 示例
roles:
  - src: geerlingguy.redis
    version: "3.3.0"
    name: redis
  - src: https://github.com/example/nginx-role.git
    scm: git
    version: "1.0.0"
```

## 常见错误

```
# 错误一：SSH 连接失败
# 原因：SSH 密钥未配置、远程用户错误、主机密钥检查失败
# 解决：
# - 设置 SSH 密钥：ssh-copy-id user@host
# - 禁用主机密钥检查：host_key_checking = False
# - 检查远程用户：remote_user = ubuntu

# 错误二：任务执行顺序不对
# 原因：Playbook 顺序和预期不符
# 解决：使用 block / rescue / always 控制流程；理解 Handler 触发时机

# 错误三：幂等性被破坏
# 原因：使用了 command/shell 模块而不是专用模块
# 解决：尽量使用专用模块（apt/yum/service/file）；command/shell 加上 creates/removes

# 错误四：变量未定义
# 原因：变量拼写错误、作用域问题
# 解决：使用 ansible-playbook --syntax-check；加上 debug 打印变量

# 错误五：并行执行导致冲突
# 原因：多个任务同时修改同一资源
# 解决：使用 throttle 限制并发；使用 run_once 限制执行主机
```

## 面试追问方向

1. **Ansible 和 Chef/Puppet 的区别是什么？**
   答：Ansible 是无代理（Agentless），通过 SSH 直接连接执行；Chef/Puppet 需要在被管理节点安装 Agent。Ansible 配置简单（YAML），学习曲线低；Chef/Puppet 配置复杂但功能更强大。Ansible 适合临时任务和快速编排；Chef/Puppet 适合持续配置管理。

2. **Ansible 的幂等性是怎么实现的？**
   答：Ansible 的每个模块都检查当前状态，如果状态已经是目标状态，则不执行任何操作，直接返回 success。例如 `service: state=started` 会先检查服务是否已启动，是则跳过，否才启动。这就是幂等性——多次执行和一次执行效果相同。

3. **Ansible 如何处理大规模集群（100+ 节点）？**
   答：1) 增加 `forks` 数量，并行执行；2) 使用 `async` + `poll` 做后台任务；3) 使用 `throttle` 限制单任务并发；4) 使用 Rolling Update 避免同时更新所有节点；5) 使用 `serial` 控制批次；6) 优化 SSH 连接（ControlMaster 复用）。

4. **Ansible 的 Facts 是什么？有什么作用？**
   答：Facts 是 Ansible 从远程主机自动收集的系统信息（操作系统版本、CPU、内存、网络等），存在 `ansible_facts` 变量中。作用：1) 提供系统信息供条件判断；2) 在模板中引用（如 `{{ ansible_facts.eth0.ipv4.address }}`）；3) `gather_facts: no` 可以禁用加速。

Ansible 的架构简洁而不简单。无代理设计让运维更轻松，幂等性让执行更安全，YAML 让配置更易读。
