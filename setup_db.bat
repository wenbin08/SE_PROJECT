@echo off
echo 正在重新创建数据库架构...
mysql -u root -p -e "DROP DATABASE IF EXISTS tt_training; CREATE DATABASE tt_training CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo 正在导入架构...
mysql -u root -p tt_training < db/schema.sql

echo 正在导入测试数据...
mysql -u root -p tt_training < db/seed.sql

echo 数据库导入完成！
pause