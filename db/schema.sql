-- 基础库
CREATE DATABASE IF NOT EXISTS ping_pong_training CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ping_pong_training;

-- 授权/许可
CREATE TABLE IF NOT EXISTS license (
  id INT PRIMARY KEY AUTO_INCREMENT,
  purchaser_org VARCHAR(100) NOT NULL,
  device_fingerprint VARCHAR(128) NOT NULL,
  license_key VARCHAR(128) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 校区
CREATE TABLE IF NOT EXISTS campus (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255),
  contact_name VARCHAR(50),
  contact_phone VARCHAR(50),
  contact_email VARCHAR(100)
);

-- 用户与角色（超级管理员、校区管理员、学员、教练）
CREATE TABLE IF NOT EXISTS user (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  real_name VARCHAR(50) NOT NULL,
  gender ENUM('男','女') DEFAULT '男',
  age INT,
  campus_id INT,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(100),
  avatar_url VARCHAR(255),
  role ENUM('super_admin','campus_admin','student','coach') NOT NULL,
  status ENUM('pending','active','rejected') DEFAULT 'active',
  coach_level ENUM('senior','middle','junior') NULL,
  coach_awards TEXT,
  hourly_fee DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campus_id) REFERENCES campus(id)
);

-- 教练-学员双选关系
CREATE TABLE IF NOT EXISTS coach_student (
  id INT PRIMARY KEY AUTO_INCREMENT,
  coach_id INT NOT NULL,
  student_id INT NOT NULL,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_pair (coach_id, student_id),
  FOREIGN KEY (coach_id) REFERENCES user(id),
  FOREIGN KEY (student_id) REFERENCES user(id)
);

-- 球台
CREATE TABLE IF NOT EXISTS table_court (
  id INT PRIMARY KEY AUTO_INCREMENT,
  campus_id INT NOT NULL,
  code VARCHAR(20) NOT NULL,
  UNIQUE KEY uniq_campus_code (campus_id, code),
  FOREIGN KEY (campus_id) REFERENCES campus(id)
);

-- 预约
CREATE TABLE IF NOT EXISTS reservation (
  id INT PRIMARY KEY AUTO_INCREMENT,
  campus_id INT NOT NULL,
  coach_id INT NOT NULL,
  student_id INT NOT NULL,
  table_id INT,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  status ENUM('pending','confirmed','rejected','canceled','completed') DEFAULT 'pending',
  cancel_request_by ENUM('student','coach', 'none') DEFAULT 'none',
  cancel_count_month_student INT DEFAULT 0,
  cancel_count_month_coach INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campus_id) REFERENCES campus(id),
  FOREIGN KEY (coach_id) REFERENCES user(id),
  FOREIGN KEY (student_id) REFERENCES user(id),
  FOREIGN KEY (table_id) REFERENCES table_court(id)
);

-- 账户与支付
CREATE TABLE IF NOT EXISTS account (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT UNIQUE,
  balance DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE TABLE IF NOT EXISTS transaction (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  type ENUM('recharge','reservation_fee','refund','signup_fee') NOT NULL,
  ref_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

-- 消息通知
CREATE TABLE IF NOT EXISTS message (
  id INT PRIMARY KEY AUTO_INCREMENT,
  recipient_id INT NOT NULL,
  title VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipient_id) REFERENCES user(id)
);

-- 训练评价
CREATE TABLE IF NOT EXISTS training_review (
  id INT PRIMARY KEY AUTO_INCREMENT,
  reservation_id INT NOT NULL,
  reviewer_id INT NOT NULL,
  role ENUM('student','coach') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservation(id),
  FOREIGN KEY (reviewer_id) REFERENCES user(id)
);

-- 月赛报名与编排
CREATE TABLE IF NOT EXISTS tournament_signup (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  group_level ENUM('A','B','C') NOT NULL,
  paid TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

CREATE TABLE IF NOT EXISTS tournament_schedule (
  id INT PRIMARY KEY AUTO_INCREMENT,
  group_level ENUM('A','B','C') NOT NULL,
  round_no INT NOT NULL,
  player1_id INT,
  player2_id INT,
  table_id INT,
  match_time DATETIME,
  FOREIGN KEY (player1_id) REFERENCES user(id),
  FOREIGN KEY (player2_id) REFERENCES user(id),
  FOREIGN KEY (table_id) REFERENCES table_court(id)
);

-- 换教练申请表
CREATE TABLE IF NOT EXISTS coach_change_request (
  id INT PRIMARY KEY AUTO_INCREMENT,
  student_id INT NOT NULL,
  current_coach_id INT NOT NULL,
  new_coach_id INT NOT NULL,
  reason TEXT,
  status ENUM('pending', 'current_coach_approved', 'new_coach_approved', 'admin_approved', 'rejected') DEFAULT 'pending',
  current_coach_response TEXT,
  new_coach_response TEXT,
  admin_response TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES user(id),
  FOREIGN KEY (current_coach_id) REFERENCES user(id),
  FOREIGN KEY (new_coach_id) REFERENCES user(id)
);

-- 软件授权表
CREATE TABLE IF NOT EXISTS software_license (
  id INT PRIMARY KEY AUTO_INCREMENT,
  license_key VARCHAR(100) UNIQUE NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  expire_date DATE NOT NULL,
  max_users INT DEFAULT 500,
  status ENUM('active', 'expired', 'revoked') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  action VARCHAR(100) NOT NULL,
  user_id INT,
  details JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES user(id)
);

-- 添加缺失的字段
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS paid BOOLEAN DEFAULT FALSE;
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS fee DECIMAL(8,2) DEFAULT 100.00;
ALTER TABLE reservation ADD COLUMN IF NOT EXISTS notes TEXT;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_user_role ON user(role);
CREATE INDEX IF NOT EXISTS idx_user_campus ON user(campus_id);
CREATE INDEX IF NOT EXISTS idx_reservation_student ON reservation(student_id);
CREATE INDEX IF NOT EXISTS idx_reservation_coach ON reservation(coach_id);
CREATE INDEX IF NOT EXISTS idx_reservation_time ON reservation(start_time);
CREATE INDEX IF NOT EXISTS idx_message_user ON message(recipient_id);
CREATE INDEX IF NOT EXISTS idx_transaction_user ON transaction(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_training_review_reservation ON training_review(reservation_id);
CREATE INDEX IF NOT EXISTS idx_tournament_signup_group ON tournament_signup(group_level);
