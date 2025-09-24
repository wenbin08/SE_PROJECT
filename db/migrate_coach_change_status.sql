-- 更新coach_change_request表的状态枚举，添加completed状态
ALTER TABLE coach_change_request MODIFY COLUMN status ENUM('pending', 'current_coach_approved', 'new_coach_approved', 'admin_approved', 'rejected', 'completed') DEFAULT 'pending';

-- 修复历史数据，将处于中间状态的申请保持为pending，除非所有三方已同意
UPDATE coach_change_request
SET status = 'pending'
WHERE status IN ('current_coach_approved', 'new_coach_approved', 'admin_approved')
AND (current_coach_response IS NULL OR new_coach_response IS NULL OR admin_response IS NULL);

-- 如果三方都已同意但状态不是completed，则更新为completed
UPDATE coach_change_request
SET status = 'completed'
WHERE current_coach_response IS NOT NULL 
AND current_coach_response != '拒绝'
AND new_coach_response IS NOT NULL 
AND new_coach_response != '拒绝'
AND admin_response IS NOT NULL 
AND admin_response != '拒绝'
AND status != 'completed'
AND status != 'rejected';
