# Helm 模板语法与 values.yaml

「Helm 模板到底怎么写？」——Go 模板引擎 + Sprig 函数，让 YAML 动起来。

Helm 的核心能力是**模板化**。你写一份 Chart，通过 `values.yaml` 和命令行参数注入不同的值，生成不同的 Kubernetes 资源。这个过程的背后，是 Go 模板引擎在驱动。

## Go 模板基础

Helm 使用 Go 的 `text/template` 包作为模板引擎。模板以 `{{ }}` 包裹表达式。

```yaml
# 基础语法
{{ .Values.name }}          # 引用 Values 中的 name
{{ .Release.Name }}         # 内置对象 Release 的 Name
{{ .Chart.Version }}        # Chart 元数据

# 条件渲染
{{- if .Values.replicaCount }}
replicas: {{ .Values.replicaCount }}
{{- end }}

# 注释
{{/* 这是一个注释，不会在输出中出现 */}}
```

> 注意 `{{-` 后面的短横线会自动去掉前方的空白，结束标签前的 `-` 会去掉后方空白，这是 Helm 模板对齐的常用技巧。

## values.yaml 结构

`values.yaml` 是 Chart 的默认配置入口：

```yaml
# values.yaml
replicaCount: 1

image:
  repository: nginx
  tag: "1.24.0"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: true
  className: "nginx"
  annotations:
    kubernetes.io/ingress.class: nginx
  hosts:
    - host: myapp.example.com
      paths:
        - path: /
          pathType: Prefix

resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### values 的覆盖优先级

Helm 支持多层 values，优先级从高到低：

```bash
# 1. 最高：命令行 -f 指定的文件
helm install -f myvalues.yaml myrelease ./chart

# 2. 命令行 --set 参数
helm install --set replicaCount=3 myrelease ./chart

# 3. 当前目录的 values.yaml
# 4. Chart 内部的 values.yaml（最低）
```

```bash
# 常见 set 用法
--set name=value              # 简单值
--set foo={a,b,c}            # 数组
--set foo=bar,baz=qux        # 多个值
--set foo[key]=value         # 字典
--set-json foo='{"a":1}'     # JSON 格式
--set-file foo=path/file     # 文件内容作为值
```

## 模板函数

Helm 内置了 100+ 模板函数，来自 [Sprig 库](http://masterminds.github.io/sprig/)。

### 字符串函数

```yaml
# values.yaml
appName: my-app
version: v1.0.0
fullName: "{{ .Values.appName }}-{{ .Release.Name }}"

# upper / lower / title
appName: {{ upper .Values.appName }}        # MY-APP
version: {{ lower .Values.version }}        # v1.0.0

# quote / squote（加引号）
name: {{ quote .Values.appName }}           # "my-app"
name: {{ squote .Values.appName }}         # 'my-app'

# replace（替换）
imageTag: {{ replace "v" "" .Values.version }}  # 1.0.0

# substr（截取）
shortVersion: {{ substr 0 3 .Values.version }}   # v1.
```

### 逻辑与比较函数

```yaml
# eq / ne / gt / lt / ge / le（等于/不等于/大于/小于/大于等于/小于等于）
{{- if eq .Values.replicaCount 1 }}
  # 单副本场景的特殊配置
{{- else if gt .Values.replicaCount 1 }}
  # 多副本场景
{{- end }}

# and / or / not（逻辑运算）
{{- if and .Values.ingress.enabled .Values.ingress.tls.enabled }}
  # 同时满足多个条件
{{- end }}
```

### 集合函数

```yaml
# list（创建列表）
{{- $items := list "a" "b" "c" }}

# first / last / rest（取列表元素）
firstItem: {{ first $items }}       # a
lastItem: {{ last $items }}         # c

# has（检查是否包含）
hasA: {{ has "a" $items }}          # true

# compact（去除空值）
cleanList: {{ compact (list "a" "" "b" nil) | toJson }}

# merge（合并字典）
{{- $merged := merge (dict "key1" "val1") (dict "key2" "val2") }}
```

### 类型转换函数

```yaml
# toString / toInt / toFloat64
count: {{ .Values.count | toInt }}

# toYaml（将对象输出为 YAML 格式）
{{ .Values.config | toYaml }}

# toJson / toJsonPretty
{{ .Values.data | toJson }}

# default（默认值）
imageTag: {{ .Values.image.tag | default "latest" }}

