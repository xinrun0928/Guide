# Ansible 集成与扩展

「Ansible 能和什么集成？」——Ansible 的真正价值，在它的生态里。

Ansible 不仅仅是一个配置管理工具。通过 Ansible Tower/AWX、Dynamic Inventory、Callback 插件、Lookup 插件，Ansible 可以与 CI/CD 流水线、云平台、监控告警系统深度集成，成为 DevOps 自动化的核心调度引擎。

## Ansible Tower / AWX

AWX 是 Ansible Tower 的开源版本，提供 Web UI、RBAC、作业调度、凭证管理等功能。

### 安装 AWX

```bash
# Docker Compose 部署 AWX
# docker-compose.yml
version: '3'
services:
  postgres:
    image: postgres:15
    container_name: awx_postgres
    environment:
      POSTGRES_DB: awx
      POSTGRES_USER: awx
      POSTGRES_PASSWORD: awx_password
    volumes:
      - pg_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7
    container_name: awx_redis
    restart: unless-stopped

  awx_web:
    image: ghcr.io/ansible/awx:24.6.0
    container_name: awx_web
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_HOST: postgres
      DATABASE_PORT: 5432
      DATABASE_DB: awx
      DATABASE_USER: awx
      DATABASE_PASSWORD: awx_password
      REDIS_HOST: redis
      SECRET_KEY: your-secret-key-here
      AWX_ADMIN_USER: admin
      AWX_ADMIN_PASSWORD: admin_password
    ports:
      - "8080:8080"
    restart: unless-stopped

volumes:
  pg_data:
```

```bash
# Kubernetes 部署 AWX Operator
kubectl create namespace awx
kubectl apply -f https://raw.githubusercontent.com/ansible/awx-operator/deploy/awx-operator.yaml
kubectl apply -f - <<EOF
apiVersion: awx.ansible.com/v1beta1
kind: AWX
metadata:
  name: awx
  namespace: awx
spec:
  service_type: nodeport
  nodeport_port: 30080
  postgres_storage_class: standard
  web_replicas: 1
  task_replicas: 1
EOF
```

### AWX 的核心功能

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ansible Tower / AWX                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Projects    │  │  Inventories │  │  Job Templates│        │
│  │  (Playbook) │  │  (主机)     │  │  (任务模板)  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Credentials │  │  Workflow    │  │  Schedules   │         │
│  │  (凭证)      │  │  (工作流)   │  │  (定时任务)  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    RBAC 权限控制                            │ │
│  │    Organization → Team → User → Role → Permission           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### AWX API 与集成

```bash
# 登录获取 Token
curl -X POST http://localhost:8080/api/v2/tokens/ \
  -H "Content-Type: application/json" \
  -u admin:admin_password \
  -d '{"description": "API token"}'

# 使用 Token 触发作业
curl -X POST http://localhost:8080/api/v2/job_templates/5/launch/ \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"extra_vars": {"deploy_version": "v2.0.0"}}'

# 查看作业状态
curl http://localhost:8080/api/v2/jobs/123/ \
  -H "Authorization: Bearer <token>"
```

### AWX 与 CI/CD 集成

```yaml
# GitLab CI 触发 AWX 作业
# .gitlab-ci.yml
stages:
  - deploy

deploy_production:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add --no-cache curl jq
  script:
    - |
      # 触发 AWX 作业
      RESPONSE=$(curl -X POST "${AWX_URL}/api/v2/job_templates/${TEMPLATE_ID}/launch/" \
        -H "Authorization: Bearer ${AWX_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"extra_vars\": {\"deploy_version\": \"${CI_COMMIT_SHA}\", \"target_hosts\": \"production\"}}")
      JOB_ID=$(echo $RESPONSE | jq -r '.job')
      echo "Started AWX Job: $JOB_ID"

      # 轮询作业状态
      while true; do
        STATUS=$(curl -s "${AWX_URL}/api/v2/jobs/${JOB_ID}/" \
          -H "Authorization: Bearer ${AWX_TOKEN}" | jq -r '.status')
        echo "Job Status: $STATUS"
        if [ "$STATUS" = "successful" ]; then
          echo "Deployment successful"
          exit 0
        elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
          echo "Deployment failed"
          exit 1
        fi
        sleep 30
      done
  environment:
    name: production
  only:
    - main
```

