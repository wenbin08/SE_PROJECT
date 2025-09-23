USE tt_training;

-- 清空所有表的数据（按依赖关系倒序删除）
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE coach_change_request;
TRUNCATE TABLE software_license;
TRUNCATE TABLE audit_log;
TRUNCATE TABLE tournament_signup;
TRUNCATE TABLE tournament_schedule;
TRUNCATE TABLE training_review;
TRUNCATE TABLE message;
TRUNCATE TABLE transaction;
TRUNCATE TABLE account;
TRUNCATE TABLE reservation;
TRUNCATE TABLE coach_student;
TRUNCATE TABLE table_court;
TRUNCATE TABLE user;
TRUNCATE TABLE campus;
TRUNCATE TABLE license;
SET FOREIGN_KEY_CHECKS = 1;

-- 插入校区数据
INSERT INTO campus (name, address, contact_name, contact_phone, contact_email) VALUES 
('中心校区', '北京市朝阳区体育路1号', '张建国', '13800000001', 'center@ttclub.com'),
('东区分校', '北京市东城区东四环路88号', '李小华', '13800000002', 'east@ttclub.com'),
('西区分校', '北京市西城区西二环路66号', '王国强', '13800000003', 'west@ttclub.com'),
('南区分校', '北京市丰台区南三环路99号', '赵美丽', '13800000004', 'south@ttclub.com');

-- 插入许可证数据（示例）
INSERT INTO license (purchaser_org, device_fingerprint, license_key, start_date, end_date) VALUES 
('北京乒乓球俱乐部', 'DEVICE-FP-12345', 'LICENSE-KEY-ABCDE-12345', '2025-01-01', '2025-12-31');

-- 插入球台数据
INSERT INTO table_court (campus_id, code) VALUES 
-- 中心校区球台
(1, 'A001'), (1, 'A002'), (1, 'A003'), (1, 'A004'), (1, 'A005'),
(1, 'B001'), (1, 'B002'), (1, 'B003'), (1, 'B004'), (1, 'B005'),
-- 东区分校球台
(2, 'E001'), (2, 'E002'), (2, 'E003'), (2, 'E004'),
-- 西区分校球台
(3, 'W001'), (3, 'W002'), (3, 'W003'),
-- 南区分校球台
(4, 'S001'), (4, 'S002'), (4, 'S003'), (4, 'S004');

-- 插入用户数据（密码明文存储：123456）
INSERT INTO user (username, password_hash, real_name, gender, age, campus_id, phone, email, role, status, coach_level, coach_awards, hourly_fee) VALUES 
-- 超级管理员
('superadmin', '123456', '系统管理员', '男', 35, 1, '13800000001', 'super@ttclub.com', 'super_admin', 'active', NULL, NULL, NULL),

-- 校区管理员
('admin001', '123456', '张建国', '男', 45, 1, '13800000001', 'center@ttclub.com', 'campus_admin', 'active', NULL, NULL, NULL),
('admin002', '123456', '李小华', '女', 38, 2, '13800000002', 'east@ttclub.com', 'campus_admin', 'active', NULL, NULL, NULL),
('admin003', '123456', '王国强', '男', 42, 3, '13800000003', 'west@ttclub.com', 'campus_admin', 'active', NULL, NULL, NULL),
('admin004', '123456', '赵美丽', '女', 39, 4, '13800000004', 'south@ttclub.com', 'campus_admin', 'active', NULL, NULL, NULL),

-- 高级教练员（200元/小时）
('coach001', '123456', '刘德华', '男', 45, 1, '13900000001', 'coach001@ttclub.com', 'coach', 'active', 'senior', '全国乒乓球锦标赛冠军，国家队主力队员', 200.00),
('coach002', '123456', '邓亚萍', '女', 42, 1, '13900000002', 'coach002@ttclub.com', 'coach', 'active', 'senior', '奥运会乒乓球金牌得主，世界冠军', 200.00),
('coach003', '123456', '马龙', '男', 36, 2, '13900000003', 'coach003@ttclub.com', 'coach', 'active', 'senior', '世界乒乓球锦标赛冠军，国家队队长', 200.00),

