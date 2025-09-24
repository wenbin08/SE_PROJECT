@echo off
echo 开始更新教练变更状态表结构和修复历史数据...

mysql -u root -p tt_training < db/migrate_coach_change_status.sql

if %errorlevel% neq 0 (
    echo 错误: 无法执行数据库迁移脚本。请检查MySQL连接和权限。
    exit /b %errorlevel%
)

echo 数据库表结构和历史数据更新成功！
pause