## Dynamic Inventory

### AWS EC2 Dynamic Inventory

```ini
# ansible.cfg
[inventory]
enable_plugins = aws_ec2

# inventory/aws_ec2.yml
plugin: aws_ec2
regions:
  - us-east-1
  - eu-west-1

filters:
  tag:Environment: production

keyed_groups:
  - key: tags['Role']
    prefix: tag
  - key: tags['Tier']
    prefix: tier
  - key: platform
    prefix: os

compose:
  ansible_user: "'ec2-user'"
  ansible_python_interpreter: "'/usr/bin/python3'"
```

```bash
# 列出所有主机
ansible-inventory -i inventory/aws_ec2.yml --list

# 测试连接
ansible all -i inventory/aws_ec2.yml -m ping

# 按标签过滤
ansible tag_Role_webserver -i inventory/aws_ec2.yml -m ping
ansible 'tag_Tier_production:&tag_Role_database' -i inventory/aws_ec2.yml -m ping
```

### Kubernetes Dynamic Inventory

```yaml
# inventory/k8s.yml
# 需要 ansible_collections.kubernetes.core
plugin: kubernetes.core.k8s
connections:
  - host: https://kubernetes.default.svc
    api_key: "{{ lookup('env', 'KUBERNETES_AUTH_TOKEN') }}"
    api_key_ca_cert: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    validate_certs: true
    namespaces:
      - production
    context: production
```

```bash
# 按标签过滤 Pod
ansible-inventory -i inventory/k8s.yml --list | jq '._meta.hostvars | keys'

# 在 K8s Pod 中运行 Ansible
kubectl run ansible-runner --image=quay.io/ansible/awx-runner:latest \
  -it --rm --restart=Never \
  --overrides '{
    "apiVersion": "v1",
    "spec": {
      "serviceAccountName": "ansible-runner",
      "containers": [{
        "env": [
          {"name": "KUBERNETES_AUTH_TOKEN", "valueFrom": {"secretKeyRef": {"name": "ansible-token", "key": "token"}}},
          {"name": "KUBECONFIG", "value": "/runner/.kube/config"}
        ]
      }]
    }
  }'
```

### Terraform + Ansible 集成

```bash
# Terraform 输出 Ansible inventory
# output "ansible_inventory" {
#   value = <<-EOF
#   [webservers]
#   %{for i, instance in aws_instance.webserver~}
#   web${i+1} ansible_host=${instance.public_ip}
#   %{endfor}
#   EOF
# }

# 使用 Terraform 输出执行 Ansible
terraform apply
terraform output ansible_inventory > inventory/terraform_inventory
ansible-playbook -i inventory/terraform_inventory site.yml
```

## CI/CD 集成

### Jenkins Pipeline 调用 Ansible

```groovy
// Jenkinsfile
pipeline {
    agent any

    environment {
        ANSIBLE_HOST_KEY_CHECKING = 'False'
    }

    stages {
        stage('Setup') {
            steps {
                sh 'pip install ansible'
                ansiblePlaybook(
                    playbook: 'playbooks/site.yml',
                    inventory: 'inventory/production',
                    credentialsId: 'ansible-vault-pass',
                    vaultCredentialsId: 'ansible-vault-pass',
                    extras: '-e "env=production" -e "deploy_version=${BUILD_NUMBER}"',
                    disableHostKeyChecking: true
                )
            }
        }

        stage('Deploy with Ansible') {
            steps {
                script {
                    def result = ansiblePlaybook(
                        playbook: 'playbooks/deploy.yml',
                        inventory: 'inventory/production',
                        credentialsId: 'ansible-ssh-key',
                        extras: "--tags deploy",
                        disableHostKeyChecking: true
                    )
                    if (result != 0) {
                        error "Ansible deployment failed"
                    }
                }
            }
        }
    }

    post {
        failure {
            slackSend channel: '#devops',
                      message: "Ansible deployment failed: ${env.BUILD_URL}"
        }
        success {
            slackSend channel: '#devops',
                      message: "Ansible deployment successful: ${env.BUILD_URL}"
        }
    }
}
```