-- 中级教练员（150元/小时）
('coach004', '123456', '张继科', '男', 38, 1, '13900000004', 'coach004@ttclub.com', 'coach', 'active', 'middle', '全国乒乓球锦标赛季军，国家二级运动员', 150.00),
('coach005', '123456', '丁宁', '女', 34, 2, '13900000005', 'coach005@ttclub.com', 'coach', 'active', 'middle', '省级乒乓球比赛冠军，专业教练认证', 150.00),
('coach006', '123456', '许昕', '男', 35, 3, '13900000006', 'coach006@ttclub.com', 'coach', 'active', 'middle', '市级乒乓球比赛冠军，国家三级运动员', 150.00),
('coach007', '123456', '刘诗雯', '女', 33, 4, '13900000007', 'coach007@ttclub.com', 'coach', 'active', 'middle', '省级乒乓球比赛亚军，专业体校毕业', 150.00),

-- 初级教练员（80元/小时）
('coach008', '123456', '樊振东', '男', 28, 1, '13900000008', 'coach008@ttclub.com', 'coach', 'active', 'junior', '体育学院乒乓球专业毕业，教练资格证书', 80.00),
('coach009', '123456', '陈梦', '女', 30, 2, '13900000009', 'coach009@ttclub.com', 'coach', 'active', 'junior', '区级乒乓球比赛冠军，体育教师资格', 80.00),
('coach010', '123456', '孙颖莎', '女', 26, 3, '13900000010', 'coach010@ttclub.com', 'coach', 'active', 'junior', '大学乒乓球队主力，教练员培训结业', 80.00),

-- 待审核教练员
('pending001', '123456', '李教练', '男', 32, 1, '13900000011', 'pending001@ttclub.com', 'coach', 'pending', 'middle', '市级乒乓球比赛冠军，五年教学经验', 150.00),
('pending002', '123456', '王教练', '女', 29, 1, '13900000012', 'pending002@ttclub.com', 'coach', 'pending', 'junior', '体育专业毕业，教练资格证', 80.00),
('pending003', '123456', '张教练', '男', 35, 2, '13900000013', 'pending003@ttclub.com', 'coach', 'pending', 'senior', '前国家队选手，全国冠军', 200.00),

-- 学员数据
('student001', '123456', '小明', '男', 12, 1, '13700000001', 'xiaoming@student.com', 'student', 'active', NULL, NULL, NULL),
('student002', '123456', '小红', '女', 10, 1, '13700000002', 'xiaohong@student.com', 'student', 'active', NULL, NULL, NULL),
('student003', '123456', '小刚', '男', 14, 1, '13700000003', 'xiaogang@student.com', 'student', 'active', NULL, NULL, NULL),
('student004', '123456', '小丽', '女', 13, 2, '13700000004', 'xiaoli@student.com', 'student', 'active', NULL, NULL, NULL),
('student005', '123456', '小军', '男', 15, 2, '13700000005', 'xiaojun@student.com', 'student', 'active', NULL, NULL, NULL),
('student006', '123456', '小芳', '女', 11, 3, '13700000006', 'xiaofang@student.com', 'student', 'active', NULL, NULL, NULL),
('student007', '123456', '小强', '男', 16, 3, '13700000007', 'xiaoqiang@student.com', 'student', 'active', NULL, NULL, NULL),
('student008', '123456', '小敏', '女', 12, 4, '13700000008', 'xiaomin@student.com', 'student', 'active', NULL, NULL, NULL),
('student009', '123456', '小亮', '男', 17, 4, '13700000009', 'xiaoliang@student.com', 'student', 'active', NULL, NULL, NULL),
('student010', '123456', '小雅', '女', 13, 1, '13700000010', 'xiaoya@student.com', 'student', 'active', NULL, NULL, NULL);

