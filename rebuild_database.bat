@echo off
echo ==============================================
echo    数据库快速重建脚本
echo ==============================================
echo.

set /p root_password=请输入MySQL root密码: 

echo.
echo 第一步：删除旧数据库并重新创建...
mysql -u root -p%root_password% -e "DROP DATABASE IF EXISTS ping_pong_training; CREATE DATABASE ping_pong_training CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 数据库操作失败！
    pause
    exit /b 1
)

echo 第二步：导入数据库结构...
mysql -u root -p%root_password% ping_pong_training < db\schema.sql

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 导入结构失败！
    pause
    exit /b 1
)

echo 第三步：导入测试数据...
mysql -u root -p%root_password% ping_pong_training < db\seed.sql

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 导入数据失败！
    pause
    exit /b 1
)

echo.
echo ==============================================
echo          数据库重建成功！
echo ==============================================
echo.

echo 验证数据导入情况:
echo.
echo 用户统计:
mysql -u root -p%root_password% ping_pong_training -e "SELECT role, COUNT(*) as count FROM user GROUP BY role;"

echo.
echo 校区统计:
mysql -u root -p%root_password% ping_pong_training -e "SELECT id, name FROM campus;"

echo.
echo 球台统计:
mysql -u root -p%root_password% ping_pong_training -e "SELECT campus_id, COUNT(*) as table_count FROM table_court GROUP BY campus_id;"

echo.
echo 账户余额统计:
mysql -u root -p%root_password% ping_pong_training -e "SELECT COUNT(*) as account_count, SUM(balance) as total_balance FROM account;"

echo.
echo 数据库验证完成！现在可以启动服务器了。
pause