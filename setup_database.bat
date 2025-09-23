@echo off
echo ==============================================
echo    乒乓球训练管理系统 - 数据库初始化脚本
echo ==============================================
echo.

REM 检查MySQL是否安装
where mysql >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 找不到MySQL命令！请确保MySQL已安装并添加到系统PATH中。
    pause
    exit /b 1
)

echo 请确保您已经：
echo 1. 启动了MySQL服务
echo 2. 准备好MySQL root密码
echo.

set /p root_password=请输入MySQL root密码: 

echo.
echo 正在创建数据库...
mysql -u root -p%root_password% -e "CREATE DATABASE IF NOT EXISTS ping_pong_training CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 创建数据库失败！请检查密码是否正确。
    pause
    exit /b 1
)

echo 数据库创建成功！
echo.
echo 正在导入数据库结构...
mysql -u root -p%root_password% ping_pong_training < db\schema.sql

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 导入数据库结构失败！
    pause
    exit /b 1
)

echo 数据库结构导入成功！
echo.
echo 正在导入测试数据...
mysql -u root -p%root_password% ping_pong_training < db\seed.sql

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 导入测试数据失败！
    pause
    exit /b 1
)

echo.
echo ==============================================
echo          数据库初始化完成！
echo ==============================================
echo.
echo 系统已经创建了以下测试账户：
echo.
echo 超级管理员:
echo   用户名: admin    密码: admin123
echo.
echo 校区管理员:
echo   用户名: campus1  密码: campus123
echo   用户名: campus2  密码: campus123
echo.
echo 教练:
echo   用户名: coach1   密码: coach123
echo   用户名: coach2   密码: coach123
echo   用户名: coach3   密码: coach123
echo.
echo 学生:
echo   用户名: student1 密码: student123
echo   用户名: student2 密码: student123
echo   用户名: student3 密码: student123
echo.
echo 您现在可以启动服务器并登录系统了！
echo 运行命令: npm start
echo.
pause