-- 插入账户数据（给学员初始余额）
INSERT INTO account (user_id, balance) VALUES
((SELECT id FROM user WHERE username='student001'), 1000.00),
((SELECT id FROM user WHERE username='student002'), 800.00),
((SELECT id FROM user WHERE username='student003'), 1200.00),
((SELECT id FROM user WHERE username='student004'), 900.00),
((SELECT id FROM user WHERE username='student005'), 1100.00),
((SELECT id FROM user WHERE username='student006'), 700.00),
((SELECT id FROM user WHERE username='student007'), 1300.00),
((SELECT id FROM user WHERE username='student008'), 600.00),
((SELECT id FROM user WHERE username='student009'), 1500.00),
((SELECT id FROM user WHERE username='student010'), 950.00);

-- 插入一些双选关系
INSERT INTO coach_student (coach_id, student_id, status) VALUES 
((SELECT id FROM user WHERE username='coach001'), (SELECT id FROM user WHERE username='student001'), 'approved'),
((SELECT id FROM user WHERE username='coach001'), (SELECT id FROM user WHERE username='student002'), 'approved'),
((SELECT id FROM user WHERE username='coach002'), (SELECT id FROM user WHERE username='student001'), 'approved'),
((SELECT id FROM user WHERE username='coach004'), (SELECT id FROM user WHERE username='student003'), 'approved'),
((SELECT id FROM user WHERE username='coach005'), (SELECT id FROM user WHERE username='student004'), 'approved'),
((SELECT id FROM user WHERE username='coach006'), (SELECT id FROM user WHERE username='student005'), 'approved'),
((SELECT id FROM user WHERE username='coach007'), (SELECT id FROM user WHERE username='student006'), 'approved'),
((SELECT id FROM user WHERE username='coach008'), (SELECT id FROM user WHERE username='student007'), 'approved'),
((SELECT id FROM user WHERE username='coach009'), (SELECT id FROM user WHERE username='student008'), 'approved'),
((SELECT id FROM user WHERE username='coach010'), (SELECT id FROM user WHERE username='student009'), 'approved');

-- 插入一些示例预约
INSERT INTO reservation (campus_id, coach_id, student_id, table_id, start_time, end_time, status) VALUES 
(1, (SELECT id FROM user WHERE username='coach001'), (SELECT id FROM user WHERE username='student001'), 1, '2025-09-20 09:00:00', '2025-09-20 10:00:00', 'confirmed'),
(1, (SELECT id FROM user WHERE username='coach002'), (SELECT id FROM user WHERE username='student002'), 2, '2025-09-20 10:00:00', '2025-09-20 11:00:00', 'pending'),
(2, (SELECT id FROM user WHERE username='coach005'), (SELECT id FROM user WHERE username='student004'), 11, '2025-09-20 14:00:00', '2025-09-20 15:00:00', 'confirmed'),
(3, (SELECT id FROM user WHERE username='coach006'), (SELECT id FROM user WHERE username='student005'), 14, '2025-09-21 09:00:00', '2025-09-21 10:00:00', 'pending');

-- 插入一些示例消息
INSERT INTO message (recipient_id, title, content) VALUES 
((SELECT id FROM user WHERE username='student001'), '欢迎加入', '欢迎您加入我们的乒乓球培训俱乐部！'),
((SELECT id FROM user WHERE username='coach001'), '新学员申请', '有新的学员申请与您建立双选关系'),
((SELECT id FROM user WHERE username='student002'), '预约确认', '您的预约已被教练确认，请准时上课'),
((SELECT id FROM user WHERE username='admin001'), '系统通知', '系统已成功初始化，请开始使用');

