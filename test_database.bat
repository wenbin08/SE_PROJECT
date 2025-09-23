@echo off
echo ==============================================
echo    测试数据库导入脚本
echo ==============================================
echo.

set /p root_password=请输入MySQL root密码: 

echo.
echo 正在测试数据库导入...

echo 第一步：重新创建数据库...
mysql -u root -p%root_password% -e "DROP DATABASE IF EXISTS ping_pong_training; CREATE DATABASE ping_pong_training CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 创建数据库失败！
    pause
    exit /b 1
)

echo 第二步：导入数据库结构...
mysql -u root -p%root_password% < db\schema.sql

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 导入数据库结构失败！
    pause
    exit /b 1
)

echo 第三步：导入测试数据...
mysql -u root -p%root_password% < db\seed.sql

if %ERRORLEVEL% NEQ 0 (
    echo 错误: 导入测试数据失败！请检查数据类型是否匹配。
    pause
    exit /b 1
)

echo.
echo ==============================================
echo          数据库导入测试成功！
echo ==============================================
echo.
echo 正在验证数据...

echo 检查用户数量:
mysql -u root -p%root_password% ping_pong_training -e "SELECT role, COUNT(*) as count FROM user GROUP BY role;"

echo.
echo 检查交易记录:
mysql -u root -p%root_password% ping_pong_training -e "SELECT type, COUNT(*) as count FROM transaction GROUP BY type;"

echo.
echo 检查球台数量:
mysql -u root -p%root_password% ping_pong_training -e "SELECT campus_id, COUNT(*) as table_count FROM table_court GROUP BY campus_id;"

echo.
echo 数据库验证完成！
pause