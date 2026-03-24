# Linux常用命令与Shell脚本：运维必备

你是否见过老运维人员敲命令如飞？是否见过他们写的脚本自动完成繁琐任务？
这些技能不是天赋，而是日积月累。

让我们从基础开始，系统学习Linux命令和Shell脚本。


## 文件操作

### 基础命令

```bash
# 切换目录
cd /home/user          # 切换到指定目录
cd ..                  # 切换到上级目录
cd -                  # 切换到上一个目录
cd ~                  # 切换到用户主目录

# 列出文件
ls -la                # 详细列表（包含隐藏文件）
ls -lh                # 人类可读大小
ls -lt                # 按修改时间排序
ls -lS                # 按大小排序

# 创建文件/目录
touch file.txt        # 创建空文件
mkdir -p dir1/dir2    # 递归创建目录
mkdir -m 755 dir       # 指定权限创建

# 复制/移动/删除
cp -r src dest         # 递归复制
cp -p src dest         # 保持属性
mv src dest            # 移动或重命名
rm -rf dir             # 强制递归删除
```

### 查找文件

```bash
# find：强大的文件查找工具
find /home -name "*.log"              # 按名称查找
find / -type f -size +100M            # 查找大于100M的文件
find / -mtime -7                      # 查找7天内修改的文件
find / -user root -perm 0755           # 按权限和所有者查找

# locate：快速查找（基于索引数据库）
updatedb                               # 更新索引
locate filename                        # 查找文件

# which/whereis：查找命令位置
which python                            # 查找命令路径
whereis python                          # 查找命令和源码位置
```


## 文本处理

### 查看文件

```bash
# cat：显示文件内容
cat file.txt                           # 显示全部
cat -n file.txt                        # 显示行号
tac file.txt                           # 反向显示

# head/tail：查看文件头部/尾部
head -20 file.txt                      # 查看前20行
tail -f /var/log/syslog               # 实时跟踪日志
tail -n 100 file.txt                   # 查看最后100行

# less/more：分页查看
less -N file.txt                       # 显示行号
less +100 file.txt                     # 从第100行开始
```

### 文本处理三剑客

```bash
# grep：文本搜索
grep "error" /var/log/syslog           # 搜索包含error的行
grep -r "TODO" ./src                   # 递归搜索
grep -i "warning" file.txt             # 忽略大小写
grep -v "debug" file.txt               # 反向选择（不包含）
grep -E "error|warning" file.txt       # 正则表达式
grep -c "error" file.txt               # 计数

# sed：流编辑器
sed 's/old/new/g' file.txt            # 全局替换
sed -n '10,20p' file.txt               # 打印10-20行
sed -i 's/old/new/' file.txt          # 直接修改文件
sed '/pattern/d' file.txt             # 删除匹配行

# awk：文本分析工具
awk '{print $1, $3}' file.txt         # 打印第1、3列
awk -F: '{print $1}' /etc/passwd       # 指定分隔符
awk '/pattern/ {print $0}' file.txt    # 打印匹配行
awk 'NR==10' file.txt                  # 打印第10行
```


## 系统管理

### 进程管理

```bash
# ps：查看进程
ps aux                                 # 显示所有进程
ps -ef                                 # 标准格式
ps -eo pid,user,cmd,%cpu,%mem         # 自定义格式
ps aux | grep java                     # 查找Java进程

# top/htop：实时监控
top -u www-data                        # 只显示指定用户的进程
top -p 1234                            # 监控指定PID
htop                                   # 更友好的界面

# kill：终止进程
kill -9 1234                          # 强制终止
kill -15 1234                         # 优雅终止（默认）
killall java                           # 按名称终止

# 其他进程命令
pkill -f "pattern"                    # 按模式终止
pgrep -f "pattern"                    # 按模式查找PID
pstree                                # 显示进程树
```

### 用户和权限

```bash
# 用户管理
useradd -m -s /bin/bash username      # 创建用户
passwd username                        # 设置密码
userdel -r username                    # 删除用户
usermod -aG sudo username             # 添加到sudo组

# 权限管理
chmod 755 file                         # 数字方式设置权限
chmod u+x file                         # 符号方式添加执行权限
chown user:group file                  # 改变所有者
chgrp group file                       # 改变所属组

# sudo
sudo -l                               # 查看sudo权限
sudo su                               # 切换到root
sudo -u user command                  # 以其他用户身份执行
```

### 磁盘管理