-- 插入一些充值交易记录
INSERT INTO `transaction` (user_id, amount, type) VALUES 
((SELECT id FROM user WHERE username='student001'), 1000.00, 'recharge'),
((SELECT id FROM user WHERE username='student002'), 800.00, 'recharge'),
((SELECT id FROM user WHERE username='student003'), 1200.00, 'recharge'),
((SELECT id FROM user WHERE username='student004'), 900.00, 'recharge'),
((SELECT id FROM user WHERE username='student005'), 1100.00, 'recharge');

-- 插入月赛报名示例
INSERT INTO tournament_signup (user_id, group_level, paid) VALUES 
((SELECT id FROM user WHERE username='student001'), 'A', 1),
((SELECT id FROM user WHERE username='student002'), 'A', 1),
((SELECT id FROM user WHERE username='student003'), 'B', 1),
((SELECT id FROM user WHERE username='student004'), 'B', 1),
((SELECT id FROM user WHERE username='student005'), 'C', 1),
((SELECT id FROM user WHERE username='student006'), 'C', 1);


-- 添加更多学员数据
INSERT INTO user (username, password_hash, real_name, gender, age, campus_id, phone, email, role, status, coach_level, coach_awards, hourly_fee) VALUES
('student011', '123456', '张三丰', '男', 15, 1, '13700000011', 'zhangsanfeng@student.com', 'student', 'active', NULL, NULL, NULL),
('student012', '123456', '李四海', '男', 14, 1, '13700000012', 'lisihai@student.com', 'student', 'active', NULL, NULL, NULL),
('student013', '123456', '王五妹', '女', 16, 2, '13700000013', 'wangwumei@student.com', 'student', 'active', NULL, NULL, NULL),
('student014', '123456', '赵六娃', '男', 13, 2, '13700000014', 'zhaoliuwa@student.com', 'student', 'active', NULL, NULL, NULL),
('student015', '123456', '孙七星', '男', 17, 3, '13700000015', 'sunqixing@student.com', 'student', 'active', NULL, NULL, NULL),
('student016', '123456', '周八月', '女', 15, 3, '13700000016', 'zhoubayue@student.com', 'student', 'active', NULL, NULL, NULL),
('student017', '123456', '吴九天', '男', 14, 4, '13700000017', 'wujiutian@student.com', 'student', 'active', NULL, NULL, NULL),
('student018', '123456', '郑十方', '女', 16, 4, '13700000018', 'zhengshifang@student.com', 'student', 'active', NULL, NULL, NULL),
('student019', '123456', '陈一鸣', '男', 15, 1, '13700000019', 'chenyiming@student.com', 'student', 'active', NULL, NULL, NULL),
('student020', '123456', '刘二娟', '女', 14, 2, '13700000020', 'liuerjuan@student.com', 'student', 'active', NULL, NULL, NULL);

-- 添加更多教练数据
INSERT INTO user (username, password_hash, real_name, gender, age, campus_id, phone, email, role, status, coach_level, coach_awards, hourly_fee) VALUES
('coach011', '123456', '杨过', '男', 32, 1, '13900000011', 'yangguo@ttclub.com', 'coach', 'active', 'middle', '省级比赛第三名，技术全面', 150.00),
('coach012', '123456', '小龙女', '女', 29, 1, '13900000012', 'xiaolongnv@ttclub.com', 'coach', 'active', 'senior', '全国比赛亚军，反手技术一流', 200.00),
('coach013', '123456', '郭靖', '男', 35, 2, '13900000013', 'guojing@ttclub.com', 'coach', 'active', 'middle', '市级比赛冠军，基础扎实', 150.00),
('coach014', '123456', '黄蓉', '女', 31, 2, '13900000014', 'huangrong@ttclub.com', 'coach', 'active', 'junior', '区级比赛冠军，善于教学', 80.00),
('coach015', '123456', '张无忌', '男', 28, 3, '13900000015', 'zhangwuji@ttclub.com', 'coach', 'active', 'junior', '新人教练，专业院校毕业', 80.00);