### GitHub Actions + Ansible

```yaml
# .github/workflows/ansible.yml
name: Ansible Deployment

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - staging
          - production

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install Ansible
        run: |
          pip install ansible-core
          pip install ansible-lint
          ansible-galaxy collection install community.general

      - name: Create inventory
        run: |
          cat <<EOF > inventory/${{ github.event.inputs.environment || 'staging' }}
          [webservers]
          ${{ vars.WEBSERVER_IPS }}
          EOF

      - name: Decrypt secrets
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.ANSIBLE_VAULT_PASS }}" > vault_pass
          chmod 600 vault_pass
          ansible-vault decrypt secrets/production.yml --vault-password-file vault_pass

      - name: Run Ansible Playbook
        run: |
          ansible-playbook site.yml \
            -i inventory/${{ github.event.inputs.environment || 'staging' }} \
            --vault-password-file vault_pass \
            --extra-vars "@secrets/${{ github.event.inputs.environment || 'staging' }}.yml" \
            -v

      - name: Cleanup
        if: always()
        run: rm -f vault_pass
```

## Ansible Vault

```bash
# 创建加密文件
ansible-vault create vars/secrets.yml
ansible-vault create --vault-password-file ~/.vault_pass vars/secrets.yml

# 编辑加密文件
ansible-vault edit vars/secrets.yml
ansible-vault edit --vault-password-file ~/.vault_pass vars/secrets.yml

# 加密已有文件
ansible-vault encrypt vars/secrets.yml

# 解密文件
ansible-vault decrypt vars/secrets.yml

# 查看加密文件（不修改）
ansible-vault view vars/secrets.yml

# 执行 Playbook 时解密
ansible-playbook site.yml --vault-password-file ~/.vault_pass
ansible-playbook site.yml --ask-vault-pass

# 多密码支持
ansible-playbook site.yml --vault-id dev@~/.vault-dev --vault-id prod@~/.vault-prod
```

```yaml
# vars/secrets.yml (加密后)
---
db_password: "super-secret-password"
api_key: "sk-live-xxxxx"
ssl_cert: |
  -----BEGIN CERTIFICATE-----
  MIIDXTCCAkWgAwIBAgIJAKZ...
  -----END CERTIFICATE-----
```

## 插件与扩展

### Custom Module

```python
# library/hello_world.py
#!/usr/bin/python3
# PYTHON_ARGCOMPLETE_OK
from ansible.module_utils.basic import AnsibleModule


def run_module():
    module_args = dict(
        name=dict(type='str', required=True),
        state=dict(type='str', default='present', choices=['present', 'absent']),
        message=dict(type='str', default='Hello world!')
    )

    module = AnsibleModule(
        argument_spec=module_args,
        supports_check_mode=True
    )

    name = module.params['name']
    state = module.params['state']
    message = module.params['message']

    if state == 'present':
        changed = False
        result = {'name': name, 'message': message, 'state': 'present'}
    else:
        changed = True
        result = {'name': name, 'state': 'absent'}

    if module.check_mode:
        module.exit_json(changed=changed, **result)

    module.exit_json(changed=changed, **result)


def main():
    run_module()


if __name__ == '__main__':
    main()
```

```yaml
# 使用自定义模块
- name: Use custom module
  hello_world:
    name: "myapp"
    state: present
    message: "Deployment complete"
```

