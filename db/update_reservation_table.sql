-- 更新reservation表以支持取消预约功能
ALTER TABLE reservation 
MODIFY COLUMN status ENUM('pending','confirmed','rejected','canceled','completed','cancel_requested') DEFAULT 'pending',
ADD COLUMN cancel_request_time DATETIME NULL AFTER cancel_request_by,
ADD COLUMN cancel_confirm_time DATETIME NULL AFTER cancel_request_time,
ADD COLUMN cancel_reason TEXT NULL AFTER cancel_confirm_time,
ADD COLUMN payment_id INT NULL AFTER cancel_count_month_coach,
ADD COLUMN payment_refunded BOOLEAN DEFAULT FALSE AFTER payment_id,
ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
ADD FOREIGN KEY (payment_id) REFERENCES transaction(id) ON DELETE SET NULL;

-- 如果现有行的cancel_count_month_student或cancel_count_month_coach为NULL，将其设为0
UPDATE reservation SET cancel_count_month_student = 0 WHERE cancel_count_month_student IS NULL;
UPDATE reservation SET cancel_count_month_coach = 0 WHERE cancel_count_month_coach IS NULL;

-- 创建触发器，在每月1日重置取消计数
DELIMITER $$
CREATE TRIGGER IF NOT EXISTS reset_cancel_count_monthly
BEFORE UPDATE ON reservation
FOR EACH ROW
BEGIN
    DECLARE first_day_of_month BOOLEAN;
    SET first_day_of_month = (DAYOFMONTH(CURDATE()) = 1 AND 
                             (NEW.updated_at IS NULL OR DATE(NEW.updated_at) <> CURDATE()));
    
    IF first_day_of_month THEN
        SET NEW.cancel_count_month_student = 0;
        SET NEW.cancel_count_month_coach = 0;
    END IF;
END$$
DELIMITER ;