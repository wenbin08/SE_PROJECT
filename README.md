# 乒乓球培训管理系统（课程设计）

基于 Node.js + Express + MySQL 的完整培训管理系统，已对照《2025年软件工程课程设计题目.pdf》实现所有核心功能：注册与审核、教练双选、预约排课、账户充值与扣费/退款、系统消息、课前提醒、课后评价、月赛报名与基础排赛、许可激活与校验。

## 🚀 快速开始

### 方法一：使用自动化脚本（推荐）
1. 双击运行 `setup_database.bat` 脚本
2. 按提示输入MySQL root密码
3. 脚本会自动创建数据库、导入结构和测试数据

### 方法二：手动设置
1. 创建数据库：
```sql
CREATE DATABASE ping_pong_training CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. 导入数据库结构和数据：
```powershell
mysql -u root -p ping_pong_training < db/schema.sql
mysql -u root -p ping_pong_training < db/seed.sql
```

3. 安装依赖并启动服务器：
```powershell
cd d:\Desktop\Databasev3\new_se_project
npm install
npm start
```

4. 打开浏览器访问 http://localhost:3001

## 🔧 测试系统

访问 http://localhost:3001/test.html 进行系统功能测试

### 预置测试账户
| 角色 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 超级管理员 | admin | admin123 | 系统总管理，许可管理 |
| 校区管理员 | campus1/campus2 | campus123 | 校区管理，用户审核 |
| 教练 | coach1/coach2/coach3 | coach123 | 接受预约，课程管理 |
| 学生 | student1/student2/student3 | student123 | 预约课程，参加比赛 |

## 💡 主要功能

### 🎯 用户管理
- **注册与登录**：支持学生、教练注册，校区管理员审核
- **角色权限**：超级管理员、校区管理员、教练、学生四级权限
- **身份验证**：统一的localStorage身份验证系统

### 📚 教学管理
- **师生双选**：学生选择教练，教练确认师生关系
- **预约排课**：学生预约课程，教练确认，系统自动分配球台
- **冲突检测**：防止时间、球台冲突，智能排课

### 💰 财务管理
- **账户充值**：支持在线充值，实时更新余额
- **课程扣费**：预约确认后自动扣费，课程取消自动退款
- **交易记录**：完整的财务流水记录

### 📢 消息系统
- **系统消息**：预约状态变更、余额变化等系统通知
- **课前提醒**：自动发送课前5-60分钟提醒
- **实时更新**：页面自动刷新消息状态

### ⭐ 评价系统
- **课后评价**：学生对教练进行星级评价和文字评论
- **评价管理**：教练查看收到的评价，学生管理已发布评价
- **统计分析**：教练评价统计，平均分展示

### 🏆 竞赛管理
- **月赛报名**：学生报名参加月度比赛
- **自动排赛**：支持循环赛制，自动生成赛程
- **比赛管理**：校区管理员管理比赛流程

### 🔑 许可管理
- **软件许可**：支持许可证激活和校验
- **到期管理**：许可证到期提醒和续费
- **权限控制**：基于许可证的功能访问控制

## 🗂️ 目录结构
```
├── server.js                 # 服务端入口，所有API接口
├── package.json              # 项目依赖配置
├── setup_database.bat        # 数据库自动化设置脚本
├── db/
│   ├── schema.sql            # 数据库结构定义
│   └── seed.sql              # 测试数据导入
├── public/
│   ├── css/                  # 样式文件
│   └── js/                   # 前端JavaScript
├── views/
│   ├── index.html            # 登录注册页面
│   ├── student.html          # 学生管理界面
│   ├── teacher.html          # 教练管理界面
│   ├── admin.html            # 管理员界面
│   ├── reviews.html          # 评价系统页面
│   ├── tournament.html       # 月赛管理页面
│   └── test.html             # 系统测试页面
└── scripts/
    └── extract_pdf.js        # PDF文本提取工具
```

## 🐛 问题修复记录

### v1.2.1 修复内容
- ✅ 修复月赛页面登录跳转问题（localStorage键名统一）
- ✅ 修复评价页面用户信息自动读取
- ✅ 修复数据库导入重复键错误
- ✅ 统一数据库表名引用（table_court）
- ✅ 完善评价系统UI和功能

### 技术改进
- 🔧 统一localStorage用户数据键名为'userData'
- 🔧 添加数据库TRUNCATE语句防止导入冲突
- 🔧 修复所有SQL JOIN语句的表名引用
- 🔧 提供自动化数据库设置脚本

## 📋 API接口文档

### 认证接口
- `POST /api/login` - 用户登录
- `POST /api/register` - 用户注册

### 用户管理
- `GET /api/students` - 获取学生列表
- `GET /api/coaches` - 获取教练列表
- `POST /api/approve-user` - 审核用户

### 预约管理
- `GET /api/reservations` - 获取预约列表
- `POST /api/reservation` - 创建预约
- `POST /api/reservation/confirm` - 确认预约

### 财务管理
- `GET /api/account/:userId` - 获取账户信息
- `POST /api/recharge` - 账户充值
- `GET /api/transactions/:userId` - 交易记录

### 评价系统
- `GET /api/reviews/pending/:user_id` - 待评价课程
- `POST /api/reviews/submit` - 提交评价
- `GET /api/reviews/received/:coach_id` - 教练收到的评价

### 比赛管理
- `GET /api/tournament/current` - 当前比赛信息
- `POST /api/tournament/signup` - 比赛报名

## 🎯 开发进度

### 核心功能 ✅
- [x] 用户注册/登录/审核系统
- [x] 师生双选与关系管理
- [x] 预约排课与球台分配
- [x] 账户充值/扣费/退款
- [x] 系统消息与课前提醒
- [x] 课后评价系统
- [x] 月赛报名与排赛
- [x] 软件许可管理

### 技术特性 ✅
- [x] RESTful API设计
- [x] MySQL数据库持久化
- [x] Bootstrap响应式UI
- [x] 实时消息提醒
- [x] 数据一致性保证
- [x] 错误处理与日志

## 📞 技术支持

如遇到问题，请检查：
1. MySQL服务是否启动
2. 数据库是否正确导入
3. Node.js依赖是否安装完整
4. 端口3001是否被占用

系统日志会在控制台输出，便于问题排查。

## 快速验证（PowerShell）
```powershell
# 双选
irm http://localhost:3001/api/coach/select -Method POST -Body (@{coach_id=3;student_id=2} | ConvertTo-Json) -ContentType 'application/json'
irm http://localhost:3001/api/coach/select/approve -Method POST -Body (@{coach_id=3;student_id=2;approve=$true} | ConvertTo-Json) -ContentType 'application/json'

# 充值
irm http://localhost:3001/api/account/recharge -Method POST -Body (@{user_id=2;amount=200;method='qr'} | ConvertTo-Json) -ContentType 'application/json'

# 预约
$start=(Get-Date).AddDays(2).AddHours(10).ToString('s')
$end=(Get-Date).AddDays(2).AddHours(11).ToString('s')
irm http://localhost:3001/api/reservations -Method POST -Body (@{campus_id=1;coach_id=3;student_id=2;start_time=$start;end_time=$end} | ConvertTo-Json) -ContentType 'application/json'
```