-- 为新学员添加账户余额
INSERT INTO account (user_id, balance) VALUES
((SELECT id FROM user WHERE username='student011'), 800.00),
((SELECT id FROM user WHERE username='student012'), 750.00),
((SELECT id FROM user WHERE username='student013'), 900.00),
((SELECT id FROM user WHERE username='student014'), 650.00),
((SELECT id FROM user WHERE username='student015'), 1100.00),
((SELECT id FROM user WHERE username='student016'), 950.00),
((SELECT id FROM user WHERE username='student017'), 700.00),
((SELECT id FROM user WHERE username='student018'), 1200.00),
((SELECT id FROM user WHERE username='student019'), 850.00),
((SELECT id FROM user WHERE username='student020'), 1000.00);

-- 添加更多双选关系
INSERT INTO coach_student (coach_id, student_id, status) VALUES 
((SELECT id FROM user WHERE username='coach011'), (SELECT id FROM user WHERE username='student011'), 'approved'),
((SELECT id FROM user WHERE username='coach012'), (SELECT id FROM user WHERE username='student012'), 'approved'),
((SELECT id FROM user WHERE username='coach013'), (SELECT id FROM user WHERE username='student013'), 'approved'),
((SELECT id FROM user WHERE username='coach014'), (SELECT id FROM user WHERE username='student014'), 'approved'),
((SELECT id FROM user WHERE username='coach015'), (SELECT id FROM user WHERE username='student015'), 'approved'),
((SELECT id FROM user WHERE username='coach011'), (SELECT id FROM user WHERE username='student016'), 'approved'),
((SELECT id FROM user WHERE username='coach012'), (SELECT id FROM user WHERE username='student017'), 'pending'),
((SELECT id FROM user WHERE username='coach013'), (SELECT id FROM user WHERE username='student018'), 'pending'),
((SELECT id FROM user WHERE username='coach014'), (SELECT id FROM user WHERE username='student019'), 'approved'),
((SELECT id FROM user WHERE username='coach015'), (SELECT id FROM user WHERE username='student020'), 'approved');

-- 添加更多预约数据（包含不同时间和状态）
INSERT INTO reservation (campus_id, coach_id, student_id, table_id, start_time, end_time, status) VALUES 
-- 今天的预约
(1, (SELECT id FROM user WHERE username='coach011'), (SELECT id FROM user WHERE username='student011'), 3, '2025-09-19 15:00:00', '2025-09-19 16:00:00', 'confirmed'),
(1, (SELECT id FROM user WHERE username='coach012'), (SELECT id FROM user WHERE username='student012'), 4, '2025-09-19 16:00:00', '2025-09-19 17:00:00', 'confirmed'),
-- 明天的预约
(2, (SELECT id FROM user WHERE username='coach013'), (SELECT id FROM user WHERE username='student013'), 12, '2025-09-20 08:00:00', '2025-09-20 09:00:00', 'confirmed'),
(2, (SELECT id FROM user WHERE username='coach014'), (SELECT id FROM user WHERE username='student014'), 13, '2025-09-20 11:00:00', '2025-09-20 12:00:00', 'pending'),
(3, (SELECT id FROM user WHERE username='coach015'), (SELECT id FROM user WHERE username='student015'), 15, '2025-09-20 13:00:00', '2025-09-20 14:00:00', 'confirmed'),
-- 后天的预约
(1, (SELECT id FROM user WHERE username='coach001'), (SELECT id FROM user WHERE username='student016'), 5, '2025-09-21 10:00:00', '2025-09-21 11:00:00', 'pending'),
(4, (SELECT id FROM user WHERE username='coach011'), (SELECT id FROM user WHERE username='student019'), 18, '2025-09-21 14:00:00', '2025-09-21 15:00:00', 'confirmed'),
-- 已完成的预约
(1, (SELECT id FROM user WHERE username='coach001'), (SELECT id FROM user WHERE username='student001'), 1, '2025-09-18 09:00:00', '2025-09-18 10:00:00', 'completed'),
(2, (SELECT id FROM user WHERE username='coach005'), (SELECT id FROM user WHERE username='student004'), 11, '2025-09-18 14:00:00', '2025-09-18 15:00:00', 'completed'),
(3, (SELECT id FROM user WHERE username='coach006'), (SELECT id FROM user WHERE username='student005'), 14, '2025-09-18 16:00:00', '2025-09-18 17:00:00', 'completed');