### Custom Lookup Plugin

```python
# lookup_plugins/vault_lookup.py
from ansible.plugins.lookup import LookupBase


class LookupModule(LookupBase):
    def run(self, terms, variables=None, **kwargs):
        vault_id = terms[0]
        secret_name = terms[1]

        # 从 HashiCorp Vault 获取密钥
        vault_addr = variables.get('vault_addr', 'https://vault:8200')
        token = variables.get('vault_token')

        # 实际实现需要 hvac 库
        return [f"secret/{vault_id}/{secret_name}"]
```

### Callback Plugins

```python
# callback_plugins/slack.py
from ansible.plugins.callback import CallbackBase
import json


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = 'notification'
    CALLBACK_NAME = 'slack'

    def __init__(self):
        super().__init__()

    def v2_runner_on_ok(self, result):
        if result.is_changed():
            msg = f"Changed: {result._host.get_name()}\n{result._result.get('msg', '')}"
        else:
            msg = f"OK: {result._host.get_name()}"

        # 发送到 Slack
        # self._display.display(msg)
```

## 性能优化

### Ansible 配置优化

```ini
# ansible.cfg
[defaults]
# 减少 SSH 握手次数
[ssh_connection]
ssh_args = -o ControlMaster=auto -o ControlPersist=60s -o StrictHostKeyChecking=no
pipelining = True
# 主机密钥检查
host_key_checking = False
# 并行度
forks = 20

[privilege_escalation]
become = True
become_method = sudo
become_user = root
become_ask_pass = False
```

### 异步执行

```yaml
tasks:
  # 批量操作用异步
  - name: Deploy all applications
    ansible.builtin.shell: |
      for app in {{ apps | join(' ') }}; do
        ansible-playbook deploy.yml -e "app=$app"
      done
    async: 3600
    poll: 0
    register: batch_deploy

  # 轮询异步作业
  - name: Wait for batch deploy
    ansible.builtin.async_status:
      jid: "{{ batch_deploy.ansible_job_id }}"
    register: job_result
    until: job_result.finished
    retries: 100
    delay: 30
```

## 面试追问方向

1. **Ansible Tower 和 AWX 的区别是什么？**
   答：AWWX 是 Tower 的开源版本，功能基本一致；Tower 由 Red Hat 提供商业支持，带额外的企业功能（分析、认证集成等）和 SLA 保证。功能上 Tower = AWX + 支持 + 额外插件。

2. **如何安全地管理 Ansible 中的敏感信息？**
   答：使用 Ansible Vault 加密敏感文件（变量文件、Playbook）；敏感信息不在 inventory 或 Playbook 明文中存储；通过 AWX/Tower 的 Credentials 管理密钥；集成外部密钥管理（HashiCorp Vault、AWS Secrets Manager）；使用 `no_log: yes` 防止敏感信息输出到日志。

3. **Ansible Dynamic Inventory 和 Static Inventory 的优劣是什么？**
   答：Static Inventory 简单，适合固定基础设施；Dynamic Inventory 自动化程度高，适合云环境和频繁变更的基础设施。Dynamic Inventory 的缺点是需要插件支持，增加了配置复杂度。对于云环境（AWS、GCP、Azure），Dynamic Inventory 是必选项。

4. **Ansible 如何实现幂等性？**
   答：幂等性是指多次执行结果一致。Ansible 的内置模块（apt、yum、service、copy、template 等）天然幂等——如果目标状态已满足，模块不会做任何操作。使用 `changed_when` 和 `check_mode` 可以精细控制变更检测。对于自定义模块，需要在代码中实现状态检查逻辑。

Ansible 的真正力量不在于孤立的配置管理，而在于与 CI/CD、云平台、监控系统的深度集成。通过 API、Dynamic Inventory、Vault、Callback，Ansible 可以成为整个 DevOps 流水线的自动化调度中心。
