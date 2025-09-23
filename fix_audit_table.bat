@echo off
echo 修复数据库schema中的audit_log表...

mysql -u root -p123456 -e "USE tt_training; DROP TABLE IF EXISTS audit_log;"
mysql -u root -p123456 -e "USE tt_training; CREATE TABLE audit_log (id INT PRIMARY KEY AUTO_INCREMENT, action VARCHAR(100) NOT NULL, user_id INT, details JSON, ip_address VARCHAR(45), user_agent TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"

echo audit_log表已重新创建，使用user_id字段
pause