-- 添加更多消息数据
INSERT INTO message (recipient_id, title, content) VALUES 
((SELECT id FROM user WHERE username='student011'), '教练申请通过', '您申请的教练杨过已通过您的申请，可以开始预约课程了'),
((SELECT id FROM user WHERE username='coach011'), '新学员通知', '学员张三丰已成为您的学员'),
((SELECT id FROM user WHERE username='student012'), '预约提醒', '您今天下午4点有一节课，请提前10分钟到达'),
((SELECT id FROM user WHERE username='coach012'), '课程提醒', '您今天下午4点有课程安排，学员：李四海'),
((SELECT id FROM user WHERE username='admin001'), '月赛通知', '本月月赛将于本周日举行，请及时查看赛程安排'),
((SELECT id FROM user WHERE username='student013'), '充值成功', '您的账户已成功充值900元'),
((SELECT id FROM user WHERE username='student014'), '预约待确认', '您的预约申请已提交，等待教练确认'),
((SELECT id FROM user WHERE username='coach014'), '预约申请', '学员赵六娃申请预约明天上午11点的课程'),
((SELECT id FROM user WHERE username='student015'), '课程取消', '由于教练临时有事，明天的课程已取消，费用已退回账户'),
((SELECT id FROM user WHERE username='coach015'), '评价提醒', '请对昨天与学员孙七星的课程进行评价');

-- 添加更多交易记录
INSERT INTO `transaction` (user_id, amount, type) VALUES 
((SELECT id FROM user WHERE username='student011'), 800.00, 'recharge'),
((SELECT id FROM user WHERE username='student012'), 750.00, 'recharge'),
((SELECT id FROM user WHERE username='student013'), 900.00, 'recharge'),
((SELECT id FROM user WHERE username='student014'), 650.00, 'recharge'),
((SELECT id FROM user WHERE username='student015'), 1100.00, 'recharge'),
-- 课程扣费记录
((SELECT id FROM user WHERE username='student001'), -200.00, 'reservation_fee'),
((SELECT id FROM user WHERE username='student004'), -150.00, 'reservation_fee'),
((SELECT id FROM user WHERE username='student005'), -150.00, 'reservation_fee'),
((SELECT id FROM user WHERE username='student011'), -150.00, 'reservation_fee'),
((SELECT id FROM user WHERE username='student012'), -200.00, 'reservation_fee'),
-- 月赛报名费
((SELECT id FROM user WHERE username='student001'), -30.00, 'signup_fee'),
((SELECT id FROM user WHERE username='student002'), -30.00, 'signup_fee'),
((SELECT id FROM user WHERE username='student003'), -30.00, 'signup_fee');

-- 添加更多月赛报名
INSERT INTO tournament_signup (user_id, group_level, paid) VALUES 
((SELECT id FROM user WHERE username='student007'), 'A', 1),
((SELECT id FROM user WHERE username='student008'), 'B', 1),
((SELECT id FROM user WHERE username='student009'), 'B', 1),
((SELECT id FROM user WHERE username='student010'), 'C', 1),
((SELECT id FROM user WHERE username='student011'), 'C', 1),
((SELECT id FROM user WHERE username='student012'), 'A', 1),
((SELECT id FROM user WHERE username='student013'), 'B', 0),
((SELECT id FROM user WHERE username='student014'), 'C', 0);