# required（必填值，缺失则报错）
clusterName: {{ required "cluster.name is required" .Values.cluster.name }}
```

## 模板控制结构

### if/else

```yaml
{{- if .Values.ingress.enabled }}
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "mychart.fullname" . }}
  annotations:
    {{- range $key, $value := .Values.ingress.annotations }}
    {{ $key }}: {{ $value | quote }}
    {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  rules:
  {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
        {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType }}
            backend:
              service:
                name: {{ $.Release.Name }}
                port:
                  number: 80
        {{- end }}
  {{- end }}
{{- end }}
```

### range（循环）

```yaml
# 遍历列表
env:
{{- range .Values.env }}
  - name: {{ .name }}
    value: {{ .value | quote }}
{{- end }}

# 遍历字典
annotations:
{{- range $key, $value := .Values.podAnnotations }}
  {{ $key }}: {{ $value | quote }}
{{- end }}

# 使用 index 访问列表元素
firstEnv: {{ index .Values.env 0 "name" }}
```

### with（修改作用域）

`with` 用于切换当前作用域（`.`）：

```yaml
{{- with .Values.image }}
image: {{ .repository }}:{{ .tag }}
imagePullPolicy: {{ .pullPolicy }}
{{- end }}
# with 块外，. 恢复到上级作用域
```

### define 与 include

`define` 定义命名模板，`include` 引入并执行：

```yaml
# _helpers.tpl（约定俗成的辅助模板文件）
{{- define "mychart.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/version: {{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

# 在任意资源中引用
metadata:
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
```

> `include` 会输出模板内容并保留缩进；`template`（旧写法）功能类似但不支持管道。

## 命名模板最佳实践

约定将辅助模板放在 `templates/_helpers.tpl` 中：

```
templates/
├── Chart.yaml
├── values.yaml
├── _helpers.tpl          # 辅助模板（推荐）
├── _labels.tpl           # 按功能分离
├── _common.tpl           # 
├── deployment.yaml
├── service.yaml
├── ingress.yaml
└── NOTES.txt             # 安装后提示信息
```

```yaml
# _helpers.tpl
{{/*
Expand the name of the chart.
*/}}
{{- define "mychart.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mychart.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "mychart.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "mychart.commonLabels" -}}
app.kubernetes.io/name: {{ include "mychart.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | default .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
```

## 常见模板场景

### 条件生成资源

```yaml
{{- if .Values.persistence.enabled }}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "mychart.fullname" . }}
spec:
  accessModes:
    - {{ .Values.persistence.accessMode }}
  resources:
    requests:
      storage: {{ .Values.persistence.size }}
{{- end }}
```

### 使用 lookup 获取集群资源

```yaml
# 检查是否存在同名 Secret（lookup 返回空 map 表示不存在）
{{- $secret := lookup "v1" "Secret" .Release.Namespace "my-secret" }}
{{- if not $secret }}
---
apiVersion: v1
kind: Secret
metadata:
  name: my-secret
type: Opaque
data:
  password: {{ .Values.password | b64enc }}
{{- end }}
```

### 处理多环境配置

```yaml
# 方式一：通过环境名称切换
{{- if eq .Values.environment "production" }}
resources:
  limits:
    memory: 2Gi
    cpu: 1000m
{{- else }}
resources:
  limits:
    memory: 512Mi
    cpu: 500m
{{- end }}

# 方式二：独立的 values 文件
# values-dev.yaml / values-prod.yaml
# helm install -f values-prod.yaml myrelease ./chart
```

## NOTES.txt 模板

安装后显示自定义提示信息：

```yaml
# templates/NOTES.txt
Thank you for installing {{ .Chart.Name }}.

Your release is named {{ .Release.Name }}.

To learn more about the release, try:

  $ helm status {{ .Release.Name }}
  $ helm get all {{ .Release.Name }}

To access the application:
{{- if .Values.service.type "NodePort" }}
  $ export NODE_PORT=$(kubectl get -n {{ .Release.Namespace }} -o jsonpath="{.spec.ports[0].nodePort}" services {{ include "mychart.fullname" . }})
  $ kubectl port-forward -n {{ .Release.Namespace }} svc/{{ include "mychart.fullname" . }} {{ .Values.service.port }}:$NODE_PORT
{{- else }}
  $ kubectl port-forward -n {{ .Release.Namespace }} svc/{{ include "mychart.fullname" . }} {{ .Values.service.port }}:8080
{{- end }}
```

## 调试模板

```bash
# 渲染模板（不安装）
helm template myrelease ./chart
helm template myrelease ./chart --set replicaCount=3

# 本地调试（dry-run + 连到集群验证）
helm install --dry-run --debug myrelease ./chart

# 验证 Chart 语法
helm lint ./chart

# 在集群上模拟安装（不实际创建资源）
helm upgrade --install --dry-run --debug myrelease ./chart
```

## 面试追问方向

1. **Helm 模板中的 `.` 作用域是什么？** —— `.` 是当前的作用域对象，可以是 Release、Values、Chart、Files 等内置对象，在 `with` 和 `range` 中会切换作用域。
2. **Helm 模板如何实现「空值不渲染」？** —— `{{- if .Values.foo }}` 配合 `{{- end }}` 的短横线语法，或者使用 `default` 函数。
3. **`lookup` 函数的限制是什么？** —— `lookup` 只在 `helm template` 和 `--dry-run` 时使用时会返回空（因为没有真实连接集群），生产环境中使用需谨慎。

> "Helm 模板的精髓在于『一份 Chart，多种形态』。通过 values 的不同组合，同一套模板可以适应开发、测试、生产多个环境。"