```bash
# df：磁盘使用情况
df -h                                 # 人类可读格式
df -i                                 # 显示inode使用
df -T                                 # 显示文件系统类型

# du：目录使用情况
du -sh /var/log                       # 总计
du -h --max-depth=1 /home             # 限制深度
du -ah | sort -rh | head -20         # 按大小排序前20

# mount：挂载
mount /dev/sdb1 /mnt/usb              # 挂载
umount /mnt/usb                       # 卸载
mount -o remount,rw /                 # 重新挂载为读写

# fdisk/parted：分区管理
fdisk -l                              # 查看分区表
parted /dev/sdb                       # 交互式分区工具
```


## Shell脚本

### 基础语法

```bash
#!/bin/bash
# 这是注释

# 变量
NAME="world"
echo "Hello, $NAME"
echo "Hello, ${NAME}!"

# 特殊变量
# $0: 脚本名
# $1-$9: 命令行参数
# $#: 参数个数
# $@: 所有参数
# $?: 上一条命令的退出码

# 条件判断
if [ -f "$1" ]; then
    echo "File exists"
elif [ -d "$1" ]; then
    echo "It's a directory"
else
    echo "Not found"
fi

# 循环
for file in *.txt; do
    echo "Processing $file"
done

while read line; do
    echo "$line"
done < file.txt

# 函数
function hello() {
    echo "Hello, $1!"
}
hello "World"
```

### 实用脚本示例

```bash
#!/bin/bash
# 备份脚本示例

# 配置
BACKUP_DIR="/backup"
SOURCE_DIR="/home/user/data"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${DATE}.tar.gz"

# 检查是否运行中
LOCK_FILE="/tmp/backup.lock"
if [ -f "$LOCK_FILE" ]; then
    echo "Backup already running"
    exit 1
fi

# 创建锁文件
touch "$LOCK_FILE"

# 清理旧备份（保留最近7天）
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -delete

# 执行备份
tar -czf "${BACKUP_DIR}/${BACKUP_FILE}" "$SOURCE_DIR"

# 检查结果
if [ $? -eq 0 ]; then
    echo "Backup completed: $BACKUP_FILE"
    rm "$LOCK_FILE"
else
    echo "Backup failed"
    rm "$LOCK_FILE"
    exit 1
fi
```

```bash
#!/bin/bash
# 日志分析脚本

LOG_FILE="$1"
if [ -z "$LOG_FILE" ]; then
    echo "Usage: $0 <logfile>"
    exit 1
fi

echo "=== 日志分析报告 ==="
echo "文件: $LOG_FILE"
echo ""

echo "总行数: $(wc -l < "$LOG_FILE")"
echo "ERROR数量: $(grep -c "ERROR" "$LOG_FILE" 2>/dev/null || echo 0)"
echo "WARNING数量: $(grep -c "WARNING" "$LOG_FILE" 2>/dev/null || echo 0)"
echo ""

echo "=== 最近10条ERROR ==="
grep "ERROR" "$LOG_FILE" | tail -10
echo ""

echo "=== 按小时统计 ==="
awk '{print substr($4, 2, 2)}' "$LOG_FILE" | sort | uniq -c | sort -k2
```

### 输入输出重定向

```bash
# 输出重定向
command > output.txt     # 重定向到文件（覆盖）
command >> output.txt    # 重定向到文件（追加）
command 2> error.txt     # 重定向错误
command &> all.txt       # 重定向全部
command > output.txt 2>&1 # 标准输出和错误都重定向

# 输入重定向
command < input.txt

# 管道
command1 | command2      # command1的输出传给command2
command1 | tee log.txt   # 同时输出到屏幕和文件
```


## 网络命令

```bash
# 网络配置
ip addr show                           # 查看IP配置
ip route show                          # 查看路由表
ifconfig                               # 传统网络配置
netstat -tulnp                         # 查看监听端口

# 网络测试
ping -c 4 example.com                   # Ping测试
traceroute example.com                  # 路由追踪
curl -I example.com                     # HTTP请求头
wget example.com/file.zip              # 下载文件

# DNS
nslookup example.com                    # DNS查询
dig example.com                         # 详细DNS信息
host example.com                        # 反向查询

# 防火墙
iptables -L -n                          # 查看规则
ufw allow 80/tcp                       # ufw允许端口
firewall-cmd --list-all                # firewalld
```


## 面试追问方向

- **find和locate查找文件的区别是什么？**
  提示：实时vs索引数据库。
- **grep -c和grep | wc -l的区别是什么？**
  提示：效率、计数对象。
- **Shell脚本中如何捕获命令的退出码？**
  提示：$?变量。
- **如何在Shell脚本中实现并发执行？**
  提示：&后台执行、wait等待、xargs -P。
