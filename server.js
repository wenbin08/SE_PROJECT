// server.js - new_se_project 骨架
const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// 全局错误处理，防止服务器崩溃
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
  console.error('错误堆栈:', err.stack);
  // 不退出进程，继续运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  console.error('Promise:', promise);
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// 简单许可校验中间件（占位，可扩展到 license 表）
app.use((req, res, next) => {
  // 这里可以添加对 license 的校验，如到期时间、设备指纹等
  next();
});

// 数据库连接配置（与 old_project 保持一致占位，可在 .env 中覆盖）
const db = mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '123456',
  database: process.env.DB_NAME || 'tt_training'
});

// 数据库连接错误处理
db.on('error', (err) => {
  console.error('数据库连接错误:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    console.log('重新连接数据库...');
    // 这里可以添加重连逻辑
  }
});

db.connect((err) => {
  if (err) {
    console.error('数据库连接错误：', err);
    return;
  }
  console.log('成功连接到 MySQL 数据库');
  // 初始化附加表（如审计日志）
  const auditSql = `CREATE TABLE IF NOT EXISTS audit_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    action VARCHAR(100) NOT NULL,
    user_id INT NULL,
    details JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;
  db.query(auditSql, (err) => {
    if (err) {
      console.error('创建audit_log表失败:', err);
    } else {
      console.log('audit_log表已确保存在');
    }
  });
  // 启动时尝试创建默认账号（可控的幂等写入）
  ensureDefaultUsers();
});

// 审计日志
function logAudit(action, actorId, detailsObj) {
  try {
    const details = detailsObj ? JSON.stringify(detailsObj) : null;
    db.query(`INSERT INTO audit_log (action, user_id, details) VALUES (?, ?, ?)`, 
      [action, actorId || null, details], (err) => {
        if (err) console.error('审计日志记录失败:', err);
      });
  } catch(e) { 
    console.error('logAudit函数异常:', e);
  }
}

// 密码验证函数（已简化，允许任何密码）
function validatePassword(pwd){
  return pwd && pwd.length > 0; // 只要不为空即可
}

// 简单邮箱/手机校验
function validateEmail(email){
  if (!email) return true; // 可选字段
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePhone(phone){
  return !!phone && /\d{6,15}/.test(String(phone));
}

// 创建默认账号：superadmin/campusadmin/student1/coach1，初始密码均为 123456
function ensureDefaultUsers(cb){
  // 直接使用明文密码
  const password = '123456';
  const users = [
    { username: 'superadmin', real_name: '系统管理员', role: 'super_admin', status: 'active', coach_level: null, hourly_fee: null },
    { username: 'campusadmin', real_name: '校区管理员', role: 'campus_admin', status: 'active', coach_level: null, hourly_fee: null },
    { username: 'student1', real_name: '学生一', role: 'student', status: 'active', coach_level: null, hourly_fee: null },
    { username: 'coach1', real_name: '教练一', role: 'coach', status: 'active', coach_level: 'middle', hourly_fee: 150 }
  ];
  const sql = `INSERT INTO user (username, password_hash, real_name, gender, age, campus_id, phone, email, role, status, coach_level, coach_awards, hourly_fee)
               VALUES (?, ?, ?, '男', 28, 1, '13900000000', CONCAT(?, '@example.com'), ?, ?, ?, NULL, ?)
               ON DUPLICATE KEY UPDATE username=username`;
  let pending = users.length;
  users.forEach(u=>{
    db.query(sql, [u.username, password, u.real_name, u.username, u.role, u.status, u.coach_level, u.hourly_fee], ()=>{
      pending--; if (pending===0 && cb) cb();
    });
  });
}

// 手动触发默认账号写入（幂等）
app.post('/api/bootstrap/default-users', (req, res) => {
  ensureDefaultUsers(()=> res.json({ success: true }));
});

// 许可缓存与可选强制校验
let licenseCache = { valid: true, info: null, checkedAt: 0 };
function refreshLicenseCache(cb){
  db.query(`SELECT * FROM license ORDER BY id DESC LIMIT 1`, (err, rows)=>{
    const now = Date.now();
    if (err) { licenseCache = { valid: false, info: null, checkedAt: now }; return cb && cb(); }
    if (!rows || rows.length===0) { licenseCache = { valid: false, info: null, checkedAt: now }; return cb && cb(); }
    const lic = rows[0];
    const today = new Date();
    const end = new Date(lic.end_date);
    const valid = end >= today;
    licenseCache = { valid, info: lic, checkedAt: now };
    cb && cb();
  });
}
setInterval(()=> refreshLicenseCache(), 5*60*1000);
refreshLicenseCache();

app.use((req, res, next) => {
  if (process.env.LICENSE_ENFORCE === '1') {
    if (req.path.startsWith('/api/license')) return next();
    if (!licenseCache.valid) return res.status(403).json({ error: '许可无效或已过期' });
  }
  next();
});

// 用户注册（学员）
app.post('/api/register/student', (req, res) => {
  const { username, password, real_name, gender, age, campus_id, phone, email } = req.body;
  if (!username || !password || !real_name || !campus_id || !phone) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  
  if (!validatePhone(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (!validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  // 直接存储明文密码
  const sql = `INSERT INTO user (username, password_hash, real_name, gender, age, campus_id, phone, email, role, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'student', 'active')`;
  db.query(sql, [username, password, real_name, gender || '男', age || null, campus_id, phone, email || null], (err, result) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '用户名已存在' });
      return res.status(500).json({ error: '注册失败' });
    }
    
    // 记录学员注册日志
    logAudit('student_register', result.insertId, { username, campus_id, real_name });
    
    res.json({ success: true });
  });
});

// 用户注册（教练，需审核）
app.post('/api/register/coach', (req, res) => {
  const { username, password, real_name, gender, age, campus_id, phone, email, coach_level, coach_awards } = req.body;
  if (!username || !password || !real_name || !campus_id || !phone) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  if (!validatePhone(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (!validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  // 直接存储明文密码
  const hourly_fee_map = { senior: 200, middle: 150, junior: 80 };
  const fee = hourly_fee_map[coach_level] || null;
  const sql = `INSERT INTO user (username, password_hash, real_name, gender, age, campus_id, phone, email, role, status, coach_level, coach_awards, hourly_fee)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'coach', 'pending', ?, ?, ?)`;
  db.query(sql, [username, password, real_name, gender || '男', age || null, campus_id, phone, email || null, coach_level || null, coach_awards || null, fee], (err) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '用户名已存在' });
      return res.status(500).json({ error: '注册失败' });
    }
    logAudit('coach_register', null, { username, campus_id });
    res.json({ success: true });
  });
});

// 登录（用户名/密码）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '缺少参数' });
  db.query('SELECT * FROM user WHERE username=?', [username], (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (!results || results.length === 0) {
      // 记录失败的登录尝试
      logAudit('login_failed', null, { username, reason: '用户不存在' });
      return res.status(400).json({ error: '用户不存在' });
    }
    const u = results[0];
    // 直接比较明文密码
    if (password !== u.password_hash) {
      // 记录失败的登录尝试
      logAudit('login_failed', u.id, { username, reason: '密码错误' });
      return res.status(400).json({ error: '密码错误' });
    }
    if (u.role === 'coach' && u.status !== 'active') {
      // 记录失败的登录尝试
      logAudit('login_failed', u.id, { username, reason: '教练员待审核或已拒绝' });
      return res.status(403).json({ error: '教练员待审核或已拒绝' });
    }
    
    // 记录成功的登录
    logAudit('user_login', u.id, { username, role: u.role });
    
    res.json({ success: true, data: { id: u.id, role: u.role, real_name: u.real_name, campus_id: u.campus_id, username: u.username } });
  });
});

// 校区管理员审核教练
app.post('/api/campus/coach/approve', (req, res) => {
  const { coach_id, approve, coach_level } = req.body; // approve: true/false
  const hourly_fee_map = { senior: 200, middle: 150, junior: 80 };
  const fee = hourly_fee_map[coach_level] || null;
  const status = approve ? 'active' : 'rejected';
  const sql = `UPDATE user SET status=?, coach_level=IFNULL(?, coach_level), hourly_fee=IFNULL(?, hourly_fee) WHERE id=? AND role='coach'`;
  db.query(sql, [status, coach_level || null, fee, coach_id], (err, result) => {
    if (err) return res.status(500).json({ error: '更新失败' });
    if (result.affectedRows === 0) return res.status(404).json({ error: '教练不存在' });
    logAudit('coach_approve', null, { coach_id, approve, coach_level });
    res.json({ success: true });
  });
});

// 校区管理员查看待审核的教练
app.get('/api/campus/coach/pending', (req, res) => {
  const { campus_id } = req.query;
  const params = [];
  let where = "role='coach' AND status='pending'";
  if (campus_id) { where += ' AND campus_id=?'; params.push(campus_id); }
  const sql = `SELECT id, username, real_name, gender, age, campus_id, phone, email, coach_level, coach_awards FROM user WHERE ${where}`;
  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(results);
  });
});

// 学员查询教练（按条件或浏览全部，限定同校区）
app.get('/api/coaches', (req, res) => {
  const { name, gender, age, campus_id } = req.query;
  const where = ['role=\'coach\'', "status='active'"];
  const params = [];
  if (campus_id) { where.push('campus_id=?'); params.push(campus_id); }
  if (name) { where.push('real_name LIKE ?'); params.push(`%${name}%`); }
  if (gender) { where.push('gender=?'); params.push(gender); }
  if (age) { where.push('age=?'); params.push(Number(age)); }
  const sql = `SELECT id, real_name, gender, age, coach_level, coach_awards, hourly_fee FROM user WHERE ${where.join(' AND ')}`;
  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(results);
  });
});

// 学员发起选择教练（双选申请）
app.post('/api/coach/select', (req, res) => {
  const { coach_id, student_id } = req.body;
  if (!coach_id || !student_id) return res.status(400).json({ error: '缺少参数' });
  // 限制：学员最多两个教练；教练最多20名学员
  const checkSql = `
    SELECT 
      (SELECT COUNT(*) FROM coach_student WHERE student_id=? AND status='approved') AS cnt_student,
      (SELECT COUNT(*) FROM coach_student WHERE coach_id=? AND status='approved') AS cnt_coach
  `;
  db.query(checkSql, [student_id, coach_id], (err, rows) => {
    if (err) return res.status(500).json({ error: '检查失败' });
    const { cnt_student, cnt_coach } = rows[0];
    if (cnt_student >= 2) return res.status(400).json({ error: '学员最多选择两位教练' });
    if (cnt_coach >= 20) return res.status(400).json({ error: '该教练名额已满' });
    db.query(`INSERT INTO coach_student (coach_id, student_id, status) VALUES (?, ?, 'pending') ON DUPLICATE KEY UPDATE status='pending'`, [coach_id, student_id], (e) => {
      if (e) return res.status(500).json({ error: '提交失败' });
      // 通知教练有新的申请，带错误处理
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '双选申请', '有学员申请与你建立双选关系，请审核')`, 
        [coach_id], (err) => {
          if (err) console.error('发送双选申请消息失败:', err);
        });
      logAudit('coach_select_request', student_id, { coach_id, student_id });
      res.json({ success: true });
    });
  });
});

// 教练查看待审批的学员双选申请
app.get('/api/coach/select/pending', (req, res) => {
  const { coach_id } = req.query;
  if (!coach_id) return res.status(400).json({ error: '缺少 coach_id' });
  const sql = `SELECT cs.student_id AS id, u.real_name, u.gender, u.age, u.phone, u.email, cs.status, cs.created_at
               FROM coach_student cs JOIN user u ON cs.student_id=u.id
               WHERE cs.coach_id=? AND cs.status='pending'`;
  db.query(sql, [coach_id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
  });
});

// 教练审批学员的双选申请
app.post('/api/coach/select/approve', (req, res) => {
  const { coach_id, student_id, approve } = req.body;
  const status = approve ? 'approved' : 'rejected';
  db.query(`UPDATE coach_student SET status=? WHERE coach_id=? AND student_id=?`, [status, coach_id, student_id], (err, r) => {
    if (err) return res.status(500).json({ error: '处理失败' });
    if (r.affectedRows === 0) return res.status(404).json({ error: '申请不存在' });
    // 通知学员审批结果，带错误处理
    const msg = approve ? '您的双选申请已通过' : '您的双选申请被拒绝';
    db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '双选结果', ?)`, 
      [student_id, msg], (err) => {
        if (err) console.error('发送双选结果消息失败:', err);
      });
    logAudit('coach_select_approve', coach_id, { coach_id, student_id, approve });
    res.json({ success: true });
  });
});

// 获取教练月收入统计
app.get('/api/coach/monthly-income', (req, res) => {
  const { coach_id } = req.query;
  if (!coach_id) return res.status(400).json({ error: '缺少参数' });
  
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  // 计算本月已完成课程的收入
  db.query(`
    SELECT 
      COUNT(*) as sessions,
      COALESCE(SUM(u.hourly_fee), 0) as income
    FROM reservation r
    JOIN user u ON r.coach_id = u.id
    WHERE r.coach_id = ? 
      AND r.status = 'completed' 
      AND r.start_time >= ?
  `, [coach_id, startOfMonth], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    const result = rows[0] || { sessions: 0, income: 0 };
    res.json({
      sessions: result.sessions,
      income: result.income
    });
  });
});

// 学员的已批准教练列表
app.get('/api/student/approved-coaches', (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: '缺少参数' });
  db.query(
    `SELECT u.id, u.real_name, u.hourly_fee, u.campus_id
     FROM coach_student cs JOIN user u ON cs.coach_id=u.id
     WHERE cs.student_id=? AND cs.status='approved'`,
    [student_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json(rows);
    }
  );
});

// 学生预约数量统计
app.get('/api/student/reservations/count', (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: '缺少参数' });
  
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  db.query(
    `SELECT COUNT(*) as count FROM reservation 
     WHERE student_id=? AND start_time >= ?`,
    [student_id, startOfMonth],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json({ count: rows[0]?.count || 0 });
    }
  );
});

// 学生参与赛事数量统计
app.get('/api/student/tournaments/count', (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: '缺少参数' });
  
  db.query(
    `SELECT COUNT(*) as count FROM tournament_signup WHERE user_id=?`,
    [student_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json({ count: rows[0]?.count || 0 });
    }
  );
});

// 学生最近预约
app.get('/api/student/reservations/recent', (req, res) => {
  const { student_id, limit = 5 } = req.query;
  if (!student_id) return res.status(400).json({ error: '缺少参数' });
  
  db.query(
    `SELECT r.*, u.real_name as coach_name 
     FROM reservation r 
     JOIN user u ON r.coach_id = u.id 
     WHERE r.student_id=? 
     ORDER BY r.start_time DESC 
     LIMIT ?`,
    [student_id, parseInt(limit)],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json({ reservations: rows });
    }
  );
});

// 学生学习进度
app.get('/api/student/progress', (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: '缺少参数' });
  
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  db.query(
    `SELECT 
       COUNT(CASE WHEN status = 'completed' THEN 1 END) as total_sessions,
       COUNT(CASE WHEN status = 'completed' AND start_time >= ? THEN 1 END) as month_sessions,
       ROUND(AVG(CASE WHEN tr.reservation_id IS NOT NULL THEN 5 ELSE NULL END), 1) as avg_rating
     FROM reservation r
     LEFT JOIN training_review tr ON r.id = tr.reservation_id AND tr.role = 'coach'
     WHERE r.student_id = ?`,
    [startOfMonth, student_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      const result = rows[0] || {};
      res.json({ 
        progress: {
          total_hours: result.total_sessions || 0,
          month_hours: result.month_sessions || 0,
          avg_rating: result.avg_rating || 0
        }
      });
    }
  );
});

// 教练的已批准学员列表
app.get('/api/coach/approved-students', (req, res) => {
  const { coach_id } = req.query;
  if (!coach_id) return res.status(400).json({ error: '缺少参数' });
  db.query(
    `SELECT u.id, u.real_name, u.gender, u.age, u.phone, u.email, cs.created_at
     FROM coach_student cs JOIN user u ON cs.student_id=u.id
     WHERE cs.coach_id=? AND cs.status='approved'`,
    [coach_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json(rows);
    }
  );
});

// 教练课表（默认未来7天）
app.get('/api/coach/schedule', (req, res) => {
  const { coach_id, from, to } = req.query;
  if (!coach_id) return res.status(400).json({ error: '缺少 coach_id' });
  const now = new Date();
  const fromDt = from ? new Date(from) : now;
  const toDt = to ? new Date(to) : new Date(now.getTime() + 7*24*3600*1000);
  const fmt = (d)=> new Date(d).toISOString().slice(0,19).replace('T',' ');
  db.query(
    `SELECT r.id, r.start_time, r.end_time, r.status, r.table_id, t.code AS table_code
     FROM reservation r LEFT JOIN table_court t ON r.table_id=t.id
     WHERE r.coach_id=? AND r.start_time>=? AND r.start_time<=?
     ORDER BY r.start_time`,
    [coach_id, fmt(fromDt), fmt(toDt)],
    (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json(rows);
    }
  );
});

// 查询可用球台
app.get('/api/tables/available', (req, res) => {
  const { campus_id, start, end } = req.query;
  if (!campus_id || !start || !end) return res.status(400).json({ error: '缺少参数' });
  const fmt = (d)=> new Date(d).toISOString().slice(0,19).replace('T',' ');
  const startS = fmt(start), endS = fmt(end);
  const sql = `SELECT tc.* FROM table_court tc
    WHERE tc.campus_id=? AND tc.id NOT IN (
      SELECT table_id FROM reservation r
      WHERE r.table_id IS NOT NULL AND r.status IN ('pending','confirmed')
      AND NOT (r.end_time<=? OR r.start_time>=?)
    )`;
  db.query(sql, [campus_id, startS, endS], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
  });
});

// 创建预约（学生发起）
app.post('/api/reservations', (req, res) => {
  const { campus_id, coach_id, student_id, start_time, end_time, table_id } = req.body;
  if (!campus_id || !coach_id || !student_id || !start_time || !end_time)
    return res.status(400).json({ error: '缺少参数' });
  const start = new Date(start_time), end = new Date(end_time);
  if (isNaN(start) || isNaN(end) || end <= start) return res.status(400).json({ error: '时间不合法' });
  const fmt = (d)=> new Date(d).toISOString().slice(0,19).replace('T',' ');
  // 1) 确认双选关系
  const checkPair = `SELECT 1 FROM coach_student WHERE coach_id=? AND student_id=? AND status='approved'`;
  db.query(checkPair, [coach_id, student_id], (e1, r1)=>{
    if (e1) return res.status(500).json({ error: '检查失败' });
    if (!r1 || r1.length===0) return res.status(400).json({ error: '请先与教练建立双选关系' });
    // 2) 冲突检查（教练/学生 时间冲突）
    const overlap = `NOT (end_time<=? OR start_time>=?)`;
    const conflictSql = `SELECT COUNT(*) AS cnt FROM reservation WHERE status IN ('pending','confirmed') AND (${overlap}) AND (coach_id=? OR student_id=?)`;
    db.query(conflictSql, [fmt(start), fmt(end), coach_id, student_id], (e2, r2)=>{
      if (e2) return res.status(500).json({ error: '检查失败' });
      if (r2[0].cnt>0) return res.status(400).json({ error: '时间冲突，请调整时间' });
      // 3) 自动分配球台（可选）
      const assignTable = (cb)=>{
        if (table_id) return cb(null, table_id);
        const sql = `SELECT id FROM table_court WHERE campus_id=? AND id NOT IN (
          SELECT table_id FROM reservation WHERE table_id IS NOT NULL AND status IN ('pending','confirmed') AND ${overlap}
        ) LIMIT 1`;
        db.query(sql, [campus_id, fmt(start), fmt(end)], (e3, rr)=>{
          if (e3) return cb(e3);
          if (!rr || rr.length===0) return cb(new Error('无可用球台'));
          cb(null, rr[0].id);
        });
      };
      assignTable((e4, tid)=>{
        if (e4) return res.status(400).json({ error: e4.message||'无法分配球台' });
        const ins = `INSERT INTO reservation (campus_id, coach_id, student_id, table_id, start_time, end_time, status)
                     VALUES (?, ?, ?, ?, ?, ?, 'pending')`;
        db.query(ins, [campus_id, coach_id, student_id, tid, fmt(start), fmt(end)], (e5, r5)=>{
          if (e5) return res.status(500).json({ error: '创建失败' });
          // 发消息给教练，带错误处理
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '预约申请', '有新的预约申请待确认')`, 
            [coach_id], (err) => {
              if (err) console.error('发送预约申请消息失败:', err);
            });
          logAudit('reservation_create', student_id, { reservation_id: r5.insertId, coach_id, campus_id, start_time, end_time, table_id: tid });
          res.json({ success: true, reservation_id: r5.insertId, table_id: tid });
        });
      });
    });
  });
});

// 账户余额与充值
app.get('/api/account/:user_id', (req, res) => {
  const { user_id } = req.params;
  db.query(`SELECT balance FROM account WHERE user_id=?`, [user_id], (err, rows)=>{
    if (err) return res.status(500).json({ error: '查询失败' });
    if (!rows || rows.length===0) return res.json({ balance: 0 });
    res.json(rows[0]);
  });
});

app.post('/api/account/recharge', (req, res) => {
  const { user_id, amount, method } = req.body;
  if (!user_id || !amount || amount<=0) return res.status(400).json({ error: '参数不合法' });
  const upsert = `INSERT INTO account (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)`;
  db.query(upsert, [user_id, amount], (e1)=>{
    if (e1) return res.status(500).json({ error: '充值失败' });
    
    // 添加交易记录，带错误处理
    db.query(`INSERT INTO \`transaction\` (user_id, amount, type, description) VALUES (?, ?, 'recharge', ?)`, 
      [user_id, amount, `${method === 'wechat' ? '微信' : method === 'alipay' ? '支付宝' : '线下'}充值`], 
      (e2) => {
        if (e2) {
          console.error('插入交易记录失败:', e2);
          // 不返回错误，因为充值已经成功
        }
      });
    
    // 记录审计日志
    logAudit('account_recharge', user_id, { amount, method, description: `${method === 'wechat' ? '微信' : method === 'alipay' ? '支付宝' : '线下'}充值` });
    
    res.json({ success: true });
  });
});

// 获取交易记录
app.get('/api/account/transactions/:user_id', (req, res) => {
  const { user_id } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  
  db.query(`
    SELECT amount, type, description, created_at,
           CASE 
             WHEN description LIKE '%微信%' THEN 'wechat'
             WHEN description LIKE '%支付宝%' THEN 'alipay' 
             ELSE 'offline'
           END as method
    FROM \`transaction\` 
    WHERE user_id = ? AND type = 'recharge'
    ORDER BY created_at DESC 
    LIMIT ?
  `, [user_id, limit], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ transactions: rows || [] });
  });
});

// 教练确认预约（扣费）
app.post('/api/reservations/:id/confirm', (req, res) => {
  const { id } = req.params;
  // 查询预约、教练费用与学生账号
  const q = `SELECT r.*, u.hourly_fee FROM reservation r JOIN user u ON r.coach_id=u.id WHERE r.id=?`;
  db.query(q, [id], (e1, rows)=>{
    if (e1) return res.status(500).json({ error: '查询失败' });
    if (!rows || rows.length===0) return res.status(404).json({ error: '预约不存在' });
    const r = rows[0];
    if (r.status!=='pending') return res.status(400).json({ error: '当前状态不可确认' });
    const durH = (new Date(r.end_time) - new Date(r.start_time)) / 3600000.0;
    const fee = Math.max(0, durH) * (r.hourly_fee||0);
    // 扣费
    db.query(`SELECT balance FROM account WHERE user_id=?`, [r.student_id], (e2, bRows)=>{
      if (e2) return res.status(500).json({ error: '查询余额失败' });
      const bal = bRows && bRows[0] ? Number(bRows[0].balance) : 0;
      if (bal < fee) return res.status(400).json({ error: '余额不足，无法确认' });
      db.query(`UPDATE account SET balance=balance-? WHERE user_id=?`, [fee, r.student_id], (e3)=>{
        if (e3) return res.status(500).json({ error: '扣费失败' });
        
        // 插入交易记录，带错误处理
        db.query(`INSERT INTO \`transaction\` (user_id, amount, type, ref_id) VALUES (?, ?, 'reservation_fee', ?)`, 
          [r.student_id, -fee, r.id], (e4) => {
            if (e4) console.error('插入交易记录失败:', e4);
          });
        
        // 更新预约状态，带错误处理
        db.query(`UPDATE reservation SET status='confirmed' WHERE id=?`, [id], (e5) => {
          if (e5) console.error('更新预约状态失败:', e5);
        });
        
        // 发送确认消息，带错误处理
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '预约确认', '您的预约已被教练确认')`, 
          [r.student_id], (e6) => {
            if (e6) console.error('发送确认消息失败:', e6);
          });
        
        logAudit('reservation_confirm', r.coach_id, { reservation_id: r.id, fee });
        res.json({ success: true, fee });
      });
    });
  });
});

// 教练拒绝预约
app.post('/api/reservations/:id/reject', (req, res) => {
  const { id } = req.params;
  db.query(`UPDATE reservation SET status='rejected' WHERE id=? AND status='pending'`, [id], (err, r)=>{
    if (err) return res.status(500).json({ error: '更新失败' });
    if (r.affectedRows===0) return res.status(400).json({ error: '状态不允许或不存在' });
    logAudit('reservation_reject', null, { reservation_id: Number(id) });
    res.json({ success: true });
  });
});

// 标记预约为已完成
app.post('/api/reservations/:id/complete', (req, res) => {
  const { id } = req.params;
  
  db.query(`UPDATE reservation SET status='completed' WHERE id=? AND status='confirmed'`, [id], (err, result) => {
    if (err) return res.status(500).json({ error: '更新失败' });
    if (result.affectedRows === 0) return res.status(400).json({ error: '预约不存在或状态不允许' });
    
    logAudit('reservation_complete', null, { reservation_id: Number(id) });
    res.json({ success: true });
  });
});

// 取消预约（双确认 + 24小时规则 + 每月<=3次约束）
app.post('/api/reservations/:id/cancel', (req, res) => {
  const { id } = req.params;
  const { by, confirm } = req.body; // by: 'student' | 'coach'
  if (by!=='student' && by!=='coach') return res.status(400).json({ error: '参数不合法' });
  db.query(`SELECT * FROM reservation WHERE id=?`, [id], (e1, rows)=>{
    if (e1) return res.status(500).json({ error: '查询失败' });
    if (!rows || rows.length===0) return res.status(404).json({ error: '预约不存在' });
    const r = rows[0];
    if (!(r.status==='pending' || r.status==='confirmed')) return res.status(400).json({ error: '当前状态不可取消' });
    const now = new Date();
    const limit = new Date(new Date(r.start_time).getTime() - 24*3600*1000);
    if (now > limit) return res.status(400).json({ error: '距开始时间不足24小时，无法取消' });
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const fmt = (d)=> new Date(d).toISOString().slice(0,19).replace('T',' ');
    const roleField = by==='student' ? 'student_id' : 'coach_id';
    const cntSql = `SELECT COUNT(*) AS cnt FROM reservation WHERE status='canceled' AND cancel_request_by=? AND ${roleField}=? AND start_time>=?`;
    const actorId = by==='student'? r.student_id : r.coach_id;
    db.query(cntSql, [by, actorId, fmt(monthStart)], (e2, cr)=>{
      if (e2) return res.status(500).json({ error: '查询失败' });
      if (cr[0].cnt>=3) return res.status(400).json({ error: '本月取消次数已达上限' });
      if (r.cancel_request_by === 'none') {
        // 第一次发起取消
        db.query(`UPDATE reservation SET cancel_request_by=? WHERE id=?`, [by, id], (e3)=>{
          if (e3) return res.status(500).json({ error: '提交失败' });
          // 通知对方确认，带错误处理
          const recipient = by==='student'? r.coach_id : r.student_id;
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '取消申请', '对方发起取消申请，需确认')`, 
            [recipient], (e4) => {
              if (e4) console.error('发送取消申请通知失败:', e4);
            });
          res.json({ success: true, pending_confirm: true });
        });
      } else {
        // 对方来确认
        if (!confirm) return res.status(400).json({ error: '请携带 confirm=true 进行确认' });
        // 如果已付款（confirmed）则退款
        const finalize = ()=>{
          db.query(`UPDATE reservation SET status='canceled' WHERE id=?`, [id], (e7) => {
            if (e7) console.error('更新预约状态为取消失败:', e7);
          });
          const recipient = by==='student'? r.coach_id : r.student_id;
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '取消成功', '预约已取消并处理完毕')`, 
            [recipient], (e8) => {
              if (e8) console.error('发送取消成功通知失败:', e8);
            });
          logAudit('reservation_cancel', by==='student'? r.student_id : r.coach_id, { reservation_id: r.id });
          res.json({ success: true });
        };
        if (r.status==='confirmed') {
          const durH = (new Date(r.end_time) - new Date(r.start_time)) / 3600000.0;
          db.query(`SELECT hourly_fee FROM user WHERE id=?`, [r.coach_id], (e4, feeR)=>{
            if (e4) return res.status(500).json({ error: '退款计算失败' });
            const fee = Math.max(0, durH) * (feeR && feeR[0] ? feeR[0].hourly_fee||0 : 0);
            const up = `INSERT INTO account (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)`;
            db.query(up, [r.student_id, fee], (e5)=>{
              if (e5) return res.status(500).json({ error: '退款失败' });
              // 添加退款交易记录，带错误处理
              db.query(`INSERT INTO \`transaction\` (user_id, amount, type, ref_id) VALUES (?, ?, 'refund', ?)`, 
                [r.student_id, fee, r.id], (e6) => {
                  if (e6) console.error('插入退款交易记录失败:', e6);
                });
              finalize();
            });
          });
        } else {
          finalize();
        }
      }
    });
  });
});

// 查询本月取消次数配额
app.get('/api/reservations/cancel/quota', (req, res) => {
  const { by, actor_id } = req.query; // by: student|coach
  if ((by!=='student' && by!=='coach') || !actor_id) return res.status(400).json({ error: '参数不合法' });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmt = (d)=> new Date(d).toISOString().slice(0,19).replace('T',' ');
  const roleField = by==='student' ? 'student_id' : 'coach_id';
  const sql = `SELECT COUNT(*) AS cnt FROM reservation WHERE status='canceled' AND cancel_request_by=? AND ${roleField}=? AND start_time>=?`;
  db.query(sql, [by, actor_id, fmt(monthStart)], (err, rows)=>{
    if (err) return res.status(500).json({ error: '查询失败' });
    const used = rows && rows[0] ? Number(rows[0].cnt) : 0;
    const total = 3;
    const remaining = Math.max(0, total - used);
    res.json({ used, total, remaining });
  });
});

// 消息列表
app.get('/api/messages', (req, res) => {
  const { recipient_id } = req.query;
  if (!recipient_id) return res.status(400).json({ error: '缺少参数' });
  db.query(`SELECT id, title, content, is_read, created_at FROM message WHERE recipient_id=? ORDER BY created_at DESC`, [recipient_id], (err, rows)=>{
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ messages: rows || [] });
  });
});

// 标记消息为已读
app.post('/api/messages/:id/read', (req, res) => {
  const { id } = req.params;
  db.query(`UPDATE message SET is_read=1 WHERE id=?`, [id], (err, r)=>{
    if (err) return res.status(500).json({ error: '更新失败' });
    res.json({ success: true });
  });
});

// 批量标记所有消息为已读
app.post('/api/messages/mark-all-read', (req, res) => {
  const { recipient_id } = req.body;
  if (!recipient_id) return res.status(400).json({ error: '缺少参数' });
  
  db.query(`UPDATE message SET is_read=1 WHERE recipient_id=? AND is_read=0`, [recipient_id], (err, result)=>{
    if (err) return res.status(500).json({ error: '更新失败' });
    res.json({ success: true, updated_count: result.affectedRows });
  });
});

// 查询赛程（简单按组别）
app.get('/api/schedule', (req, res) => {
  const { group_level } = req.query;
  if (!group_level) return res.status(400).json({ error: '缺少参数' });
  db.query(`SELECT * FROM tournament_schedule WHERE group_level=? ORDER BY id`, [group_level], (err, rows)=>{
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
  });
});

// 训练评价
app.post('/api/reviews', (req, res) => {
  const { reservation_id, reviewer_id, role, content } = req.body;
  if (!reservation_id || !reviewer_id || !role || !content) return res.status(400).json({ error: '缺少参数' });
  // 仅允许课后评价
  db.query(`SELECT * FROM reservation WHERE id=?`, [reservation_id], (err, rows)=>{
    if (err) return res.status(500).json({ error: '查询失败' });
    if (!rows || rows.length===0) return res.status(404).json({ error: '预约不存在' });
    const r = rows[0];
    if (new Date(r.end_time) > new Date()) return res.status(400).json({ error: '未到课后不可评价' });
    db.query(`INSERT INTO training_review (reservation_id, reviewer_id, role, content) VALUES (?, ?, ?, ?)`, [reservation_id, reviewer_id, role, content], (e)=>{
      if (e) return res.status(500).json({ error: '提交失败' });
      logAudit('review_create', reviewer_id, { reservation_id });
      res.json({ success: true });
    });
  });
});
app.get('/api/reviews', (req, res) => {
  const { reservation_id, coach_id, student_id } = req.query;
  let where = [];
  let params = [];
  if (reservation_id){ where.push('reservation_id=?'); params.push(reservation_id); }
  if (coach_id){ where.push('reservation_id IN (SELECT id FROM reservation WHERE coach_id=?)'); params.push(coach_id); }
  if (student_id){ where.push('reservation_id IN (SELECT id FROM reservation WHERE student_id=?)'); params.push(student_id); }
  const sql = `SELECT * FROM training_review ${where.length? 'WHERE '+where.join(' AND '): ''} ORDER BY id DESC`;
  db.query(sql, params, (err, rows)=>{
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
  });
});

// 月赛报名与赛程
const SIGNUP_FEE = Number(process.env.SIGNUP_FEE || 30);
app.post('/api/tournament/signup', (req, res) => {
  const { user_id, group_level } = req.body;
  if (!user_id || !group_level) return res.status(400).json({ error: '缺少参数' });
  db.query(`SELECT balance FROM account WHERE user_id=?`, [user_id], (e1, br)=>{
    if (e1) return res.status(500).json({ error: '查询余额失败' });
    const bal = br && br[0]? Number(br[0].balance) : 0;
    if (bal < SIGNUP_FEE) return res.status(400).json({ error: '余额不足' });
    db.query(`UPDATE account SET balance=balance-? WHERE user_id=?`, [SIGNUP_FEE, user_id], (e2)=>{
      if (e2) return res.status(500).json({ error: '扣费失败' });
      db.query(`INSERT INTO \`transaction\` (user_id, amount, type) VALUES (?, ?, 'signup_fee')`, [user_id, -SIGNUP_FEE]);
      db.query(`INSERT INTO tournament_signup (user_id, group_level, paid) VALUES (?, ?, 1)`, [user_id, group_level], (e3)=>{
        if (e3) return res.status(500).json({ error: '报名失败' });
        logAudit('tournament_signup', user_id, { group_level });
        res.json({ success: true });
      });
    });
  });
});

// 生成赛程（<=6人：单组循环；>6：当前受限于 schema，暂只生成前6人的循环）
app.post('/api/tournament/schedule', (req, res) => {
  const { group_level } = req.body;
  if (!group_level) return res.status(400).json({ error: '缺少参数' });
  db.query(`SELECT user_id FROM tournament_signup WHERE group_level=? AND paid=1`, [group_level], (err, rows)=>{
    if (err) return res.status(500).json({ error: '查询失败' });
    let players = rows.map(r=>r.user_id);
    if (players.length < 2) return res.status(400).json({ error: '人数不足' });
    if (players.length > 6) {
      return res.status(400).json({ error: '>6人请分组后再编排，本实现当前仅支持最多6人组内循环' });
    }
    // 使用圆桌算法生成分轮次赛程；奇数人数引入轮空
    const origN = players.length;
    let hasBye = false;
    if (players.length % 2 === 1) { players = [...players, 0]; hasBye = true; }
    const n = players.length; // 偶数
    const rounds = n - 1;
    const left = players.slice(0, n/2);
    const right = players.slice(n/2).reverse();
    const roundsMatches = [];
    for (let r=0; r<rounds; r++){
      const matches = [];
      for (let i=0;i<n/2;i++){
        const a = left[i];
        const b = right[i];
        if (a!==0 && b!==0) matches.push([a,b]);
      }
      roundsMatches.push(matches);
      // 旋转
      const fixed = left[0];
      const movedFromLeft = left.pop();
      left.splice(1,0,right.shift());
      right.push(movedFromLeft);
    }
    // 清理旧赛程并写入，带 round_no
    db.query(`DELETE FROM tournament_schedule WHERE group_level=?`, [group_level], ()=>{
      const values = [];
      for (let r=0; r<roundsMatches.length; r++){
        for (const [p1, p2] of roundsMatches[r]){
          values.push([group_level, r+1, p1, p2, null, null]);
        }
      }
      if (values.length===0) return res.json({ success: true, created: 0 });
      db.query(`INSERT INTO tournament_schedule (group_level, round_no, player1_id, player2_id, table_id, match_time) VALUES ?`, [values], (e2)=>{
        if (e2) return res.status(500).json({ error: '生成失败' });
        logAudit('tournament_schedule_generate', null, { group_level, count: values.length, players: origN });
        res.json({ success: true, created: values.length });
      });
    });
  });
});

// 用户资料更新
app.post('/api/user/profile', (req, res) => {
  const { user_id, real_name, phone, email, avatar_url } = req.body;
  if (!user_id) return res.status(400).json({ error: '缺少 user_id' });
  if (phone && !validatePhone(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (email && !validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  const fields = [];
  const params = [];
  if (real_name){ fields.push('real_name=?'); params.push(real_name); }
  if (phone){ fields.push('phone=?'); params.push(phone); }
  if (email){ fields.push('email=?'); params.push(email); }
  if (avatar_url){ fields.push('avatar_url=?'); params.push(avatar_url); }
  if (fields.length===0) return res.status(400).json({ error: '无可更新字段' });
  params.push(user_id);
  const sql = `UPDATE user SET ${fields.join(', ')} WHERE id=?`;
  db.query(sql, params, (err, r)=>{
    if (err) return res.status(500).json({ error: '更新失败' });
    if (r.affectedRows===0) return res.status(404).json({ error: '用户不存在' });
    logAudit('user_profile_update', user_id, { fields: fields.map(f=>f.split('=')[0]) });
    res.json({ success: true });
  });
});

// 修改密码
app.post('/api/user/password', (req, res) => {
  const { user_id, old_password, new_password } = req.body;
  if (!user_id || !old_password || !new_password) return res.status(400).json({ error: '缺少参数' });
  db.query('SELECT password_hash FROM user WHERE id=?', [user_id], (err, rows)=>{
    if (err) return res.status(500).json({ error: '查询失败' });
    if (!rows || rows.length===0) return res.status(404).json({ error: '用户不存在' });
    // 直接比较明文密码
    if (old_password !== rows[0].password_hash) return res.status(400).json({ error: '原密码不正确' });
    // 直接存储明文密码
    db.query('UPDATE user SET password_hash=? WHERE id=?', [new_password, user_id], (e2)=>{
      if (e2) return res.status(500).json({ error: '更新失败' });
      logAudit('user_password_change', user_id, null);
      res.json({ success: true });
    });
  });
});

// 许可 API
app.post('/api/license/activate', (req, res) => {
  const { purchaser_org, device_fingerprint, license_key, start_date, end_date } = req.body;
  if (!purchaser_org || !device_fingerprint || !license_key || !start_date || !end_date) return res.status(400).json({ error: '缺少参数' });
  const sql = `INSERT INTO license (purchaser_org, device_fingerprint, license_key, start_date, end_date) VALUES (?, ?, ?, ?, ?)`;
  db.query(sql, [purchaser_org, device_fingerprint, license_key, start_date, end_date], (err)=>{
    if (err) return res.status(500).json({ error: '激活失败' });
    refreshLicenseCache(()=> res.json({ success: true }));
  });
});
app.get('/api/license/status', (req, res) => {
  const info = licenseCache.info;
  if (!info) return res.json({ valid: false });
  const now = new Date();
  const end = new Date(info.end_date);
  const daysLeft = Math.ceil((end - now) / (24*3600*1000));
  res.json({ valid: licenseCache.valid, purchaser_org: info.purchaser_org, end_date: info.end_date, days_left: daysLeft });
});

// 开课提醒定时器：每分钟检查未来 ~60 分钟内的已确认预约，发一次提醒
setInterval(()=>{
  const now = new Date();
  const in55 = new Date(now.getTime() + 55*60000);
  const in65 = new Date(now.getTime() + 65*60000);
  const fmt = (d)=> new Date(d).toISOString().slice(0,19).replace('T',' ');
  const sql = `SELECT id, student_id, coach_id FROM reservation WHERE status='confirmed' AND start_time BETWEEN ? AND ?`;
  db.query(sql, [fmt(in55), fmt(in65)], (err, rows)=>{
    if (err || !rows || rows.length===0) return;
    rows.forEach(r=>{
      const content = `预约ID: ${r.id} 将于1小时后开始`;
      db.query(`SELECT 1 FROM message WHERE title='开课提醒' AND content LIKE ? LIMIT 1`, [`%预约ID: ${r.id}%`], (e2, exist)=>{
        if (e2) return;
        if (exist && exist.length>0) return;
        // 发送开课提醒给学员，带错误处理
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '开课提醒', ?)`, 
          [r.student_id, content], (err) => {
            if (err) console.error('发送开课提醒给学员失败:', err);
          });
        // 发送开课提醒给教练，带错误处理
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '开课提醒', ?)`, 
          [r.coach_id, content], (err) => {
            if (err) console.error('发送开课提醒给教练失败:', err);
          });
      });
    });
  });
}, 60*1000);
// 基本登录接口（与 old_project 等价）
app.post('/login', (req, res) => {
  const { email, password, userType } = req.body;
  let tableName = '';
  if (userType === 'student') tableName = 'student';
  else if (userType === 'teacher') tableName = 'teacher';
  else if (userType === 'administrator') tableName = 'administrator';
  else return res.status(400).json({ error: '无效的用户身份' });

  const query = `SELECT * FROM ${tableName} WHERE email = ? AND password = ?`;
  db.query(query, [email, password], (err, results) => {
    if (err) return res.status(500).json({ error: '数据库查询错误' });
    if (results.length > 0) {
      return res.json({ success: true, data: { email: results[0].email, userType } });
    }
    res.json({ success: false, message: '邮箱或密码错误' });
  });
});

// 学生端 API（骨架）
app.get('/api/students', (req, res) => {
  const { email } = req.query;
  db.query(
    `SELECT student_id, name, gender, birth_date, major, phone, email FROM Student WHERE email = ?`,
    [email],
    (err, results) => {
      if (err) return res.status(500).json({ error: '数据库查询失败' });
      res.json(results || {});
    }
  );
});

app.get('/api/courses/available', (req, res) => {
  const { email } = req.query;
  db.query(
    `SELECT c.course_id, c.course_name, c.credits, t.name AS teacher_name
     FROM Course c
     LEFT JOIN Teacher t ON c.teacher_id = t.teacher_id
     WHERE c.course_id NOT IN (
       SELECT course_id FROM Enrollment
       WHERE student_id = (SELECT student_id FROM Student WHERE email = ?)
     )`,
    [email],
    (err, results) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json(results);
    }
  );
});

app.get('/api/courses/enrolled', (req, res) => {
  const { email } = req.query;
  db.query(
    `SELECT c.course_id, c.course_name, c.credits, e.grade, e.enroll_date
     FROM Enrollment e JOIN Course c ON e.course_id = c.course_id
     WHERE e.student_id = (SELECT student_id FROM Student WHERE email = ?)`,
    [email],
    (err, results) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json(results);
    }
  );
});

app.post('/api/enroll', (req, res) => {
  const { email, courseId } = req.body;
  db.query(
    `INSERT INTO Enrollment (student_id, course_id, enroll_date)
     SELECT student_id, ?, NOW() FROM Student WHERE email = ?`,
    [courseId, email],
    (err) => {
      if (err) return res.status(500).json({ error: '选课失败' });
      res.json({ success: true });
    }
  );
});

app.delete('/api/drop', (req, res) => {
  const { email, courseId } = req.body;
  db.query(
    `DELETE FROM Enrollment WHERE course_id = ? AND student_id = (SELECT student_id FROM Student WHERE email = ?)`,
    [courseId, email],
    (err) => {
      if (err) return res.status(500).json({ error: '退选失败' });
      res.json({ success: true });
    }
  );
});

app.put('/api/students', (req, res) => {
  const { email, name, phone, major } = req.body;
  if (!email || !name || !phone || !major) return res.status(400).json({ error: '缺少必要字段' });
  db.query(
    `UPDATE Student SET name = ?, phone = ?, major = ? WHERE email = ?`,
    [name, phone, major, email],
    (err, results) => {
      if (err) return res.status(500).json({ error: '数据库更新失败' });
      if (results.affectedRows === 0) return res.status(404).json({ error: '未找到学生信息' });
      res.json({ success: true });
    }
  );
});

// 教师端 API（骨架）
app.get('/api/teacher', (req, res) => {
  const { email } = req.query;
  db.query(
    `SELECT teacher_id, name, phone, email, birth_date, gender FROM teacher WHERE email = ?`,
    [email],
    (err, results) => {
      if (err) return res.status(500).json({ error: '数据库查询失败' });
      res.json(results || {});
    }
  );
});

app.get('/api/teacher/courses', (req, res) => {
  const { email } = req.query;
  db.query(
    `SELECT c.course_id, c.course_name, c.credits, COUNT(e.student_id) AS student_count
     FROM Course c
     LEFT JOIN Enrollment e ON c.course_id = e.course_id
     WHERE c.teacher_id = (SELECT teacher_id FROM teacher WHERE email = ?)
     GROUP BY c.course_id, c.course_name, c.credits`,
    [email],
    (err, results) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json(results);
    }
  );
});

app.get('/api/teacher/grades', (req, res) => {
  const { course_id } = req.query;
  db.query(
    `SELECT s.student_id, s.name, e.grade
     FROM Enrollment e JOIN Student s ON e.student_id = s.student_id
     WHERE e.course_id = ?`,
    [course_id],
    (err, results) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json(results);
    }
  );
});

app.put('/api/teacher/grades', (req, res) => {
  const { courseId, studentId, grade } = req.body;
  db.query(
    `UPDATE Enrollment SET grade = ? WHERE course_id = ? AND student_id = ?`,
    [grade, courseId, studentId],
    (err) => {
      if (err) return res.status(500).json({ error: '更新成绩失败' });
      res.json({ success: true });
    }
  );
});

// 教师与课程管理 API（骨架）
app.get('/api/courses', (req, res) => {
  db.query(
    `SELECT c.course_id, c.course_name, c.credits, t.name AS teacher_name, c.teacher_id, c.schedule, c.location
     FROM course c LEFT JOIN teacher t ON c.teacher_id = t.teacher_id`,
    (err, results) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json(results);
    }
  );
});

app.get('/api/teachers', (req, res) => {
  db.query(`SELECT teacher_id, name FROM teacher`, (err, results) => {
    if (err) return res.status(500).json({ error: '数据库查询失败' });
    res.json(results);
  });
});

app.put('/api/courses/:courseId', (req, res) => {
  const { courseId } = req.params;
  const { course_name, credits, teacher_id, schedule, location } = req.body;
  if (teacher_id && isNaN(teacher_id)) return res.status(400).json({ error: '授课教师ID必须是有效整数' });
  db.query(
    `UPDATE course SET course_name = ?, credits = ?, teacher_id = ?, schedule = ?, location = ? WHERE course_id = ?`,
    [course_name, credits, teacher_id || null, schedule || null, location || null, courseId],
    (err) => {
      if (err) return res.status(500).json({ error: '更新失败' });
      res.json({ message: '课程信息已更新' });
    }
  );
});

app.post('/api/courses', (req, res) => {
  const { course_id, course_name, credits, teacher_id, schedule, location } = req.body;
  if (!course_id || !course_name || !credits || !schedule) return res.status(400).json({ error: '缺少必填字段' });
  if (isNaN(course_id) || course_id <= 0) return res.status(400).json({ error: '课程ID必须为正整数' });
  if (isNaN(credits) || credits <= 0 || credits > 99.9) return res.status(400).json({ error: '学分必须在 0.1 到 99.9 之间' });
  if (teacher_id && isNaN(teacher_id)) return res.status(400).json({ error: '教师ID必须为有效整数' });

  db.query(
    `INSERT INTO course (course_id, course_name, credits, teacher_id, schedule, location) VALUES (?, ?, ?, ?, ?, ?)`,
    [course_id, course_name, credits, teacher_id || null, schedule, location || null],
    (err) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '课程ID已存在' });
        return res.status(500).json({ error: '数据库插入失败' });
      }
      res.json({ message: '课程已新增' });
    }
  );
});

app.delete('/api/courses/:courseId', (req, res) => {
  const { courseId } = req.params;
  db.query(`DELETE FROM course WHERE course_id = ?`, [courseId], (err) => {
    if (err) return res.status(500).json({ error: '删除失败' });
    res.json({ message: '课程已删除' });
  });
});

// 学员申请更换教练
app.post('/api/student/change-coach-request', (req, res) => {
  const { student_id, new_coach_id, reason } = req.body;
  if (!student_id || !new_coach_id) {
    return res.status(400).json({ error: '缺少必填参数' });
  }
  
  // 1. 获取学员当前的教练
  db.query(`SELECT coach_id FROM coach_student WHERE student_id=? AND status='approved'`, 
    [student_id], (err, currentCoaches) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (!currentCoaches || currentCoaches.length === 0) {
      return res.status(400).json({ error: '您当前没有教练，无法更换' });
    }
    
    const current_coach_id = currentCoaches[0].coach_id;
    
    // 2. 检查是否选择了相同的教练
    if (current_coach_id == new_coach_id) {
      return res.status(400).json({ error: '不能选择当前的教练' });
    }
    
    // 3. 验证新教练是否存在且在同一校区
    db.query(`
      SELECT u1.id, u1.real_name, u1.campus_id as student_campus,
             u2.id as coach_id, u2.real_name as coach_name, u2.campus_id as coach_campus
      FROM user u1, user u2 
      WHERE u1.id=? AND u2.id=? AND u2.role='coach' AND u2.status='active'
    `, [student_id, new_coach_id], (err, userInfo) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      if (!userInfo || userInfo.length === 0) {
        return res.status(400).json({ error: '目标教练不存在或不可用' });
      }
      
      const info = userInfo[0];
      if (info.student_campus !== info.coach_campus) {
        return res.status(400).json({ error: '只能选择同校区的教练' });
      }
      
      // 4. 检查是否已有待处理的申请
      db.query(`SELECT id FROM coach_change_request WHERE student_id=? AND status='pending'`, 
        [student_id], (err, pending) => {
        if (err) return res.status(500).json({ error: '查询失败' });
        if (pending && pending.length > 0) {
          return res.status(400).json({ error: '您已有待处理的更换申请，请等待处理完成' });
        }
        
        // 5. 创建更换申请
        const sql = `INSERT INTO coach_change_request (student_id, current_coach_id, new_coach_id, reason, status) 
                     VALUES (?, ?, ?, ?, 'pending')`;
        db.query(sql, [student_id, current_coach_id, new_coach_id, reason || ''], (err, result) => {
          if (err) return res.status(500).json({ error: '申请提交失败' });
          
          const requestId = result.insertId;
          
          // 6. 发送消息给三方
          const studentName = info.real_name;
          const currentCoachMessage = `学员${studentName}申请更换教练，请查看并处理申请ID: ${requestId}`;
          const newCoachMessage = `学员${studentName}申请将您设为新教练，请查看并处理申请ID: ${requestId}`;
          const adminMessage = `学员${studentName}提交了更换教练申请，请查看并处理申请ID: ${requestId}`;
          
          // 发送给当前教练，带错误处理
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换申请', ?)`, 
            [current_coach_id, currentCoachMessage], (err) => {
              if (err) console.error('发送给当前教练的消息失败:', err);
            });
          
          // 发送给新教练，带错误处理
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换申请', ?)`, 
            [new_coach_id, newCoachMessage], (err) => {
              if (err) console.error('发送给新教练的消息失败:', err);
            });
          
          // 发送给校区管理员，带错误处理
          db.query(`SELECT id FROM user WHERE role='campus_admin' AND campus_id=?`, 
            [info.student_campus], (err, admins) => {
            if (err) {
              console.error('查询校区管理员失败:', err);
              return;
            }
            if (admins && admins.length > 0) {
              db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换申请', ?)`, 
                [admins[0].id, adminMessage], (err) => {
                  if (err) console.error('发送给管理员的消息失败:', err);
                });
            }
          });
          
          logAudit('coach_change_request', student_id, { 
            current_coach_id, 
            new_coach_id, 
            request_id: requestId 
          });
          
          res.json({ 
            success: true, 
            request_id: requestId,
            message: '更换申请已提交，需要当前教练、新教练和校区管理员都同意后才能生效' 
          });
        });
      });
    });
  });
});

// 获取学员当前教练和可选教练列表
app.get('/api/student/coach-change-info', (req, res) => {
  const { student_id } = req.query;
  if (!student_id) return res.status(400).json({ error: '缺少参数' });
  
  // 1. 获取当前教练
  db.query(`
    SELECT u.id, u.real_name, u.coach_level, u.hourly_fee
    FROM coach_student cs 
    JOIN user u ON cs.coach_id = u.id 
    WHERE cs.student_id=? AND cs.status='approved'
  `, [student_id], (err, currentCoach) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    
    // 2. 获取同校区可选教练列表
    db.query(`
      SELECT u.id, u.real_name, u.coach_level, u.hourly_fee, u.coach_awards
      FROM user u 
      WHERE u.role='coach' AND u.status='active' 
        AND u.campus_id = (SELECT campus_id FROM user WHERE id=?)
        AND u.id != COALESCE((SELECT coach_id FROM coach_student WHERE student_id=? AND status='approved'), 0)
      ORDER BY u.coach_level DESC, u.real_name
    `, [student_id, student_id], (err, availableCoaches) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      
      res.json({
        current_coach: currentCoach && currentCoach.length > 0 ? currentCoach[0] : null,
        available_coaches: availableCoaches || []
      });
    });
  });
});

// 更换教练员功能
// 教练/管理员响应更换申请
app.post('/api/coach-change-request/:id/respond', (req, res) => {
  const { id } = req.params;
  const { user_id, user_role, approve, response_text } = req.body;
  
  if (!user_id || !user_role || approve === undefined) {
    return res.status(400).json({ error: '缺少参数' });
  }
  
  // 1. 获取申请详情
  db.query(`SELECT * FROM coach_change_request WHERE id=? AND status='pending'`, 
    [id], (err, requests) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (!requests || requests.length === 0) {
      return res.status(400).json({ error: '申请不存在或已处理' });
    }
    
    const request = requests[0];
    
    // 2. 验证用户权限
    let updateField = '';
    let statusUpdate = '';
    
    if (user_role === 'coach' && user_id == request.current_coach_id) {
      updateField = 'current_coach_response';
      statusUpdate = approve ? 'current_coach_approved' : 'rejected';
    } else if (user_role === 'coach' && user_id == request.new_coach_id) {
      updateField = 'new_coach_response';
      statusUpdate = approve ? 'new_coach_approved' : 'rejected';
    } else if (user_role === 'campus_admin') {
      // 验证管理员是否管理该学员所在校区
      db.query(`SELECT u1.campus_id FROM user u1, user u2 
                WHERE u1.id=? AND u2.id=? AND u1.campus_id=u2.campus_id AND u1.role='campus_admin'`, 
        [user_id, request.student_id], (err, adminCheck) => {
        if (err || !adminCheck || adminCheck.length === 0) {
          return res.status(403).json({ error: '无权限处理此申请' });
        }
        
        updateField = 'admin_response';
        statusUpdate = approve ? 'admin_approved' : 'rejected';
        
        continueProcess();
      });
      return;
    } else {
      return res.status(403).json({ error: '无权限处理此申请' });
    }
    
    continueProcess();
    
    function continueProcess() {
      // 3. 如果拒绝，直接更新状态
      if (!approve) {
        db.query(`UPDATE coach_change_request SET ${updateField}=?, status='rejected' WHERE id=?`, 
          [response_text || '拒绝', id], (err) => {
          if (err) return res.status(500).json({ error: '更新失败' });
          
          // 发送拒绝消息给学员，带错误处理
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换申请被拒绝', ?)`, 
            [request.student_id, `您的教练更换申请已被拒绝。拒绝原因: ${response_text || '无'}`], (err) => {
              if (err) console.error('发送拒绝消息失败:', err);
            });
          
          logAudit('coach_change_rejected', user_id, { request_id: id, reason: response_text });
          res.json({ success: true, message: '已拒绝申请' });
        });
        return;
      }
      
      // 4. 如果同意，更新响应，但先获取当前状态以决定新的状态
      db.query(`UPDATE coach_change_request SET ${updateField}=? WHERE id=?`, 
        [response_text || '同意', id], (err) => {
        if (err) return res.status(500).json({ error: '更新失败' });
        
        // 重新获取请求以检查两位教练的响应状态
        db.query(`SELECT * FROM coach_change_request WHERE id=?`, [id], (err, rows) => {
          if (err) return res.status(500).json({ error: '更新状态失败' });
          
          const request = rows[0];
          const hasCurrentCoachApproval = request.current_coach_response && request.current_coach_response !== '拒绝';
          const hasNewCoachApproval = request.new_coach_response && request.new_coach_response !== '拒绝';
          
          // 根据两位教练的响应情况设置状态
          let newStatus = 'pending';
          
          if (user_role === 'campus_admin') {
            newStatus = 'admin_approved';
          } else if (user_role === 'coach') {
            // 如果两位教练都同意了，使用特殊状态
            if (hasCurrentCoachApproval && hasNewCoachApproval) {
              newStatus = 'both_coaches_approved';
            } 
            // 否则根据是哪位教练同意来设置状态
            else if (user_id == request.current_coach_id) {
              newStatus = 'current_coach_approved';
            } else if (user_id == request.new_coach_id) {
              newStatus = 'new_coach_approved';
            }
          }
          
          console.log(`更新教练更换申请(${id})状态为: ${newStatus}`);
          
          // 更新状态
          db.query(`UPDATE coach_change_request SET status=? WHERE id=?`, [newStatus, id], (err) => {
            if (err) return res.status(500).json({ error: '更新状态失败' });
        
        // 获取更新后的申请状态
        db.query(`SELECT * FROM coach_change_request WHERE id=?`, [id], (err, updated) => {
          if (err) return res.status(500).json({ error: '查询失败' });
          
          const req = updated[0];
          const hasCurrentCoachApproval = req.current_coach_response && req.current_coach_response !== '拒绝';
          const hasNewCoachApproval = req.new_coach_response && req.new_coach_response !== '拒绝';
          const hasAdminApproval = req.admin_response && req.admin_response !== '拒绝';
          
          console.log('教练更换申请审核状态:', {
            requestId: id,
            currentCoachResponse: req.current_coach_response,
            newCoachResponse: req.new_coach_response,
            adminResponse: req.admin_response,
            hasCurrentCoachApproval,
            hasNewCoachApproval,
            hasAdminApproval
          });
          
          // 5. 检查是否三方都同意
          if (hasCurrentCoachApproval && hasNewCoachApproval && hasAdminApproval) {
            console.log('三方均已同意，执行教练更换');
            // 执行教练更换
            executeCoachChange(req.student_id, req.current_coach_id, req.new_coach_id, id, res);
          } else {
            // 发送进度消息给学员
            const approvalStatus = [];
            if (hasCurrentCoachApproval) approvalStatus.push('当前教练已同意');
            if (hasNewCoachApproval) approvalStatus.push('新教练已同意');
            if (hasAdminApproval) approvalStatus.push('校区管理员已同意');
            
            const statusMsg = `您的教练更换申请进度更新: ${approvalStatus.join('，')}。还需要其他人员确认。`;
            db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换申请进度', ?)`, 
              [req.student_id, statusMsg], (err) => {
                if (err) console.error('发送进度消息失败:', err);
              });
            
            res.json({ success: true, message: '已记录您的同意，等待其他人员确认' });
          }
        });
      });
    }
  });
});

// 执行教练更换
function executeCoachChange(studentId, currentCoachId, newCoachId, requestId, res) {
  // 1. 更新coach_student表
  db.query(`UPDATE coach_student SET coach_id=? WHERE student_id=? AND coach_id=? AND status='approved'`, 
    [newCoachId, studentId, currentCoachId], (err) => {
    if (err) return res.status(500).json({ error: '更换失败' });
    
    // 2. 更新申请状态
    db.query(`UPDATE coach_change_request SET status='completed' WHERE id=?`, [requestId], (err) => {
      if (err) console.error('更新申请状态失败:', err);
      
      // 3. 发送成功消息给所有相关人员
      const successMsg = `教练更换已完成，学员现在的教练已更新。`;
      
      // 发送给学员，带错误处理
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换成功', ?)`, 
        [studentId, successMsg], (err) => {
          if (err) console.error('发送给学员的成功消息失败:', err);
        });
      
      // 发送给新教练，带错误处理
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '新学员加入', '您有新的学员加入，请关注。')`, 
        [newCoachId], (err) => {
          if (err) console.error('发送给新教练的消息失败:', err);
        });
      
      // 发送给前教练，带错误处理
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '学员转出通知', '您的学员已转至其他教练。')`, 
        [currentCoachId], (err) => {
          if (err) console.error('发送给前教练的消息失败:', err);
        });
      
      logAudit('coach_change_success', studentId, { 
        old_coach: currentCoachId, 
        new_coach: newCoachId,
        request_id: requestId 
      });
      
      res.json({ success: true, message: '教练更换完成' });
    });
  });
}

// 获取更换申请列表（按角色）
app.get('/api/coach-change-requests', (req, res) => {
  const { user_id, user_role } = req.query;
  if (!user_id || !user_role) return res.status(400).json({ error: '缺少参数' });
  
  let whereClause = '';
  let params = [];
  
  if (user_role === 'student') {
    whereClause = 'WHERE ccr.student_id = ?';
    params = [user_id];
  } else if (user_role === 'coach') {
    whereClause = `WHERE (ccr.current_coach_id = ? OR ccr.new_coach_id = ?) 
                  AND ccr.status NOT IN ('completed', 'rejected')`;
    params = [user_id, user_id];
  } else if (user_role === 'campus_admin') {
    whereClause = `WHERE ccr.student_id IN (
      SELECT u.id FROM user u WHERE u.campus_id = (
        SELECT campus_id FROM user WHERE id = ? AND role = 'campus_admin'
      )
    ) AND ccr.status NOT IN ('completed', 'rejected')`;
    params = [user_id];
  } else {
    return res.status(400).json({ error: '无效的用户角色' });
  }
  
  const sql = `
    SELECT 
      ccr.*,
      s.real_name as student_name,
      cc.real_name as current_coach_name,
      nc.real_name as new_coach_name
    FROM coach_change_request ccr
    JOIN user s ON ccr.student_id = s.id
    JOIN user cc ON ccr.current_coach_id = cc.id
    JOIN user nc ON ccr.new_coach_id = nc.id
    ${whereClause}
    ORDER BY ccr.created_at DESC
  `;
  
  db.query(sql, params, (err, requests) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(requests || []);
  });
});

// 校区管理员管理用户信息
app.get('/api/admin/users', (req, res) => {
  const { campus_id, role, search, status, page = 1, limit = 10 } = req.query;
  let where = ['1=1'];
  let params = [];
  
  if (campus_id) { where.push('campus_id=?'); params.push(campus_id); }
  if (role) { where.push('role=?'); params.push(role); }
  if (status) { where.push('status=?'); params.push(status); }
  if (search) { where.push('(real_name LIKE ? OR phone LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  
  // 计算总数
  const countSql = `SELECT COUNT(*) as total FROM user WHERE ${where.join(' AND ')}`;
  db.query(countSql, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    
    const total = countResult[0].total;
    const offset = (page - 1) * limit;
    
    // 获取分页数据
    const sql = `SELECT id, username, real_name, gender, age, campus_id, phone, email, role, status, 
                 coach_level, hourly_fee, achievements, id_card, created_at 
                 FROM user WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`;
    
    db.query(sql, [...params, parseInt(limit), offset], (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json({ success: true, users: rows, total });
    });
  });
});

// 管理员搜索用户
app.get('/api/admin/users/search', (req, res) => {
  const { campus_id, type, keyword } = req.query;
  if (!campus_id || !type || !keyword) return res.status(400).json({ error: '缺少参数' });
  
  let where = ['campus_id=?'];
  let params = [campus_id];
  
  switch(type) {
    case 'name':
      where.push('real_name LIKE ?');
      params.push(`%${keyword}%`);
      break;
    case 'phone':
      where.push('phone=?');
      params.push(keyword);
      break;
    case 'id_card':
      where.push('id_card=?');
      params.push(keyword);
      break;
    case 'username':
      where.push('username LIKE ?');
      params.push(`%${keyword}%`);
      break;
    default:
      return res.status(400).json({ error: '不支持的搜索类型' });
  }
  
  const sql = `SELECT id, username, real_name, gender, age, campus_id, phone, email, role, status, 
               coach_level, hourly_fee, achievements, id_card, created_at 
               FROM user WHERE ${where.join(' AND ')} ORDER BY id DESC`;
  
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '搜索失败' });
    res.json({ success: true, users: rows });
  });
});

// 获取单个用户详细信息
app.get('/api/admin/user/:id', (req, res) => {
  const { id } = req.params;
  
  const sql = `SELECT id, username, real_name, gender, age, campus_id, phone, email, role, status, 
               coach_level, hourly_fee, achievements, id_card, created_at 
               FROM user WHERE id=?`;
  
  db.query(sql, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    res.json({ success: true, user: rows[0] });
  });
});

// 管理员添加用户
app.post('/api/admin/user', (req, res) => {
  const { username, password, real_name, role, phone, email, gender, age, id_card, campus_id, coach_level, achievements } = req.body;
  
  if (!username || !password || !real_name || !role || !phone || !campus_id) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  
  if (!validatePhone(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (email && !validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  
  // 检查用户名是否已存在
  db.query('SELECT id FROM user WHERE username=?', [username], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length > 0) return res.status(400).json({ error: '用户名已存在' });
    
    // 检查手机号是否已存在
    db.query('SELECT id FROM user WHERE phone=?', [phone], (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      if (rows.length > 0) return res.status(400).json({ error: '手机号已被注册' });
      
      // 设置小时费率
      let hourlyFee = 0;
      if (role === 'coach') {
        switch(coach_level) {
          case '初级': hourlyFee = 80; break;
          case '中级': hourlyFee = 150; break;
          case '高级': hourlyFee = 200; break;
          default: hourlyFee = 80;
        }
      }
      
      const hashedPassword = hashPassword(password);
      const status = role === 'coach' ? 'pending' : 'active';
      
      const sql = `INSERT INTO user (username, password, real_name, gender, age, campus_id, phone, email, 
                   role, status, coach_level, hourly_fee, achievements, id_card) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      
      db.query(sql, [username, hashedPassword, real_name, gender, age, campus_id, phone, email, 
                     role, status, coach_level, hourlyFee, achievements, id_card], (err, result) => {
        if (err) return res.status(500).json({ error: '创建用户失败' });
        
        // 发送通知消息
        const message = role === 'coach' ? '您的教练账户已创建，等待审核' : '您的学员账户已创建';
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '账户创建', ?)`, 
                 [result.insertId, message]);
        
        logAudit('admin_user_create', null, { user_id: result.insertId, role, real_name });
        res.json({ success: true, user_id: result.insertId });
      });
    });
  });
});

// 校区管理员修改用户信息
app.put('/api/admin/user/:id', (req, res) => {
  const { id } = req.params;
  const { username, password, real_name, phone, email, gender, age, id_card, role, coach_level, achievements } = req.body;
  
  if (phone && !validatePhone(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (email && !validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  
  // 检查用户是否存在
  db.query('SELECT * FROM user WHERE id=?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    
    const currentUser = rows[0];
    const fields = [];
    const params = [];
    
    // 检查用户名重复（如果有更改）
    if (username && username !== currentUser.username) {
      db.query('SELECT id FROM user WHERE username=? AND id!=?', [username, id], (err, rows) => {
        if (err) return res.status(500).json({ error: '查询失败' });
        if (rows.length > 0) return res.status(400).json({ error: '用户名已存在' });
        
        proceedWithUpdate();
      });
    } else {
      proceedWithUpdate();
    }
    
    function proceedWithUpdate() {
      if (username) { fields.push('username=?'); params.push(username); }
      if (password) { fields.push('password=?'); params.push(hashPassword(password)); }
      if (real_name) { fields.push('real_name=?'); params.push(real_name); }
      if (phone) { fields.push('phone=?'); params.push(phone); }
      if (email) { fields.push('email=?'); params.push(email); }
      if (gender) { fields.push('gender=?'); params.push(gender); }
      if (age) { fields.push('age=?'); params.push(age); }
      if (id_card) { fields.push('id_card=?'); params.push(id_card); }
      
      // 教练相关字段
      if (role === 'coach' && coach_level) {
        fields.push('coach_level=?');
        params.push(coach_level);
        
        // 更新小时费率
        let hourlyFee = 80;
        switch(coach_level) {
          case '中级': hourlyFee = 150; break;
          case '高级': hourlyFee = 200; break;
        }
        fields.push('hourly_fee=?');
        params.push(hourlyFee);
      }
      
      if (achievements !== undefined) { fields.push('achievements=?'); params.push(achievements); }
      
      if (fields.length === 0) return res.status(400).json({ error: '无可更新字段' });
      
      params.push(id);
      const sql = `UPDATE user SET ${fields.join(', ')} WHERE id=?`;
      
      db.query(sql, params, (err, result) => {
        if (err) return res.status(500).json({ error: '更新失败' });
        
        // 通知用户信息被修改，带错误处理
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '个人信息更新', '您的个人信息已被管理员更新')`, 
          [id], (err) => {
            if (err) console.error('发送个人信息更新消息失败:', err);
          });
        
        logAudit('admin_user_update', null, { user_id: id, fields: fields.map(f => f.split('=')[0]) });
        res.json({ success: true });
      });
    }
  });
});

// 删除用户
app.delete('/api/admin/user/:id', (req, res) => {
  const { id } = req.params;
  
  // 检查用户是否存在及是否有相关数据
  db.query('SELECT real_name, role FROM user WHERE id=?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    
    const user = rows[0];
    
    // 检查是否有未完成的预约
    db.query(`SELECT COUNT(*) as count FROM reservation WHERE (student_id=? OR coach_id=?) AND status IN ('pending', 'confirmed') AND start_time > NOW()`, 
             [id, id], (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      if (rows[0].count > 0) {
        return res.status(400).json({ error: '该用户有未完成的预约，无法删除' });
      }
      
      // 开始删除相关数据
      db.beginTransaction((err) => {
        if (err) return res.status(500).json({ error: '事务开始失败' });
        
        // 删除相关数据
        const deleteQueries = [
          `DELETE FROM coach_student WHERE student_id=? OR coach_id=?`,
          `DELETE FROM message WHERE recipient_id=?`,
          `DELETE FROM account WHERE user_id=?`,
          `DELETE FROM \`transaction\` WHERE user_id=?`,
          `DELETE FROM review WHERE student_id=? OR coach_id=?`,
          `DELETE FROM tournament_registration WHERE student_id=?`,
          `DELETE FROM coach_change_request WHERE student_id=? OR current_coach_id=? OR new_coach_id=?`,
          `DELETE FROM user WHERE id=?`
        ];
        
        let completed = 0;
        const total = deleteQueries.length;
        
        deleteQueries.forEach((query, index) => {
          let params;
          if (index === 0 || index === 5) params = [id, id]; // coach_student, review
          else if (index === 6) params = [id, id, id]; // coach_change_request
          else params = [id];
          
          db.query(query, params, (err, result) => {
            if (err) {
              return db.rollback(() => {
                res.status(500).json({ error: '删除失败' });
              });
            }
            
            completed++;
            if (completed === total) {
              db.commit((err) => {
                if (err) {
                  return db.rollback(() => {
                    res.status(500).json({ error: '提交事务失败' });
                  });
                }
                
                logAudit('admin_user_delete', null, { user_id: id, real_name: user.real_name, role: user.role });
                res.json({ success: true });
              });
            }
          });
        });
      });
    });
  });
});

// 切换用户状态
app.put('/api/admin/user/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  if (!['active', 'inactive', 'banned'].includes(status)) {
    return res.status(400).json({ error: '无效的状态值' });
  }
  
  db.query('SELECT real_name FROM user WHERE id=?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    
    const real_name = rows[0].real_name;
    
    db.query('UPDATE user SET status=? WHERE id=?', [status, id], (err, result) => {
      if (err) return res.status(500).json({ error: '更新失败' });
      
      // 发送状态变更通知
      const statusText = { active: '已激活', inactive: '已停用', banned: '已禁用' }[status];
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '账户状态更新', CONCAT('您的账户状态已更新为：', ?))`, 
               [id, statusText]);
      
      logAudit('admin_user_status_change', null, { user_id: id, real_name, new_status: status });
      res.json({ success: true });
    });
  });
});

// 获取预约详情（支持多种查询）
app.get('/api/reservations', (req, res) => {
  const { student_id, coach_id, campus_id, status, from, to } = req.query;
  let where = ['1=1'];
  let params = [];
  
  if (student_id) { where.push('r.student_id=?'); params.push(student_id); }
  if (coach_id) { where.push('r.coach_id=?'); params.push(coach_id); }
  if (campus_id) { where.push('r.campus_id=?'); params.push(campus_id); }
  if (status) { where.push('r.status=?'); params.push(status); }
  if (from) { where.push('r.start_time>=?'); params.push(from); }
  if (to) { where.push('r.start_time<=?'); params.push(to); }
  
  const sql = `SELECT r.*, s.real_name AS student_name, c.real_name AS coach_name, t.code AS table_code
               FROM reservation r 
               LEFT JOIN user s ON r.student_id=s.id 
               LEFT JOIN user c ON r.coach_id=c.id 
               LEFT JOIN table_court t ON r.table_id=t.id
               WHERE ${where.join(' AND ')} ORDER BY r.start_time DESC`;
  
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
  });
});

// 管理员获取预约列表（分页）
app.get('/api/admin/reservations', (req, res) => {
  const { campus_id, status, from, to, page = 1, limit = 15 } = req.query;
  let where = ['r.campus_id=?'];
  let params = [campus_id];
  
  if (status) { where.push('r.status=?'); params.push(status); }
  if (from) { where.push('r.start_time>=?'); params.push(from); }
  if (to) { where.push('r.start_time<=?'); params.push(to); }
  
  // 计算总数
  const countSql = `SELECT COUNT(*) as total FROM reservation r WHERE ${where.join(' AND ')}`;
  db.query(countSql, params, (err, countResult) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    
    const total = countResult[0].total;
    const offset = (page - 1) * limit;
    
    // 获取分页数据
    const sql = `SELECT r.*, s.real_name AS student_name, c.real_name AS coach_name, t.code AS table_code
                 FROM reservation r 
                 LEFT JOIN user s ON r.student_id=s.id 
                 LEFT JOIN user c ON r.coach_id=c.id 
                 LEFT JOIN table_court t ON r.table_id=t.id
                 WHERE ${where.join(' AND ')} ORDER BY r.start_time DESC LIMIT ? OFFSET ?`;
    
    db.query(sql, [...params, parseInt(limit), offset], (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      res.json({ success: true, reservations: rows, total });
    });
  });
});

// 管理员搜索预约
app.get('/api/admin/reservations/search', (req, res) => {
  const { campus_id, keyword } = req.query;
  if (!campus_id || !keyword) return res.status(400).json({ error: '缺少参数' });
  
  const sql = `SELECT r.*, s.real_name AS student_name, c.real_name AS coach_name, t.code AS table_code
               FROM reservation r 
               LEFT JOIN user s ON r.student_id=s.id 
               LEFT JOIN user c ON r.coach_id=c.id 
               LEFT JOIN table_court t ON r.table_id=t.id
               WHERE r.campus_id=? AND (s.real_name LIKE ? OR c.real_name LIKE ?)
               ORDER BY r.start_time DESC`;
  
  db.query(sql, [campus_id, `%${keyword}%`, `%${keyword}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: '搜索失败' });
    res.json({ success: true, reservations: rows });
  });
});

// 管理员获取预约统计数
app.get('/api/admin/reservations/count', (req, res) => {
  const { campus_id, status, from, to } = req.query;
  let where = ['campus_id=?'];
  let params = [campus_id];
  
  if (status) { where.push('status=?'); params.push(status); }
  if (from) { where.push('start_time>=?'); params.push(from); }
  if (to) { where.push('start_time<=?'); params.push(to); }
  
  const sql = `SELECT COUNT(*) as count FROM reservation WHERE ${where.join(' AND ')}`;
  
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ count: rows[0].count });
  });
});

// 管理员获取单个预约详情
app.get('/api/admin/reservation/:id', (req, res) => {
  const { id } = req.params;
  
  const sql = `SELECT r.*, s.real_name AS student_name, s.phone AS student_phone,
               c.real_name AS coach_name, c.phone AS coach_phone, t.code AS table_code
               FROM reservation r 
               LEFT JOIN user s ON r.student_id=s.id 
               LEFT JOIN user c ON r.coach_id=c.id 
               LEFT JOIN table_court t ON r.table_id=t.id
               WHERE r.id=?`;
  
  db.query(sql, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length === 0) return res.status(404).json({ error: '预约不存在' });
    res.json({ success: true, reservation: rows[0] });
  });
});

// 管理员修改预约
app.put('/api/admin/reservation/:id', (req, res) => {
  const { id } = req.params;
  const { start_time, duration, table_id, reason, admin_id } = req.body;
  
  if (!start_time || !duration || !reason || !admin_id) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  
  // 检查预约是否存在
  db.query('SELECT * FROM reservation WHERE id=?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length === 0) return res.status(404).json({ error: '预约不存在' });
    
    const reservation = rows[0];
    const endTime = new Date(new Date(start_time).getTime() + duration * 60 * 60 * 1000);
    
    // 检查球台冲突（如果指定了球台）
    if (table_id) {
      const conflictSql = `SELECT id FROM reservation WHERE table_id=? AND id!=? AND status IN ('confirmed', 'pending') 
                          AND ((start_time <= ? AND end_time > ?) OR (start_time < ? AND end_time >= ?))`;
      
      db.query(conflictSql, [table_id, id, start_time, start_time, endTime, endTime], (err, conflicts) => {
        if (err) return res.status(500).json({ error: '冲突检查失败' });
        if (conflicts.length > 0) return res.status(400).json({ error: '选定时间段球台已被占用' });
        
        proceedWithUpdate();
      });
    } else {
      proceedWithUpdate();
    }
    
    function proceedWithUpdate() {
      // 重新计算费用
      db.query('SELECT hourly_fee FROM user WHERE id=?', [reservation.coach_id], (err, coachRows) => {
        if (err) return res.status(500).json({ error: '查询教练信息失败' });
        
        const hourlyFee = coachRows[0]?.hourly_fee || 80;
        const newFee = hourlyFee * duration;
        
        // 更新预约
        const updateSql = `UPDATE reservation SET start_time=?, end_time=?, duration=?, table_id=?, fee=? WHERE id=?`;
        db.query(updateSql, [start_time, endTime, duration, table_id, newFee, id], (err, result) => {
          if (err) return res.status(500).json({ error: '更新失败' });
          
          // 通知相关人员
          const message = `管理员修改了您的预约信息。修改原因：${reason}。新的上课时间：${new Date(start_time).toLocaleString()}`;
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '预约信息变更', ?)`, 
                   [reservation.student_id, message]);
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '预约信息变更', ?)`, 
                   [reservation.coach_id, message]);
          
          logAudit('admin_reservation_update', admin_id, { reservation_id: id, reason, original_time: reservation.start_time, new_time: start_time });
          res.json({ success: true });
        });
      });
    }
  });
});

// 管理员取消预约
app.post('/api/admin/reservation/:id/cancel', (req, res) => {
  const { id } = req.params;
  const { reason, admin_id } = req.body;
  
  if (!reason || !admin_id) {
    return res.status(400).json({ error: '缺少取消原因或管理员ID' });
  }
  
  // 检查预约状态
  db.query('SELECT * FROM reservation WHERE id=?', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length === 0) return res.status(404).json({ error: '预约不存在' });
    
    const reservation = rows[0];
    
    if (reservation.status === 'cancelled' || reservation.status === 'completed') {
      return res.status(400).json({ error: '该预约已经取消或完成，无法再次取消' });
    }
    
    // 取消预约并退款
    db.beginTransaction((err) => {
      if (err) return res.status(500).json({ error: '事务开始失败' });
      
      // 更新预约状态
      db.query('UPDATE reservation SET status=?, cancel_reason=? WHERE id=?', 
               ['cancelled', `管理员取消：${reason}`, id], (err) => {
        if (err) {
          return db.rollback(() => {
            res.status(500).json({ error: '取消失败' });
          });
        }
        
        // 退款（如果已支付）
        if (reservation.status === 'confirmed') {
          db.query(`UPDATE account SET balance=balance+? WHERE user_id=?`, 
                   [reservation.fee, reservation.student_id], (err) => {
            if (err) {
              return db.rollback(() => {
                res.status(500).json({ error: '退款失败' });
              });
            }
            
            // 记录退款交易
            db.query(`INSERT INTO \`transaction\` (user_id, amount, type, description) VALUES (?, ?, 'refund', ?)`,
                     [reservation.student_id, reservation.fee, `预约${id}管理员取消退款`], (err) => {
              if (err) console.error('退款记录失败:', err);
              
              completeCancel();
            });
          });
        } else {
          completeCancel();
        }
        
        function completeCancel() {
          // 通知相关人员
          const message = `管理员取消了您的预约。取消原因：${reason}${reservation.status === 'confirmed' ? '。课时费已退回您的账户。' : ''}`;
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '预约已取消', ?)`, 
                   [reservation.student_id, message]);
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '预约已取消', ?)`, 
                   [reservation.coach_id, `管理员取消了学员的预约。取消原因：${reason}`]);
          
          db.commit((err) => {
            if (err) {
              return db.rollback(() => {
                res.status(500).json({ error: '提交事务失败' });
              });
            }
            
            logAudit('admin_reservation_cancel', admin_id, { reservation_id: id, reason });
            res.json({ success: true });
          });
        }
      });
    });
  });
});

// 添加校区
app.post('/api/admin/campus', (req, res) => {
  const { name, address, contact_name, contact_phone, contact_email } = req.body;
  if (!name) return res.status(400).json({ error: '校区名称不能为空' });
  
  const sql = `INSERT INTO campus (name, address, contact_name, contact_phone, contact_email) VALUES (?, ?, ?, ?, ?)`;
  db.query(sql, [name, address, contact_name, contact_phone, contact_email], (err, result) => {
    if (err) return res.status(500).json({ error: '创建失败' });
    
    logAudit('campus_create', null, { campus_id: result.insertId, name });
    res.json({ success: true, campus_id: result.insertId });
  });
});

// 添加球台
app.post('/api/admin/table', (req, res) => {
  const { campus_id, code } = req.body;
  if (!campus_id || !code) return res.status(400).json({ error: '缺少参数' });
  
  const sql = `INSERT INTO table_court (campus_id, code) VALUES (?, ?)`;
  db.query(sql, [campus_id, code], (err, result) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '该校区已存在相同编号的球台' });
      return res.status(500).json({ error: '创建失败' });
    }
    
    logAudit('table_create', null, { table_id: result.insertId, campus_id, code });
    res.json({ success: true, table_id: result.insertId });
  });
});

// 获取球台列表
app.get('/api/tables', (req, res) => {
  const { campus_id } = req.query;
  let where = '1=1';
  let params = [];
  
  if (campus_id) { where = 'campus_id=?'; params.push(campus_id); }
  
  const sql = `SELECT t.*, c.name AS campus_name FROM table_court t 
               LEFT JOIN campus c ON t.campus_id=c.id WHERE ${where} ORDER BY t.campus_id, t.code`;
  
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
  });
});

// 线下充值（管理员操作）
app.post('/api/admin/recharge', (req, res) => {
  const { user_id, amount, admin_id } = req.body;
  if (!user_id || !amount || amount <= 0 || !admin_id) return res.status(400).json({ error: '参数不合法' });
  
  const upsert = `INSERT INTO account (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)`;
  db.query(upsert, [user_id, amount], (e1) => {
    if (e1) return res.status(500).json({ error: '充值失败' });
    
    // 添加交易记录，带错误处理
    db.query(`INSERT INTO \`transaction\` (user_id, amount, type) VALUES (?, ?, 'recharge')`, 
      [user_id, amount], (e2) => {
        if (e2) console.error('插入交易记录失败:', e2);
      });
    
    // 发送消息通知，带错误处理
    db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '账户充值', CONCAT('管理员为您充值￥', ?))`, 
      [user_id, amount], (e3) => {
        if (e3) console.error('发送充值通知失败:', e3);
      });
    
    logAudit('admin_recharge', admin_id, { user_id, amount });
    res.json({ success: true });
  });
});

// 获取交易记录
app.get('/api/transactions', (req, res) => {
  const { user_id, type, from, to } = req.query;
  let where = ['1=1'];
  let params = [];
  
  if (user_id) { where.push('user_id=?'); params.push(user_id); }
  if (type) { where.push('type=?'); params.push(type); }
  if (from) { where.push('created_at>=?'); params.push(from); }
  if (to) { where.push('created_at<=?'); params.push(to); }
  
  const sql = `SELECT * FROM \`transaction\` WHERE ${where.join(' AND ')} ORDER BY created_at DESC`;
  
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
  });
});

// 获取审计日志（管理员专用）
app.get('/api/admin/audit-log', (req, res) => {
  const { action, actor_id, campus_id, from, to, username, limit = 100 } = req.query;
  let where = ['1=1'];
  let params = [];
  
  if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
  if (actor_id) { where.push('a.user_id=?'); params.push(actor_id); }
  if (username) { where.push('(u.username LIKE ? OR u.real_name LIKE ?)'); params.push(`%${username}%`, `%${username}%`); }
  if (from) { where.push('a.created_at>=?'); params.push(from); }
  if (to) { where.push('a.created_at<=?'); params.push(to); }
  
  // 如果指定了校区ID，则只显示该校区用户的日志
  if (campus_id) {
    where.push('(a.user_id IS NULL OR u.campus_id=?)');
    params.push(campus_id);
  }
  
  const sql = `
    SELECT a.*, u.real_name, u.username, u.campus_id 
    FROM audit_log a 
    LEFT JOIN user u ON a.user_id = u.id 
    WHERE ${where.join(' AND ')} 
    ORDER BY a.created_at DESC 
    LIMIT ?
  `;
  params.push(parseInt(limit));
  
  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('audit-log查询失败:', err);
      return res.status(500).json({ error: '查询失败: ' + err.message });
    }
    
    // 为每条日志增加用户信息
    const enrichedLogs = rows.map(log => ({
      ...log,
      user_info: log.real_name ? `${log.real_name}(${log.username})` : '系统'
    }));
    
    res.json(enrichedLogs);
  });
});

// 测试audit_log表状态的API
app.get('/api/admin/audit-log-test', (req, res) => {
  // 测试表是否存在
  db.query('SHOW TABLES LIKE "audit_log"', (err, tables) => {
    if (err) {
      return res.json({ 
        error: '数据库查询失败: ' + err.message,
        tableExists: false 
      });
    }
    
    if (tables.length === 0) {
      return res.json({ 
        error: 'audit_log表不存在',
        tableExists: false 
      });
    }
    
    // 检查表结构
    db.query('DESCRIBE audit_log', (err, structure) => {
      if (err) {
        return res.json({ 
          error: '获取表结构失败: ' + err.message,
          tableExists: true 
        });
      }
      
      // 检查数据数量
      db.query('SELECT COUNT(*) as count FROM audit_log', (err, count) => {
        if (err) {
          return res.json({ 
            error: '统计数据失败: ' + err.message,
            tableExists: true,
            structure: structure 
          });
        }
        
        res.json({
          tableExists: true,
          structure: structure,
          recordCount: count[0].count,
          message: 'audit_log表正常'
        });
      });
    });
  });
});

// 手动添加测试日志的API
app.post('/api/admin/add-test-log', (req, res) => {
  const testLogs = [
    ['user_login', 1, JSON.stringify({ username: 'test_user', role: 'student' })],
    ['student_register', 2, JSON.stringify({ username: 'new_student', campus_id: 1 })],
    ['coach_approve', null, JSON.stringify({ coach_id: 3, approve: true })],
    ['reservation_create', 1, JSON.stringify({ coach_id: 3, start_time: '2025-01-20 10:00:00' })]
  ];
  
  let completed = 0;
  const total = testLogs.length;
  
  testLogs.forEach(([action, user_id, details]) => {
    db.query('INSERT INTO audit_log (action, user_id, details) VALUES (?, ?, ?)', 
      [action, user_id, details], (err) => {
        if (err) console.error('插入测试日志失败:', err);
        completed++;
        if (completed === total) {
          res.json({ 
            success: true, 
            message: `已添加 ${total} 条测试日志` 
          });
        }
      });
  });
});

// 确保audit_log表存在的API
app.post('/api/admin/ensure-audit-log-table', (req, res) => {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS audit_log (
      id INT PRIMARY KEY AUTO_INCREMENT,
      action VARCHAR(100) NOT NULL,
      user_id INT,
      details JSON,
      ip_address VARCHAR(45),
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  db.query(createTableSQL, (err) => {
    if (err) {
      console.error('创建audit_log表失败:', err);
      return res.status(500).json({ error: '创建表失败: ' + err.message });
    }
    
    res.json({ success: true, message: 'audit_log表已确保存在' });
  });
});

// 获取系统统计数据
app.get('/api/admin/statistics', (req, res) => {
  const { campus_id } = req.query;
  let whereClause = campus_id ? `WHERE campus_id=${campus_id}` : '';
  
  const stats = {
    users: {},
    reservations: {},
    revenue: {}
  };
  
  // 用户统计
  db.query(`SELECT role, COUNT(*) as count FROM user ${whereClause} GROUP BY role`, (e1, userStats) => {
    if (e1) {
      console.error('用户统计查询失败:', e1);
      return res.status(500).json({ error: '用户统计失败: ' + e1.message });
    }
    
    console.log('用户统计结果:', userStats);
    stats.users = userStats ? userStats.reduce((acc, row) => ({ ...acc, [row.role]: row.count }), {}) : {};
    
    // 预约统计
    const reservationQuery = campus_id ? 
      `SELECT status, COUNT(*) as count FROM reservation WHERE campus_id=${campus_id} GROUP BY status` :
      `SELECT status, COUNT(*) as count FROM reservation GROUP BY status`;
    
    db.query(reservationQuery, (e2, resStats) => {
      if (e2) {
        console.error('预约统计查询失败:', e2);
        return res.status(500).json({ error: '预约统计失败: ' + e2.message });
      }
      
      console.log('预约统计结果:', resStats);
      stats.reservations = resStats ? resStats.reduce((acc, row) => ({ ...acc, [row.status]: row.count }), {}) : {};
      
      // 收入统计
      db.query(`SELECT type, SUM(amount) as total FROM transaction WHERE amount > 0 GROUP BY type`, (e3, revStats) => {
        if (e3) {
          console.error('收入统计查询失败:', e3);
          // 不让收入统计失败影响整个API
          stats.revenue = {};
        } else {
          console.log('收入统计结果:', revStats);
          stats.revenue = revStats ? revStats.reduce((acc, row) => ({ ...acc, [row.type]: row.total }), {}) : {};
        }
        
        res.json(stats);
      });
    });
  });
});

// 支付管理 API
// 获取支付统计
app.get('/api/payment/stats', (req, res) => {
  const queries = [
    // 今日收入
    `SELECT COALESCE(SUM(amount), 0) as todayIncome 
     FROM \`transaction\` 
     WHERE DATE(created_at) = CURDATE() AND amount > 0`,
    
    // 本月收入
    `SELECT COALESCE(SUM(amount), 0) as monthIncome 
     FROM \`transaction\` 
     WHERE YEAR(created_at) = YEAR(CURDATE()) 
     AND MONTH(created_at) = MONTH(CURDATE()) 
     AND amount > 0`,
    
    // 总充值金额
    `SELECT COALESCE(SUM(amount), 0) as totalRecharge 
     FROM \`transaction\` 
     WHERE type = 'recharge' AND amount > 0`,
    
    // 课程收入
    `SELECT COALESCE(SUM(ABS(amount)), 0) as courseIncome 
     FROM \`transaction\` 
     WHERE type = 'reservation_fee' AND amount < 0`
  ];

  Promise.all(queries.map(query => new Promise((resolve, reject) => {
    db.query(query, (err, rows) => {
      if (err) reject(err);
      else resolve(rows[0]);
    });
  }))).then(results => {
    res.json({
      todayIncome: results[0].todayIncome || 0,
      monthIncome: results[1].monthIncome || 0,
      totalRecharge: results[2].totalRecharge || 0,
      courseIncome: results[3].courseIncome || 0
    });
  }).catch(err => {
    res.status(500).json({ error: '查询统计数据失败' });
  });
});

// 获取交易记录（带分页和过滤）
app.get('/api/payment/transactions', (req, res) => {
  const { page = 1, pageSize = 20, userId, type, method, startDate, endDate } = req.query;
  
  let whereConditions = [];
  let params = [];
  
  if (userId) {
    whereConditions.push('t.user_id = ?');
    params.push(userId);
  }
  
  if (type) {
    whereConditions.push('t.type = ?');
    params.push(type);
  }
  
  if (method) {
    if (method === 'wechat') {
      whereConditions.push('t.description LIKE ?');
      params.push('%微信%');
    } else if (method === 'alipay') {
      whereConditions.push('t.description LIKE ?');
      params.push('%支付宝%');
    } else if (method === 'offline') {
      whereConditions.push('t.description LIKE ?');
      params.push('%线下%');
    }
  }
  
  if (startDate) {
    whereConditions.push('DATE(t.created_at) >= ?');
    params.push(startDate);
  }
  
  if (endDate) {
    whereConditions.push('DATE(t.created_at) <= ?');
    params.push(endDate);
  }
  
  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
  
  // 查询总数
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM \`transaction\` t 
    LEFT JOIN user u ON t.user_id = u.id 
    ${whereClause}
  `;
  
  db.query(countQuery, params, (err, countRows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    
    // 查询记录
    const dataQuery = `
      SELECT t.*, u.username, u.email
      FROM \`transaction\` t 
      LEFT JOIN user u ON t.user_id = u.id 
      ${whereClause}
      ORDER BY t.created_at DESC 
      LIMIT ? OFFSET ?
    `;
    
    db.query(dataQuery, [...params, parseInt(pageSize), offset], (err, rows) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      
      res.json({
        transactions: rows || [],
        totalPages,
        currentPage: parseInt(page),
        total
      });
    });
  });
});

// 获取单个交易详情
app.get('/api/payment/transaction/:id', (req, res) => {
  const { id } = req.params;
  
  db.query(`
    SELECT t.*, u.username, u.email, u.phone
    FROM \`transaction\` t 
    LEFT JOIN user u ON t.user_id = u.id 
    WHERE t.id = ?
  `, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (!rows || rows.length === 0) return res.status(404).json({ error: '交易记录不存在' });
    
    res.json({ transaction: rows[0] });
  });
});

// 退款
app.post('/api/payment/refund', (req, res) => {
  const { transactionId, amount, reason } = req.body;
  
  if (!transactionId || !amount || amount <= 0 || !reason) {
    return res.status(400).json({ error: '参数不完整' });
  }
  
  // 查询原交易
  db.query(`SELECT * FROM \`transaction\` WHERE id = ?`, [transactionId], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询原交易失败' });
    if (!rows || rows.length === 0) return res.status(404).json({ error: '原交易不存在' });
    
    const originalTransaction = rows[0];
    
    if (originalTransaction.amount <= 0) {
      return res.status(400).json({ error: '该交易不支持退款' });
    }
    
    if (amount > originalTransaction.amount) {
      return res.status(400).json({ error: '退款金额不能超过原交易金额' });
    }
    
    // 开始退款事务
    db.beginTransaction(err => {
      if (err) return res.status(500).json({ error: '事务开始失败' });
      
      // 扣除用户余额
      db.query(`
        UPDATE account 
        SET balance = balance - ? 
        WHERE user_id = ? AND balance >= ?
      `, [amount, originalTransaction.user_id, amount], (err, result) => {
        if (err) {
          return db.rollback(() => {
            res.status(500).json({ error: '扣除余额失败' });
          });
        }
        
        if (result.affectedRows === 0) {
          return db.rollback(() => {
            res.status(400).json({ error: '用户余额不足，无法退款' });
          });
        }
        
        // 创建退款记录
        db.query(`
          INSERT INTO \`transaction\` (user_id, amount, type, description, ref_id) 
          VALUES (?, ?, 'refund', ?, ?)
        `, [originalTransaction.user_id, -amount, `退款: ${reason}`, transactionId], (err) => {
          if (err) {
            return db.rollback(() => {
              res.status(500).json({ error: '创建退款记录失败' });
            });
          }
          
          // 记录审计日志
          db.query(`
            INSERT INTO audit_log (action, user_id, details) 
            VALUES ('refund', ?, ?)
          `, [originalTransaction.user_id, JSON.stringify({
            originalTransactionId: transactionId,
            refundAmount: amount,
            reason: reason
          })], (err) => {
            if (err) console.error('记录审计日志失败:', err);
            
            db.commit(err => {
              if (err) {
                return db.rollback(() => {
                  res.status(500).json({ error: '提交事务失败' });
                });
              }
              
              res.json({ success: true, message: '退款成功' });
            });
          });
        });
      });
    });
  });
});

// 导出交易记录
app.get('/api/payment/export', (req, res) => {
  const { userId, type, method, startDate, endDate } = req.query;
  
  let whereConditions = [];
  let params = [];
  
  if (userId) {
    whereConditions.push('t.user_id = ?');
    params.push(userId);
  }
  
  if (type) {
    whereConditions.push('t.type = ?');
    params.push(type);
  }
  
  if (method) {
    if (method === 'wechat') {
      whereConditions.push('t.description LIKE ?');
      params.push('%微信%');
    } else if (method === 'alipay') {
      whereConditions.push('t.description LIKE ?');
      params.push('%支付宝%');
    } else if (method === 'offline') {
      whereConditions.push('t.description LIKE ?');
      params.push('%线下%');
    }
  }
  
  if (startDate) {
    whereConditions.push('DATE(t.created_at) >= ?');
    params.push(startDate);
  }
  
  if (endDate) {
    whereConditions.push('DATE(t.created_at) <= ?');
    params.push(endDate);
  }
  
  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
  
  const query = `
    SELECT 
      t.id as '交易ID',
      t.user_id as '用户ID',
      u.username as '用户名',
      u.email as '邮箱',
      t.amount as '金额',
      t.type as '类型',
      t.description as '描述',
      t.ref_id as '关联预约',
      t.created_at as '交易时间'
    FROM \`transaction\` t 
    LEFT JOIN user u ON t.user_id = u.id 
    ${whereClause}
    ORDER BY t.created_at DESC
  `;
  
  db.query(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '导出失败' });
    
    // 设置CSV下载头
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=transactions_${new Date().toISOString().split('T')[0]}.csv`);
    
    // 添加BOM以支持中文
    res.write('\uFEFF');
    
    // 写入CSV头部
    const headers = Object.keys(rows[0] || {});
    res.write(headers.join(',') + '\n');
    
    // 写入数据行
    rows.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        // 处理包含逗号或引号的值
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return '"' + value.replace(/"/g, '""') + '"';
        }
        return value || '';
      });
      res.write(values.join(',') + '\n');
    });
    
    res.end();
  });
});

// 学生统计API
app.get('/api/student/stats/:userId', (req, res) => {
  const userId = req.params.userId;
  
  // 获取各种统计数据
  const statsQuery = `
    SELECT 
      (SELECT COUNT(*) FROM bookings WHERE student_id = ?) as total_bookings,
      (SELECT COUNT(*) FROM bookings WHERE student_id = ? AND status = 'completed') as completed_lessons,
      (SELECT COUNT(DISTINCT coach_id) FROM bookings WHERE student_id = ?) as coaches_trained_with,
      (SELECT SUM(amount) FROM payments WHERE user_id = ?) as total_spent,
      (SELECT COUNT(*) FROM reviews WHERE student_id = ?) as reviews_given,
      (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE student_id = ?) as avg_rating_given
  `;
  
  db.query(statsQuery, [userId, userId, userId, userId, userId, userId], (err, results) => {
    if (err) {
      console.error('获取学生统计失败:', err);
      return res.status(500).json({ error: '获取统计数据失败' });
    }
    
    const stats = results[0] || {};
    res.json({
      totalBookings: stats.total_bookings || 0,
      completedLessons: stats.completed_lessons || 0,
      coachesTrainedWith: stats.coaches_trained_with || 0,
      totalSpent: parseFloat(stats.total_spent || 0),
      reviewsGiven: stats.reviews_given || 0,
      avgRatingGiven: parseFloat(stats.avg_rating_given || 0)
    });
  });
});

// 获取学生最近活动
app.get('/api/student/recent-activity/:userId', (req, res) => {
  const userId = req.params.userId;
  
  const activityQuery = `
    (SELECT 'booking' as type, b.id, b.lesson_date as date, b.lesson_time as time, 
     u.name as coach_name, b.status, NULL as amount, NULL as rating
     FROM bookings b 
     JOIN users u ON b.coach_id = u.id 
     WHERE b.student_id = ?)
    UNION ALL
    (SELECT 'payment' as type, p.id, p.created_at as date, NULL as time,
     NULL as coach_name, 'completed' as status, p.amount, NULL as rating
     FROM payments p 
     WHERE p.user_id = ?)
    UNION ALL
    (SELECT 'review' as type, r.id, r.created_at as date, NULL as time,
     u.name as coach_name, 'completed' as status, NULL as amount, r.rating
     FROM reviews r 
     JOIN users u ON r.coach_id = u.id 
     WHERE r.student_id = ?)
    ORDER BY date DESC
    LIMIT 10
  `;
  
  db.query(activityQuery, [userId, userId, userId], (err, results) => {
    if (err) {
      console.error('获取学生活动失败:', err);
      return res.status(500).json({ error: '获取活动数据失败' });
    }
    
    res.json(results);
  });
});

// 获取学生待处理事项
app.get('/api/student/pending-tasks/:userId', (req, res) => {
  const userId = req.params.userId;
  
  const tasksQuery = `
    SELECT 
      (SELECT COUNT(*) FROM bookings 
       WHERE student_id = ? AND status = 'pending') as pending_bookings,
      (SELECT COUNT(*) FROM bookings 
       WHERE student_id = ? AND status = 'confirmed' AND lesson_date >= CURDATE()) as upcoming_lessons,
      (SELECT COUNT(*) FROM reviews r
       JOIN bookings b ON r.booking_id = b.id
       WHERE b.student_id = ? AND r.student_id IS NULL AND b.status = 'completed') as pending_reviews,
      (SELECT COUNT(*) FROM messages 
       WHERE receiver_id = ? AND is_read = 0) as unread_messages
  `;
  
  db.query(tasksQuery, [userId, userId, userId, userId], (err, results) => {
    if (err) {
      console.error('获取待处理事项失败:', err);
      return res.status(500).json({ error: '获取待处理事项失败' });
    }
    
    const tasks = results[0] || {};
    res.json({
      pendingBookings: tasks.pending_bookings || 0,
      upcomingLessons: tasks.upcoming_lessons || 0,
      pendingReviews: tasks.pending_reviews || 0,
      unreadMessages: tasks.unread_messages || 0
    });
  });
});

// 获取学生即将到来的课程
app.get('/api/student/upcoming-lessons/:userId', (req, res) => {
  const userId = req.params.userId;
  
  const upcomingQuery = `
    SELECT b.*, u.name as coach_name, u.phone as coach_phone
    FROM bookings b
    JOIN users u ON b.coach_id = u.id
    WHERE b.student_id = ? 
    AND b.status IN ('confirmed', 'pending')
    AND b.lesson_date >= CURDATE()
    ORDER BY b.lesson_date ASC, b.lesson_time ASC
    LIMIT 5
  `;
  
  db.query(upcomingQuery, [userId], (err, results) => {
    if (err) {
      console.error('获取即将到来的课程失败:', err);
      return res.status(500).json({ error: '获取课程数据失败' });
    }
    
    res.json(results);
  });
});

// 课后评价相关API

// 提交课后评价
app.post('/api/reviews', (req, res) => {
  const { reservation_id, reviewer_id, reviewer_type, rating, comment } = req.body;
  if (!reservation_id || !reviewer_id || !reviewer_type || !rating) {
    return res.status(400).json({ error: '缺少必填参数' });
  }
  
  // 检查预约是否存在且已完成
  db.query('SELECT * FROM reservation WHERE id = ? AND status = "completed"', [reservation_id], (err, reservations) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (reservations.length === 0) return res.status(404).json({ error: '预约不存在或未完成' });
    
    const reservation = reservations[0];
    
    // 验证评价者身份
    if ((reviewer_type === 'student' && reservation.student_id !== reviewer_id) ||
        (reviewer_type === 'coach' && reservation.coach_id !== reviewer_id)) {
      return res.status(403).json({ error: '无权评价此课程' });
    }
    
    // 检查是否已经评价过
    db.query('SELECT * FROM reviews WHERE reservation_id = ? AND reviewer_id = ? AND reviewer_type = ?', 
      [reservation_id, reviewer_id, reviewer_type], (err, existing) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      if (existing.length > 0) return res.status(400).json({ error: '已经评价过此课程' });
      
      // 插入评价
      const sql = `INSERT INTO reviews (reservation_id, reviewer_id, reviewer_type, rating, comment) VALUES (?, ?, ?, ?, ?)`;
      db.query(sql, [reservation_id, reviewer_id, reviewer_type, rating, comment || ''], (err) => {
        if (err) return res.status(500).json({ error: '评价提交失败' });
        
        // 记录审计日志
        logAudit('review_submit', reviewer_id, { reservation_id, rating, reviewer_type });
        
        res.json({ success: true });
      });
    });
  });
});

// 获取评价列表
app.get('/api/reviews', (req, res) => {
  const { reservation_id, reviewer_id, reviewer_type, target_id, target_type } = req.query;
  
  let sql = `
    SELECT r.*, res.start_time, res.end_time,
           student.real_name as student_name, coach.real_name as coach_name
    FROM reviews r
    JOIN reservation res ON r.reservation_id = res.id
    JOIN user student ON res.student_id = student.id
    JOIN user coach ON res.coach_id = coach.id
    WHERE 1=1
  `;
  const params = [];
  
  if (reservation_id) {
    sql += ' AND r.reservation_id = ?';
    params.push(reservation_id);
  }
  
  if (reviewer_id) {
    sql += ' AND r.reviewer_id = ?';
    params.push(reviewer_id);
  }
  
  if (reviewer_type) {
    sql += ' AND r.reviewer_type = ?';
    params.push(reviewer_type);
  }
  
  if (target_id && target_type) {
    if (target_type === 'student') {
      sql += ' AND res.student_id = ?';
    } else if (target_type === 'coach') {
      sql += ' AND res.coach_id = ?';
    }
    params.push(target_id);
  }
  
  sql += ' ORDER BY r.created_at DESC';
  
  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(results);
  });
});

// 获取待评价的课程
app.get('/api/reviews/pending', (req, res) => {
  const { user_id, user_type } = req.query;
  if (!user_id || !user_type) return res.status(400).json({ error: '缺少参数' });
  
  let sql = `
    SELECT res.*, 
           student.real_name as student_name, coach.real_name as coach_name,
           t.code as table_code
    FROM reservation res
    JOIN user student ON res.student_id = student.id
    JOIN user coach ON res.coach_id = coach.id
    LEFT JOIN table_court t ON res.table_id = t.id
    WHERE res.status = 'completed'
  `;
  
  if (user_type === 'student') {
    sql += ' AND res.student_id = ?';
  } else if (user_type === 'coach') {
    sql += ' AND res.coach_id = ?';
  }
  
  sql += ` AND NOT EXISTS (
    SELECT 1 FROM reviews WHERE reservation_id = res.id
    AND reviewer_id = ? AND reviewer_type = ?
  )`;
  sql += ' ORDER BY res.end_time DESC';
  
  db.query(sql, [user_id, user_id, user_type], (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(results);
  });
});

// 获取学员待评价的课程
app.get('/api/reviews/pending/:user_id', (req, res) => {
  const user_id = req.params.user_id;
  
  const sql = `
    SELECT r.*, 
           c.real_name as coach_name,
           t.code as table_code
    FROM reservation r
    JOIN user c ON r.coach_id = c.id
    LEFT JOIN table_court t ON r.table_id = t.id
    WHERE r.student_id = ? 
    AND r.status = 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM course_review cr WHERE cr.reservation_id = r.id
    )
    ORDER BY r.end_time DESC
  `;
  
  db.query(sql, [user_id], (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ reservations: results });
  });
});

// 获取学员的评价历史
app.get('/api/reviews/my/:user_id', (req, res) => {
  const user_id = req.params.user_id;
  
  const sql = `
    SELECT cr.*, 
           c.real_name as coach_name,
           r.start_time as lesson_time
    FROM course_review cr
    JOIN reservation r ON cr.reservation_id = r.id
    JOIN user c ON cr.coach_id = c.id
    WHERE cr.student_id = ?
    ORDER BY cr.created_at DESC
  `;
  
  db.query(sql, [user_id], (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ reviews: results });
  });
});

// 获取教练收到的评价
app.get('/api/reviews/received/:coach_id', (req, res) => {
  const coach_id = req.params.coach_id;
  
  const sql = `
    SELECT cr.*, 
           s.real_name as student_name,
           r.start_time as lesson_time
    FROM course_review cr
    JOIN reservation r ON cr.reservation_id = r.id
    JOIN user s ON cr.student_id = s.id
    WHERE cr.coach_id = ?
    ORDER BY cr.created_at DESC
  `;
  
  db.query(sql, [coach_id], (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ reviews: results });
  });
});

// 获取教练评价统计
app.get('/api/reviews/coach-stats/:coach_id', (req, res) => {
  const coach_id = req.params.coach_id;
  
  const sql = `
    SELECT 
      COUNT(*) as totalReviews,
      AVG(rating) as avgRating,
      COUNT(CASE WHEN rating >= 4 THEN 1 END) / COUNT(*) as goodRating,
      COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH) THEN 1 END) as monthReviews
    FROM course_review
    WHERE coach_id = ?
  `;
  
  db.query(sql, [coach_id], (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    
    const stats = results[0] || {
      totalReviews: 0,
      avgRating: 0,
      goodRating: 0,
      monthReviews: 0
    };
    
    res.json(stats);
  });
});

// 提交课程评价
app.post('/api/reviews/submit', (req, res) => {
  const { reservation_id, student_id, coach_id, rating, comment } = req.body;
  
  if (!reservation_id || !student_id || !coach_id || !rating || !comment) {
    return res.status(400).json({ error: '缺少必填参数' });
  }
  
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: '评分必须在1-5之间' });
  }
  
  // 检查是否已经评价过
  db.query('SELECT id FROM course_review WHERE reservation_id = ?', [reservation_id], (err, existing) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (existing.length > 0) return res.status(400).json({ error: '该课程已经评价过了' });
    
    // 检查预约是否存在且已完成
    db.query('SELECT * FROM reservation WHERE id = ? AND student_id = ? AND status = "completed"', 
      [reservation_id, student_id], (err, reservations) => {
      if (err) return res.status(500).json({ error: '查询预约失败' });
      if (reservations.length === 0) return res.status(404).json({ error: '预约不存在或未完成' });
      
      // 插入评价
      const reviewData = {
        reservation_id,
        student_id,
        coach_id,
        rating,
        comment
      };
      
      db.query('INSERT INTO course_review SET ?', reviewData, (err) => {
        if (err) return res.status(500).json({ error: '提交评价失败' });
        
        // 发送通知给教练
        sendMessage(coach_id, '收到新评价', `学员对您的课程给出了${rating}星评价：${comment}`);
        
        logAudit('course_review', student_id, { reservation_id, rating });
        
        res.json({ success: true });
      });
    });
  });
});

// 教练更换相关API

// 申请更换教练
app.post('/api/coach/change-request', (req, res) => {
  const { student_id, current_coach_id, new_coach_id, reason } = req.body;
  if (!student_id || !current_coach_id || !new_coach_id) {
    return res.status(400).json({ error: '缺少必填参数' });
  }
  
  // 验证双选关系存在
  db.query('SELECT * FROM coach_student WHERE coach_id = ? AND student_id = ? AND status = "approved"', 
    [current_coach_id, student_id], (err, relations) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (relations.length === 0) return res.status(400).json({ error: '当前教练关系不存在' });
    
    // 检查新教练是否可选
    db.query('SELECT * FROM user WHERE id = ? AND role = "coach" AND status = "active"', 
      [new_coach_id], (err, coaches) => {
      if (err) return res.status(500).json({ error: '查询失败' });
      if (coaches.length === 0) return res.status(400).json({ error: '目标教练不存在或不可用' });
      
      // 创建更换申请
      const sql = `INSERT INTO coach_change_request (student_id, current_coach_id, new_coach_id, reason, status) 
                   VALUES (?, ?, ?, ?, 'pending')`;
      db.query(sql, [student_id, current_coach_id, new_coach_id, reason || ''], (err, result) => {
        if (err) return res.status(500).json({ error: '申请提交失败' });
        
        const requestId = result.insertId;
        
        // 发送消息给三方
        const messages = [
          { recipient_id: current_coach_id, title: '教练更换申请', content: `学员申请更换教练，申请ID: ${requestId}` },
          { recipient_id: new_coach_id, title: '教练更换申请', content: `有学员申请将您设为新教练，申请ID: ${requestId}` }
        ];
        
        // 获取校区管理员
        db.query('SELECT u.id FROM user u JOIN user s ON s.campus_id = u.campus_id WHERE s.id = ? AND u.role = "campus_admin"', 
          [student_id], (err, admins) => {
          if (admins.length > 0) {
            messages.push({ 
              recipient_id: admins[0].id, 
              title: '教练更换申请', 
              content: `有学员申请更换教练，申请ID: ${requestId}` 
            });
          }
          
          // 批量发送消息，带错误处理
          messages.forEach(msg => {
            db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, ?, ?)`, 
              [msg.recipient_id, msg.title, msg.content], (err) => {
                if (err) console.error('发送教练更换申请消息失败:', err);
              });
          });
        });
        
        logAudit('coach_change_request', student_id, { current_coach_id, new_coach_id });
        res.json({ success: true, request_id: requestId });
      });
    });
  });
});

// 处理教练更换申请
app.post('/api/coach/change-request/:id/respond', (req, res) => {
  const requestId = req.params.id;
  const { user_id, user_type, approve, response_text } = req.body;
  
  if (!user_id || !user_type || approve === undefined) {
    return res.status(400).json({ error: '缺少参数' });
  }
  
  // 获取申请详情
  db.query('SELECT * FROM coach_change_request WHERE id = ? AND status = "pending"', [requestId], (err, requests) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (requests.length === 0) return res.status(404).json({ error: '申请不存在或已处理' });
    
    const request = requests[0];
    let updateField, newStatus;
    
    // 根据用户类型确定更新字段和状态
    if (user_type === 'current_coach') {
      updateField = 'current_coach_response';
      newStatus = approve ? 'current_coach_approved' : 'rejected';
    } else if (user_type === 'new_coach') {
      updateField = 'new_coach_response';
      newStatus = approve ? 'new_coach_approved' : 'rejected';
    } else if (user_type === 'admin') {
      updateField = 'admin_response';
      newStatus = approve ? 'admin_approved' : 'rejected';
    } else {
      return res.status(400).json({ error: '无效的用户类型' });
    }
    
    // 验证用户权限
    if ((user_type === 'current_coach' && request.current_coach_id !== parseInt(user_id)) ||
        (user_type === 'new_coach' && request.new_coach_id !== parseInt(user_id))) {
      return res.status(403).json({ error: '无权限处理此申请' });
    }
    
    if (!approve) {
      // 拒绝申请
      const sql = `UPDATE coach_change_request SET ${updateField} = ?, status = 'rejected' WHERE id = ?`;
      db.query(sql, [response_text || '拒绝', requestId], (err) => {
        if (err) return res.status(500).json({ error: '更新失败' });
        
        sendMessage(request.student_id, '教练更换申请被拒绝', `您的教练更换申请已被拒绝。原因：${response_text || '无'}`);
        logAudit('coach_change_rejected', user_id, { request_id: requestId, reason: response_text });
        res.json({ success: true });
      });
    } else {
      // 同意申请
      const sql = `UPDATE coach_change_request SET ${updateField} = ?, status = ? WHERE id = ?`;
      db.query(sql, [response_text || '同意', newStatus, requestId], (err) => {
        if (err) return res.status(500).json({ error: '更新失败' });
        
        // 检查是否所有相关方都已同意
        db.query('SELECT * FROM coach_change_request WHERE id = ?', [requestId], (err, updated) => {
          if (err) return res.status(500).json({ error: '查询失败' });
          
          const req = updated[0];
          // 如果当前教练、新教练和管理员都已同意，执行更换
          if (req.status === 'current_coach_approved' && 
              req.new_coach_response && req.new_coach_response !== '拒绝' &&
              req.admin_response && req.admin_response !== '拒绝') {
            executeCoachChange(req.student_id, req.current_coach_id, req.new_coach_id, requestId, res);
          } else {
            res.json({ success: true, message: '等待其他相关人员确认' });
          }
        });
      });
    }
  });
});

// 执行教练更换
function executeCoachChange(studentId, currentCoachId, newCoachId, requestId, res) {
  // 更新双选关系
  db.query('UPDATE coach_student SET coach_id = ? WHERE student_id = ? AND coach_id = ?', 
    [newCoachId, studentId, currentCoachId], (err) => {
    if (err) return res.status(500).json({ error: '更换失败' });
    
    // 更新申请状态为已完成
    db.query('UPDATE coach_change_request SET status = "admin_approved" WHERE id = ?', [requestId], (err) => {
      if (err) console.error('更新申请状态失败:', err);
      
      // 发送成功消息
      sendMessage(studentId, '教练更换成功', '您的教练更换申请已通过并生效');
      sendMessage(currentCoachId, '学员教练更换通知', '学员已更换教练');
      sendMessage(newCoachId, '新学员通知', '您有新的学员');
      
      logAudit('coach_change_success', studentId, { old_coach: currentCoachId, new_coach: newCoachId });
      res.json({ success: true });
    });
  });
}

// 辅助函数：检查是否为学员的校区管理员
function isAdminForStudent(adminId, studentId) {
  // 这里应该实现检查逻辑，暂时返回true
  return true; // 简化实现
}

// 辅助函数：发送系统消息
function sendMessage(recipientId, title, content) {
  const sql = `INSERT INTO message (recipient_id, title, content, created_at) VALUES (?, ?, ?, NOW())`;
  db.query(sql, [recipientId, title, content], (err, result) => {
    if (err) {
      console.error('发送消息失败:', err);
    }
  });
}

// 课程提醒功能

// 检查即将开始的课程并发送提醒
function checkUpcomingLessons() {
  const oneHourLater = new Date(Date.now() + 60 * 60 * 1000); // 1小时后
  const fiveMinutesLater = new Date(Date.now() + 5 * 60 * 1000); // 5分钟后
  
  const sql = `
    SELECT r.*, 
           s.real_name as student_name, c.real_name as coach_name,
           t.code as table_code
    FROM reservation r
    JOIN user s ON r.student_id = s.id
    JOIN user c ON r.coach_id = c.id
    LEFT JOIN table_court t ON r.table_id = t.id
    WHERE r.status = 'confirmed' 
    AND r.start_time BETWEEN ? AND ?
  `;
  
  db.query(sql, [fiveMinutesLater, oneHourLater], (err, lessons) => {
    if (err) {
      console.error('查询即将开始的课程失败:', err);
      return;
    }
    
    lessons.forEach(lesson => {
      const startTime = new Date(lesson.start_time).toLocaleString('zh-CN');
      
      // 发送给学员
      sendMessage(
        lesson.student_id, 
        '课程提醒',
        `您预约的课程即将开始！时间：${startTime}，教练：${lesson.coach_name}，球台：${lesson.table_code || '待分配'}`
      );
      
      // 发送给教练
      sendMessage(
        lesson.coach_id,
        '课程提醒', 
        `您有课程即将开始！时间：${startTime}，学员：${lesson.student_name}，球台：${lesson.table_code || '待分配'}`
      );
      
      // 标记提醒已发送 (暂时注释掉，避免字段不存在错误)
      // db.query('UPDATE reservation SET reminder_sent = 1 WHERE id = ?', [lesson.id], (err) => {
      //   if (err) console.error('更新提醒状态失败:', err);
      // });
      
      console.log(`课程提醒已发送: ${lesson.student_name} - ${lesson.coach_name} @ ${startTime}`);
    });
  });
}

// 定期检查即将开始的课程（每5分钟检查一次）
setInterval(checkUpcomingLessons, 5 * 60 * 1000);

// 月赛管理API

// 获取月赛信息
app.get('/api/tournament/info', (req, res) => {
  const sql = `
    SELECT 
      COUNT(*) as total_signups,
      SUM(CASE WHEN group_level = 'A' THEN 1 ELSE 0 END) as group_a_count,
      SUM(CASE WHEN group_level = 'B' THEN 1 ELSE 0 END) as group_b_count,
      SUM(CASE WHEN group_level = 'C' THEN 1 ELSE 0 END) as group_c_count,
      SUM(paid) as paid_count
    FROM tournament_signup
  `;
  
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    
    const stats = results[0];
    const tournamentDate = getNextTournamentDate();
    
    res.json({
      tournament_date: tournamentDate,
      registration_deadline: new Date(tournamentDate.getTime() - 7 * 24 * 60 * 60 * 1000), // 提前一周截止
      ...stats
    });
  });
});

// 获取下个月赛日期（每月第四个星期天）
function getNextTournamentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  // 找到当月第一天是星期几
  const firstDay = new Date(year, month, 1);
  const firstSunday = 7 - firstDay.getDay(); // 第一个星期天的日期
  
  // 第四个星期天
  const fourthSunday = firstSunday + 21;
  const tournamentDate = new Date(year, month, fourthSunday);
  
  // 如果已过期，则返回下月的
  if (tournamentDate < now) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const nextFirstDay = new Date(nextYear, nextMonth, 1);
    const nextFirstSunday = 7 - nextFirstDay.getDay();
    return new Date(nextYear, nextMonth, nextFirstSunday + 21);
  }
  
  return tournamentDate;
}

// 月赛报名
app.post('/api/tournament/signup', (req, res) => {
  const { user_id, group_level } = req.body;
  if (!user_id || !group_level || !['A', 'B', 'C'].includes(group_level)) {
    return res.status(400).json({ error: '参数无效' });
  }
  
  // 检查是否已报名
  db.query('SELECT * FROM tournament_signup WHERE user_id = ?', [user_id], (err, existing) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (existing.length > 0) return res.status(400).json({ error: '已经报名过月赛' });
    
    // 检查账户余额
    db.query('SELECT balance FROM account WHERE user_id = ?', [user_id], (err, accounts) => {
      if (err) return res.status(500).json({ error: '查询账户失败' });
      if (accounts.length === 0) return res.status(404).json({ error: '账户不存在' });
      
      const balance = accounts[0].balance;
      const fee = 30; // 报名费30元
      
      if (balance < fee) {
        return res.status(400).json({ error: '账户余额不足，请先充值' });
      }
      
      // 扣除报名费
      db.query('UPDATE account SET balance = balance - ? WHERE user_id = ?', [fee, user_id], (err) => {
        if (err) return res.status(500).json({ error: '扣费失败' });
        
        // 记录交易
        db.query('INSERT INTO `transaction` (user_id, amount, type) VALUES (?, ?, ?)', 
          [user_id, -fee, 'tournament_fee'], (err) => {
          if (err) console.error('记录交易失败:', err);
        });
        
        // 插入报名记录
        db.query('INSERT INTO tournament_signup (user_id, group_level, paid) VALUES (?, ?, 1)', 
          [user_id, group_level], (err) => {
          if (err) return res.status(500).json({ error: '报名失败' });
          
          sendMessage(user_id, '月赛报名成功', `您已成功报名${group_level}组月赛，报名费30元已从账户扣除`);
          logAudit('tournament_signup', user_id, { group_level, fee });
          
          res.json({ success: true });
        });
      });
    });
  });
});

// 获取月赛参赛者列表
app.get('/api/tournament/participants', (req, res) => {
  const { group_level } = req.query;
  
  let sql = `
    SELECT ts.*, u.real_name, u.username
    FROM tournament_signup ts
    JOIN user u ON ts.user_id = u.id
    WHERE ts.paid = 1
  `;
  const params = [];
  
  if (group_level) {
    sql += ' AND ts.group_level = ?';
    params.push(group_level);
  }
  
  sql += ' ORDER BY ts.group_level, ts.created_at';
  
  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(results);
  });
});

// 生成比赛对阵表
app.post('/api/tournament/generate-matches', (req, res) => {
  const { group_level } = req.body;
  if (!group_level || !['A', 'B', 'C'].includes(group_level)) {
    return res.status(400).json({ error: '组别无效' });
  }
  
  // 获取该组参赛者
  db.query('SELECT * FROM tournament_signup WHERE group_level = ? AND paid = 1', [group_level], (err, participants) => {
    if (err) return res.status(500).json({ error: '查询参赛者失败' });
    
    const count = participants.length;
    if (count < 2) return res.status(400).json({ error: '参赛人数不足' });
    if (count > 6) {
      return res.status(400).json({ error: '>6人请分组后再编排，本实现当前仅支持最多6人组内循环' });
    }
    // 使用圆桌算法生成分轮次赛程；奇数人数引入轮空
    const origN = participants.length;
    let hasBye = false;
    if (participants.length % 2 === 1) { participants = [...participants, 0]; hasBye = true; }
    const n = participants.length; // 偶数
    const rounds = n - 1;
    const left = participants.slice(0, n/2);
    const right = participants.slice(n/2).reverse();
    const roundsMatches = [];
    for (let r=0; r<rounds; r++){
      const matches = [];
      for (let i=0;i<n/2;i++){
        const a = left[i];
        const b = right[i];
        if (a!==0 && b!==0) matches.push([a,b]);
      }
      roundsMatches.push(matches);
      // 旋转
      const fixed = left[0];
      const movedFromLeft = left.pop();
      left.splice(1,0,right.shift());
      right.push(movedFromLeft);
    }
    // 清理旧赛程并写入，带 round_no
    db.query(`DELETE FROM tournament_schedule WHERE group_level=?`, [group_level], ()=>{
      const values = [];
      for (let r=0; r<roundsMatches.length; r++){
        for (const [p1, p2] of roundsMatches[r]){
          values.push([group_level, r+1, p1, p2, null, null]);
        }
      }
      if (values.length===0) return res.json({ success: true, created: 0 });
      db.query(`INSERT INTO tournament_schedule (group_level, round_no, player1_id, player2_id, table_id, match_time) VALUES ?`, [values], (e2)=>{
        if (e2) return res.status(500).json({ error: '生成失败' });
        logAudit('tournament_schedule_generate', null, { group_level, count: values.length, players: origN });
        res.json({ success: true, created: values.length });
      });
    });
  });
});

// 软件授权系统

// 获取软件授权信息
app.get('/api/license/info', (req, res) => {
  db.query('SELECT * FROM software_license ORDER BY created_at DESC LIMIT 1', (err, licenses) => {
    if (err) return res.status(500).json({ error: '查询授权信息失败' });
    
    if (licenses.length === 0) {
      return res.json({ 
        status: 'unlicensed',
        message: '软件未授权，请联系管理员购买授权'
      });
    }
    
    const license = licenses[0];
    const now = new Date();
    const expireDate = new Date(license.expire_date);
    const daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
    
    if (now > expireDate) {
      return res.json({
        status: 'expired',
        expire_date: license.expire_date,
        message: '软件授权已过期，请续费'
      });
    }
    
    res.json({
      status: 'active',
      license_key: license.license_key,
      expire_date: license.expire_date,
      days_left: daysLeft,
      max_users: license.max_users,
      current_users: 0, // 实际应该查询当前活跃用户数
      message: daysLeft <= 30 ? `授权将在${daysLeft}天后过期，请及时续费` : '授权正常'
    });
  });
});

// 激活软件授权
app.post('/api/license/activate', (req, res) => {
  const { license_key, device_id } = req.body;
  if (!license_key || !device_id) {
    return res.status(400).json({ error: '授权码和设备ID不能为空' });
  }
  
  // 验证授权码格式（示例：TTM-2025-XXXX-YYYY）
  const keyPattern = /^TTM-2025-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  if (!keyPattern.test(license_key)) {
    return res.status(400).json({ error: '授权码格式无效' });
  }
  
  // 检查是否已有有效授权
  db.query('SELECT * FROM software_license WHERE expire_date > NOW() ORDER BY expire_date DESC LIMIT 1', 
    (err, existing) => {
    if (err) return res.status(500).json({ error: '查询授权失败' });
    
    if (existing.length > 0) {
      return res.status(400).json({ 
        error: '已有有效授权',
        current_license: existing[0]
      });
    }
    
    // 生成授权信息
    const expireDate = new Date();
    expireDate.setFullYear(expireDate.getFullYear() + 1); // 一年有效期
    
    const licenseData = {
      license_key,
      device_id,
      expire_date: expireDate,
      max_users: 500, // 默认最大用户数
      status: 'active'
    };
    
    db.query('INSERT INTO software_license SET ?', licenseData, (err, result) => {
      if (err) return res.status(500).json({ error: '激活授权失败' });
      
      logAudit('license_activate', null, { license_key, device_id });
      
      res.json({
        success: true,
        message: '软件授权激活成功',
        expire_date: expireDate,
        max_users: licenseData.max_users
      });
    });
  });
});

// 续费授权
app.post('/api/license/renew', (req, res) => {
  const { payment_amount } = req.body;
  const annualFee = 500; // 年费500元
  
  if (payment_amount !== annualFee) {
    return res.status(400).json({ error: `授权年费为${annualFee}元` });
  }
  
  db.query('SELECT * FROM software_license ORDER BY created_at DESC LIMIT 1', (err, licenses) => {
    if (err) return res.status(500).json({ error: '查询授权失败' });
    
    let newExpireDate;
    if (licenses.length > 0) {
      const currentExpire = new Date(licenses[0].expire_date);
      const now = new Date();
      // 从当前过期时间或现在（取较晚者）开始续费一年
      newExpireDate = new Date(Math.max(currentExpire, now));
      newExpireDate.setFullYear(newExpireDate.getFullYear() + 1);
    } else {
      newExpireDate = new Date();
      newExpireDate.setFullYear(newExpireDate.getFullYear() + 1);
    }
    
    const renewData = {
      license_key: `TTM-2025-${Math.random().toString(36).substr(2, 4).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
      device_id: licenses.length > 0 ? licenses[0].device_id : 'SYSTEM',
      expire_date: newExpireDate,
      max_users: 500,
      status: 'active'
    };
    
    db.query('INSERT INTO software_license SET ?', renewData, (err) => {
      if (err) return res.status(500).json({ error: '续费失败' });
      
      logAudit('license_renew', null, { payment_amount, new_expire_date: newExpireDate });
      
      res.json({
        success: true,
        message: '授权续费成功',
        new_expire_date: newExpireDate,
        license_key: renewData.license_key
      });
    });
  });
});

// ==================== 月赛管理 API ====================

// 创建月赛表结构（如果不存在）
function ensureTournamentTables() {
  const createTournamentTable = `
    CREATE TABLE IF NOT EXISTS tournament (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      campus_id INT NOT NULL,
      group_category ENUM('甲','乙','丙') NOT NULL,
      tournament_date DATE NOT NULL,
      registration_deadline DATE NOT NULL,
      registration_fee DECIMAL(10,2) DEFAULT 30.00,
      description TEXT,
      status ENUM('registration','scheduled','in_progress','completed','cancelled') DEFAULT 'registration',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campus_id) REFERENCES campus(id)
    )
  `;
  
  const createRegistrationTable = `
    CREATE TABLE IF NOT EXISTS tournament_registration (
      id INT PRIMARY KEY AUTO_INCREMENT,
      tournament_id INT NOT NULL,
      student_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_registration (tournament_id, student_id),
      FOREIGN KEY (tournament_id) REFERENCES tournament(id),
      FOREIGN KEY (student_id) REFERENCES user(id)
    )
  `;
  
  const createMatchTable = `
    CREATE TABLE IF NOT EXISTS tournament_match (
      id INT PRIMARY KEY AUTO_INCREMENT,
      tournament_id INT NOT NULL,
      round_number INT NOT NULL,
      match_number INT NOT NULL,
      player1_id INT,
      player2_id INT,
      table_id INT,
      match_time DATETIME,
      score_player1 INT DEFAULT 0,
      score_player2 INT DEFAULT 0,
      winner_id INT,
      status ENUM('scheduled','in_progress','completed','cancelled') DEFAULT 'scheduled',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tournament_id) REFERENCES tournament(id),
      FOREIGN KEY (player1_id) REFERENCES user(id),
      FOREIGN KEY (player2_id) REFERENCES user(id),
      FOREIGN KEY (table_id) REFERENCES table_court(id),
      FOREIGN KEY (winner_id) REFERENCES user(id)
    )
  `;
  
  db.query(createTournamentTable, (err) => {
    if (err) console.error('创建tournament表失败:', err);
  });
  
  db.query(createRegistrationTable, (err) => {
    if (err) console.error('创建tournament_registration表失败:', err);
  });
  
  db.query(createMatchTable, (err) => {
    if (err) console.error('创建tournament_match表失败:', err);
  });
}

// 初始化月赛表
ensureTournamentTables();

// 获取月赛列表
app.get('/api/admin/tournaments', (req, res) => {
  const { campus_id, status, group, month } = req.query;
  let where = ['t.campus_id=?'];
  let params = [campus_id];
  
  if (status) { where.push('t.status=?'); params.push(status); }
  if (group) { where.push('t.group_category=?'); params.push(group); }
  if (month) {
    where.push('DATE_FORMAT(t.tournament_date, "%Y-%m")=?');
    params.push(month);
  }
  
  const sql = `
    SELECT t.*, COUNT(tr.id) as registration_count
    FROM tournament t
    LEFT JOIN tournament_registration tr ON t.id = tr.tournament_id
    WHERE ${where.join(' AND ')}
    GROUP BY t.id
    ORDER BY t.tournament_date DESC
  `;
  
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json({ success: true, tournaments: rows });
  });
});

// 获取月赛统计
app.get('/api/admin/tournament-stats', (req, res) => {
  const { campus_id, month } = req.query;
  
  const queries = [
    // 本月赛事数
    `SELECT COUNT(*) as current_month FROM tournament WHERE campus_id=? AND DATE_FORMAT(tournament_date, "%Y-%m")=?`,
    // 总报名人数
    `SELECT COUNT(*) as total_registrations FROM tournament_registration tr 
     JOIN tournament t ON tr.tournament_id=t.id WHERE t.campus_id=?`,
    // 进行中的赛事
    `SELECT COUNT(*) as active FROM tournament WHERE campus_id=? AND status IN ('registration','scheduled','in_progress')`,
    // 已完成的赛事
    `SELECT COUNT(*) as completed FROM tournament WHERE campus_id=? AND status='completed'`
  ];
  
  Promise.all([
    new Promise((resolve, reject) => db.query(queries[0], [campus_id, month], (err, rows) => err ? reject(err) : resolve(rows[0]))),
    new Promise((resolve, reject) => db.query(queries[1], [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0]))),
    new Promise((resolve, reject) => db.query(queries[2], [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0]))),
    new Promise((resolve, reject) => db.query(queries[3], [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0])))
  ]).then(results => {
    const stats = {
      current_month: results[0].current_month,
      total_registrations: results[1].total_registrations,
      active: results[2].active,
      completed: results[3].completed
    };
    res.json({ success: true, stats });
  }).catch(err => {
    res.status(500).json({ error: '统计查询失败' });
  });
});

// 创建月赛
app.post('/api/admin/tournament', (req, res) => {
  const { name, group_category, tournament_date, registration_deadline, registration_fee, description, campus_id } = req.body;
  
  if (!name || !group_category || !tournament_date || !registration_deadline || !campus_id) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  
  // 检查同组别是否已有同月赛事
  const checkSql = `SELECT id FROM tournament WHERE campus_id=? AND group_category=? 
                   AND DATE_FORMAT(tournament_date, "%Y-%m") = DATE_FORMAT(?, "%Y-%m")
                   AND status != 'cancelled'`;
  
  db.query(checkSql, [campus_id, group_category, tournament_date], (err, existing) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (existing.length > 0) {
      return res.status(400).json({ error: '该组别本月已有赛事' });
    }
    
    const sql = `INSERT INTO tournament (name, campus_id, group_category, tournament_date, 
                 registration_deadline, registration_fee, description) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    
    db.query(sql, [name, campus_id, group_category, tournament_date, registration_deadline, 
                   registration_fee || 30, description], (err, result) => {
      if (err) return res.status(500).json({ error: '创建失败' });
      
      logAudit('tournament_create', null, { tournament_id: result.insertId, name, group_category });
      res.json({ success: true, tournament_id: result.insertId });
    });
  });
});

// 获取月赛详情
app.get('/api/admin/tournament/:id', (req, res) => {
  const { id } = req.params;
  
  // 获取赛事信息
  const tournamentSql = 'SELECT * FROM tournament WHERE id=?';
  
  // 获取报名信息
  const registrationSql = `
    SELECT tr.*, u.real_name as student_name, u.gender, u.age
    FROM tournament_registration tr
    JOIN user u ON tr.student_id = u.id
    WHERE tr.tournament_id = ?
    ORDER BY tr.created_at
  `;
  
  db.query(tournamentSql, [id], (err, tournaments) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (tournaments.length === 0) return res.status(404).json({ error: '赛事不存在' });
    
    db.query(registrationSql, [id], (err, registrations) => {
      if (err) return res.status(500).json({ error: '查询报名信息失败' });
      
      res.json({ 
        success: true, 
        tournament: tournaments[0], 
        registrations 
      });
    });
  });
});

// 生成赛程
app.post('/api/admin/tournament/:id/schedule', (req, res) => {
  const { id } = req.params;
  
  // 获取参赛选手
  const sql = `
    SELECT tr.student_id, u.real_name as player_name
    FROM tournament_registration tr
    JOIN user u ON tr.student_id = u.id
    WHERE tr.tournament_id = ?
    ORDER BY tr.created_at
  `;
  
  db.query(sql, [id], (err, players) => {
    if (err) return res.status(500).json({ error: '查询参赛选手失败' });
    if (players.length === 0) return res.status(400).json({ error: '没有参赛选手' });
    
    // 生成循环赛程
    const schedule = generateRoundRobinSchedule(players);
    
    res.json({ success: true, schedule });
  });
});

// 生成循环赛制函数
function generateRoundRobinSchedule(players) {
  const playerCount = players.length;
  const rounds = [];
  
  if (playerCount <= 1) return { rounds: [] };
  
  // 如果是奇数，添加一个"轮空"选手
  let playersWithBye = [...players];
  if (playerCount % 2 === 1) {
    playersWithBye.push({ student_id: null, player_name: '轮空' });
  }
  
  const totalPlayers = playersWithBye.length;
  const roundCount = totalPlayers - 1;
  
  for (let round = 0; round < roundCount; round++) {
    const matches = [];
    
    for (let match = 0; match < totalPlayers / 2; match++) {
      const home = (round + match) % (totalPlayers - 1);
      const away = (totalPlayers - 1 - match + round) % (totalPlayers - 1);
      
      // 最后一个位置固定
      if (match === 0) {
        const player1 = playersWithBye[totalPlayers - 1];
        const player2 = playersWithBye[away];
        
        if (player1.student_id && player2.student_id) {
          matches.push({
            player1_id: player1.student_id,
            player1_name: player1.player_name,
            player2_id: player2.student_id,
            player2_name: player2.player_name,
            table_code: null
          });
        }
      } else {
        const player1 = playersWithBye[home];
        const player2 = playersWithBye[away];
        
        if (player1.student_id && player2.student_id) {
          matches.push({
            player1_id: player1.student_id,
            player1_name: player1.player_name,
            player2_id: player2.student_id,
            player2_name: player2.player_name,
            table_code: null
          });
        }
      }
    }
    
    if (matches.length > 0) {
      rounds.push({ round_number: round + 1, matches });
    }
  }
  
  return { rounds };
}

// 确认并保存赛程
app.post('/api/admin/tournament/:id/confirm-schedule', (req, res) => {
  const { id } = req.params;
  
  // 更新赛事状态为已安排
  db.query('UPDATE tournament SET status="scheduled" WHERE id=?', [id], (err, result) => {
    if (err) return res.status(500).json({ error: '更新状态失败' });
    
    logAudit('tournament_schedule_confirmed', null, { tournament_id: id });
    res.json({ success: true });
  });
});

// 开始比赛
app.post('/api/admin/tournament/:id/start', (req, res) => {
  const { id } = req.params;
  
  db.query('UPDATE tournament SET status="in_progress" WHERE id=?', [id], (err, result) => {
    if (err) return res.status(500).json({ error: '开始比赛失败' });
    
    logAudit('tournament_started', null, { tournament_id: id });
    res.json({ success: true });
  });
});

// 取消月赛
app.post('/api/admin/tournament/:id/cancel', (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  
  if (!reason) return res.status(400).json({ error: '请提供取消原因' });
  
  // 获取赛事和报名信息
  const sql = `
    SELECT t.*, tr.student_id, t.registration_fee
    FROM tournament t
    LEFT JOIN tournament_registration tr ON t.id = tr.tournament_id
    WHERE t.id = ?
  `;
  
  db.query(sql, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (rows.length === 0) return res.status(404).json({ error: '赛事不存在' });
    
    const tournament = rows[0];
    const registrations = rows.filter(row => row.student_id);
    
    db.beginTransaction((err) => {
      if (err) return res.status(500).json({ error: '事务开始失败' });
      
      // 更新赛事状态
      db.query('UPDATE tournament SET status="cancelled" WHERE id=?', [id], (err) => {
        if (err) {
          return db.rollback(() => {
            res.status(500).json({ error: '取消失败' });
          });
        }
        
        // 退还报名费
        if (registrations.length > 0 && tournament.registration_fee > 0) {
          const refundPromises = registrations.map(reg => {
            return new Promise((resolve, reject) => {
              // 更新账户余额
              db.query('UPDATE account SET balance = balance + ? WHERE user_id = ?', 
                      [tournament.registration_fee, reg.student_id], (err) => {
                if (err) return reject(err);
                
                // 记录退款交易
                db.query(`INSERT INTO \`transaction\` (user_id, amount, type, description) 
                         VALUES (?, ?, 'refund', ?)`,
                        [reg.student_id, tournament.registration_fee, `月赛取消退款：${tournament.name}`], (err) => {
                  if (err) console.error('退款记录失败:', err);
                  
                  // 发送通知
                  db.query(`INSERT INTO message (recipient_id, title, content) 
                           VALUES (?, '月赛取消通知', ?)`,
                          [reg.student_id, `月赛"${tournament.name}"已取消。取消原因：${reason}。报名费已退回您的账户。`], (err) => {
                    if (err) console.error('通知发送失败:', err);
                    resolve();
                  });
                });
              });
            });
          });
          
          Promise.all(refundPromises).then(() => {
            db.commit((err) => {
              if (err) {
                return db.rollback(() => {
                  res.status(500).json({ error: '提交事务失败' });
                });
              }
              
              logAudit('tournament_cancelled', null, { tournament_id: id, reason });
              res.json({ success: true });
            });
          }).catch(err => {
            db.rollback(() => {
              res.status(500).json({ error: '退款处理失败' });
            });
          });
        } else {
          db.commit((err) => {
            if (err) {
              return db.rollback(() => {
                res.status(500).json({ error: '提交事务失败' });
              });
            }
            
            logAudit('tournament_cancelled', null, { tournament_id: id, reason });
            res.json({ success: true });
          });
        }
      });
    });
  });
});

// ==================== 统计报表 API ====================

// 总览统计
app.get('/api/admin/statistics/overview', (req, res) => {
  const { campus_id } = req.query;
  
  const queries = {
    total_users: 'SELECT COUNT(*) as count FROM user WHERE campus_id=?',
    students: 'SELECT COUNT(*) as count FROM user WHERE campus_id=? AND role="student"',
    coaches: 'SELECT COUNT(*) as count FROM user WHERE campus_id=? AND role="coach"',
    total_reservations: 'SELECT COUNT(*) as count FROM reservation WHERE campus_id=?',
    monthly_reservations: 'SELECT COUNT(*) as count FROM reservation WHERE campus_id=? AND DATE_FORMAT(created_at, "%Y-%m")=DATE_FORMAT(NOW(), "%Y-%m")',
    coach_levels: `SELECT coach_level, COUNT(*) as count FROM user WHERE campus_id=? AND role="coach" AND coach_level IS NOT NULL GROUP BY coach_level`
  };
  
  Promise.all([
    new Promise((resolve, reject) => db.query(queries.total_users, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0].count))),
    new Promise((resolve, reject) => db.query(queries.students, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0].count))),
    new Promise((resolve, reject) => db.query(queries.coaches, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0].count))),
    new Promise((resolve, reject) => db.query(queries.total_reservations, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0].count))),
    new Promise((resolve, reject) => db.query(queries.monthly_reservations, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0].count))),
    new Promise((resolve, reject) => db.query(queries.coach_levels, [campus_id], (err, rows) => err ? reject(err) : resolve(rows)))
  ]).then(results => {
    const data = {
      total_users: results[0],
      students: results[1],
      coaches: results[2],
      total_reservations: results[3],
      monthly_reservations: results[4],
      coach_levels: {
        labels: results[5].map(row => row.coach_level),
        values: results[5].map(row => row.count)
      }
    };
    
    res.json({ success: true, data });
  }).catch(err => {
    console.error('统计查询失败:', err);
    res.status(500).json({ error: '统计查询失败' });
  });
});

// 月度报表
app.get('/api/admin/statistics/monthly', (req, res) => {
  const { campus_id, month } = req.query;
  
  const yearMonth = month || new Date().toISOString().slice(0, 7);
  
  const queries = {
    reservations: `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled,
        AVG(duration) as avg_duration
      FROM reservation 
      WHERE campus_id=? AND DATE_FORMAT(start_time, "%Y-%m")=?
    `,
    daily_distribution: `
      SELECT 
        DAY(start_time) as day,
        COUNT(*) as count
      FROM reservation 
      WHERE campus_id=? AND DATE_FORMAT(start_time, "%Y-%m")=?
      GROUP BY DAY(start_time)
      ORDER BY day
    `
  };
  
  Promise.all([
    new Promise((resolve, reject) => db.query(queries.reservations, [campus_id, yearMonth], (err, rows) => err ? reject(err) : resolve(rows[0]))),
    new Promise((resolve, reject) => db.query(queries.daily_distribution, [campus_id, yearMonth], (err, rows) => err ? reject(err) : resolve(rows)))
  ]).then(results => {
    const reservationStats = results[0];
    const dailyData = results[1];
    
    const data = {
      reservations: {
        total: reservationStats.total || 0,
        completed: reservationStats.completed || 0,
        cancel_rate: reservationStats.total > 0 ? Math.round((reservationStats.cancelled || 0) / reservationStats.total * 100) : 0,
        avg_duration: Math.round((reservationStats.avg_duration || 0) * 10) / 10
      },
      daily_distribution: {
        labels: dailyData.map(row => `${yearMonth}-${String(row.day).padStart(2, '0')}`),
        values: dailyData.map(row => row.count)
      }
    };
    
    res.json({ success: true, data });
  }).catch(err => {
    console.error('月度统计查询失败:', err);
    res.status(500).json({ error: '月度统计查询失败' });
  });
});

// 用户统计
app.get('/api/admin/statistics/user', (req, res) => {
  const { campus_id } = req.query;
  
  const queries = {
    user_distribution: `
      SELECT role, COUNT(*) as count 
      FROM user 
      WHERE campus_id=? AND role IN ('student', 'coach')
      GROUP BY role
    `,
    registration_trend: `
      SELECT 
        DATE_FORMAT(created_at, "%Y-%m") as month,
        COUNT(*) as count
      FROM user 
      WHERE campus_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(created_at, "%Y-%m")
      ORDER BY month
    `
  };
  
  Promise.all([
    new Promise((resolve, reject) => db.query(queries.user_distribution, [campus_id], (err, rows) => err ? reject(err) : resolve(rows))),
    new Promise((resolve, reject) => db.query(queries.registration_trend, [campus_id], (err, rows) => err ? reject(err) : resolve(rows)))
  ]).then(results => {
    const userDist = results[0];
    const regTrend = results[1];
    
    const data = {
      user_distribution: {
        labels: userDist.map(row => row.role === 'student' ? '学员' : '教练'),
        values: userDist.map(row => row.count)
      },
      registration_trend: {
        labels: regTrend.map(row => row.month),
        values: regTrend.map(row => row.count)
      },
      students: {
        total: userDist.find(row => row.role === 'student')?.count || 0
      },
      coaches: {
        total: userDist.find(row => row.role === 'coach')?.count || 0
      }
    };
    
    res.json({ success: true, data });
  }).catch(err => {
    console.error('用户统计查询失败:', err);
    res.status(500).json({ error: '用户统计查询失败' });
  });
});

// 预约统计
app.get('/api/admin/statistics/reservation', (req, res) => {
  const { campus_id } = req.query;
  
  const queries = {
    overview: `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled,
        AVG(duration) as avg_duration
      FROM reservation 
      WHERE campus_id=?
    `,
    status_distribution: `
      SELECT status, COUNT(*) as count
      FROM reservation 
      WHERE campus_id=?
      GROUP BY status
    `,
    popular_times: `
      SELECT 
        HOUR(start_time) as hour,
        COUNT(*) as count
      FROM reservation 
      WHERE campus_id=?
      GROUP BY HOUR(start_time)
      ORDER BY hour
    `
  };
  
  Promise.all([
    new Promise((resolve, reject) => db.query(queries.overview, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0]))),
    new Promise((resolve, reject) => db.query(queries.status_distribution, [campus_id], (err, rows) => err ? reject(err) : resolve(rows))),
    new Promise((resolve, reject) => db.query(queries.popular_times, [campus_id], (err, rows) => err ? reject(err) : resolve(rows)))
  ]).then(results => {
    const overview = results[0];
    const statusDist = results[1];
    const popularTimes = results[2];
    
    const data = {
      total: overview.total || 0,
      completed: overview.completed || 0,
      cancel_rate: overview.total > 0 ? Math.round((overview.cancelled || 0) / overview.total * 100) : 0,
      avg_duration: Math.round((overview.avg_duration || 0) * 10) / 10,
      status_distribution: {
        labels: statusDist.map(row => getStatusText(row.status)),
        values: statusDist.map(row => row.count)
      },
      popular_times: {
        labels: popularTimes.map(row => `${row.hour}:00`),
        values: popularTimes.map(row => row.count)
      }
    };
    
    res.json({ success: true, data });
  }).catch(err => {
    console.error('预约统计查询失败:', err);
    res.status(500).json({ error: '预约统计查询失败' });
  });
});

// 财务统计
app.get('/api/admin/statistics/financial', (req, res) => {
  const { campus_id } = req.query;
  
  const queries = {
    lesson_revenue: `
      SELECT SUM(fee) as revenue
      FROM reservation 
      WHERE campus_id=? AND status='completed'
    `,
    tournament_revenue: `
      SELECT SUM(t.registration_fee * subq.reg_count) as revenue
      FROM tournament t
      JOIN (
        SELECT tournament_id, COUNT(*) as reg_count
        FROM tournament_registration
        GROUP BY tournament_id
      ) subq ON t.id = subq.tournament_id
      WHERE t.campus_id=?
    `,
    recharge_amount: `
      SELECT SUM(amount) as total
      FROM \`transaction\` tr
      JOIN user u ON tr.user_id = u.id
      WHERE u.campus_id=? AND tr.type='recharge'
    `
  };
  
  Promise.all([
    new Promise((resolve, reject) => db.query(queries.lesson_revenue, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0]?.revenue || 0))),
    new Promise((resolve, reject) => db.query(queries.tournament_revenue, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0]?.revenue || 0))),
    new Promise((resolve, reject) => db.query(queries.recharge_amount, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0]?.total || 0)))
  ]).then(results => {
    const lessonRevenue = results[0];
    const tournamentRevenue = results[1];
    const rechargeAmount = results[2];
    
    const data = {
      lesson_revenue: lessonRevenue,
      tournament_revenue: tournamentRevenue,
      recharge_amount: rechargeAmount,
      total_revenue: lessonRevenue + tournamentRevenue,
      revenue_sources: {
        labels: ['课时费', '月赛报名费'],
        values: [lessonRevenue, tournamentRevenue]
      }
    };
    
    res.json({ success: true, data });
  }).catch(err => {
    console.error('财务统计查询失败:', err);
    res.status(500).json({ error: '财务统计查询失败' });
  });
});

// 月赛统计
app.get('/api/admin/statistics/tournament', (req, res) => {
  const { campus_id } = req.query;
  
  const queries = {
    overview: `
      SELECT 
        COUNT(*) as total_tournaments,
        SUM(subq.reg_count) as total_participants,
        AVG(subq.reg_count) as avg_participants,
        SUM(t.registration_fee * subq.reg_count) as registration_revenue
      FROM tournament t
      LEFT JOIN (
        SELECT tournament_id, COUNT(*) as reg_count
        FROM tournament_registration
        GROUP BY tournament_id
      ) subq ON t.id = subq.tournament_id
      WHERE t.campus_id=?
    `,
    group_participation: `
      SELECT 
        t.group_category,
        COUNT(tr.id) as participants
      FROM tournament t
      LEFT JOIN tournament_registration tr ON t.id = tr.tournament_id
      WHERE t.campus_id=?
      GROUP BY t.group_category
    `
  };
  
  Promise.all([
    new Promise((resolve, reject) => db.query(queries.overview, [campus_id], (err, rows) => err ? reject(err) : resolve(rows[0]))),
    new Promise((resolve, reject) => db.query(queries.group_participation, [campus_id], (err, rows) => err ? reject(err) : resolve(rows)))
  ]).then(results => {
    const overview = results[0];
    const groupData = results[1];
    
    const data = {
      total_tournaments: overview.total_tournaments || 0,
      total_participants: overview.total_participants || 0,
      avg_participants: Math.round((overview.avg_participants || 0) * 10) / 10,
      registration_revenue: overview.registration_revenue || 0,
      group_participation: {
        labels: groupData.map(row => `${row.group_category}组`),
        values: groupData.map(row => row.participants || 0)
      }
    };
    
    res.json({ success: true, data });
  }).catch(err => {
    console.error('月赛统计查询失败:', err);
    res.status(500).json({ error: '月赛统计查询失败' });
  });
});

function getStatusText(status) {
  const statusMap = {
    'pending': '待确认',
    'confirmed': '已确认',
    'completed': '已完成',
    'cancelled': '已取消',
    'rejected': '已拒绝'
  };
  return statusMap[status] || status;
}

// ==================== 超级管理员 API ====================

// 获取校区列表
app.get('/api/campuses', (req, res) => {
  const sql = `
    SELECT c.*, COUNT(u.id) as user_count 
    FROM campus c 
    LEFT JOIN user u ON c.id = u.campus_id 
    GROUP BY c.id 
    ORDER BY c.id
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(results);
  });
});

// 添加校区
app.post('/api/campuses', (req, res) => {
  const { name, address, contact_name, contact_phone, contact_email } = req.body;
  if (!name) return res.status(400).json({ error: '校区名称不能为空' });
  
  const sql = 'INSERT INTO campus (name, address, contact_name, contact_phone, contact_email) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [name, address, contact_name, contact_phone, contact_email], (err, result) => {
    if (err) return res.status(500).json({ error: '添加失败' });
    res.json({ success: true, campus_id: result.insertId });
  });
});

// 超级管理员统计数据
app.get('/api/super-admin/statistics', (req, res) => {
  console.log('超级管理员统计数据API被调用');
  
  const queries = {
    total_campuses: 'SELECT COUNT(*) as count FROM campus',
    total_users: 'SELECT COUNT(*) as count FROM user',
    total_coaches: 'SELECT COUNT(*) as count FROM user WHERE role="coach"',
    total_students: 'SELECT COUNT(*) as count FROM user WHERE role="student"',
    campus_distribution: `
      SELECT c.name as campus_name, COUNT(u.id) as user_count 
      FROM campus c 
      LEFT JOIN user u ON c.id = u.campus_id 
      GROUP BY c.id, c.name 
      ORDER BY c.id
    `
  };
  
  // 确保查询返回有效数据
  const handleQuery = (query, defaultValue) => {
    return new Promise((resolve, reject) => {
      db.query(query, (err, rows) => {
        if (err) {
          console.error('查询执行错误:', err);
          return reject(err);
        }
        
        console.log('查询结果:', query.substring(0, 50) + '...', rows);
        
        if (!rows || rows.length === 0) {
          console.log('查询无数据，返回默认值:', defaultValue);
          return resolve(defaultValue);
        }
        
        if (query.includes('COUNT(*)')) {
          const count = rows[0]?.count || 0;
          console.log('统计查询结果:', count);
          resolve(count);
        } else {
          resolve(rows);
        }
      });
    });
  };
  
  Promise.all([
    handleQuery(queries.total_campuses, 0),
    handleQuery(queries.total_users, 0),
    handleQuery(queries.total_coaches, 0),
    handleQuery(queries.total_students, 0),
    handleQuery(queries.campus_distribution, [])
  ]).then(results => {
    const campusData = results[4];
    console.log('校区分布数据对象:', JSON.stringify(campusData, null, 2));
    
    // 如果没有校区数据，手动创建一个示例数据以显示图表效果
    if (!campusData || campusData.length === 0) {
      console.log('没有校区数据，创建示例数据');
      campusData.push({ campus_name: '示例校区', user_count: 0 });
    }
    
    // 确保所有数据都是正确的格式
    const labels = campusData.map(row => {
      const name = row.campus_name || '未命名校区';
      console.log('校区名称:', name);
      return name;
    });
    
    const values = campusData.map(row => {
      // 确保转换为数字
      const count = parseInt(row.user_count || '0', 10);
      console.log('用户数量:', count);
      return count;
    });
    
    console.log('处理后的标签:', labels);
    console.log('处理后的数值:', values);
    
    const data = {
      total_campuses: results[0],
      total_users: results[1],
      total_coaches: results[2],
      total_students: results[3],
      campus_distribution: {
        labels: labels,
        values: values
      }
    };
    
    console.log('统计响应数据:', JSON.stringify(data, null, 2));
    res.json(data);
  }).catch(err => {
    console.error('统计查询失败:', err);
    res.status(500).json({ 
      error: '统计查询失败', 
      details: err.message,
      code: err.code 
    });
  });
});

// 超级管理员获取所有用户
app.get('/api/super-admin/users', (req, res) => {
  const sql = `
    SELECT u.*, c.name as campus_name 
    FROM user u 
    LEFT JOIN campus c ON u.campus_id = c.id 
    ORDER BY u.created_at DESC
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(results);
  });
});

// ==================== 自动提醒系统 ====================

// 课前1小时提醒
function sendClassReminders() {
  const now = new Date();
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
  
  // 查询1小时内即将开始的课程
  const sql = `
    SELECT r.*, 
           s.real_name as student_name, s.phone as student_phone,
           c.real_name as coach_name, c.phone as coach_phone,
           tc.code as table_code
    FROM reservation r
    JOIN user s ON r.student_id = s.id
    JOIN user c ON r.coach_id = c.id
    LEFT JOIN table_court tc ON r.table_id = tc.id
    WHERE r.status = 'confirmed' 
    AND r.start_time BETWEEN ? AND ?
  `;
  
  db.query(sql, [now, oneHourLater], (err, reservations) => {
    if (err) {
      console.error('查询即将开始的课程失败:', err);
      return;
    }
    
    reservations.forEach(reservation => {
      const startTime = new Date(reservation.start_time);
      const timeStr = startTime.toLocaleString('zh-CN');
      const tableInfo = reservation.table_code ? `球台：${reservation.table_code}` : '球台：待分配';
      
      // 给学员发送提醒
      const studentMessage = `课程提醒：您预约的课程将于${timeStr}开始，教练：${reservation.coach_name}，${tableInfo}，请提前10分钟到达。`;
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '课程提醒', ?)`, 
        [reservation.student_id, studentMessage], (err) => {
          if (err) console.error('发送学员提醒失败:', err);
        });
      
      // 给教练发送提醒
      const coachMessage = `课程提醒：您的课程将于${timeStr}开始，学员：${reservation.student_name}，${tableInfo}，请提前5分钟到达。`;
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '课程提醒', ?)`, 
        [reservation.coach_id, coachMessage], (err) => {
          if (err) console.error('发送教练提醒失败:', err);
        });
      
      // 标记已提醒 (暂时注释掉，避免字段不存在错误)
      // db.query('UPDATE reservation SET reminded = 1 WHERE id = ?', [reservation.id], (updateErr) => {
      //   if (updateErr) {
      //     console.error('更新提醒状态失败:', updateErr);
      //   }
      // });
    });
    
    if (reservations.length > 0) {
      console.log(`发送了${reservations.length}个课程提醒`);
    }
  });
}

// 每30秒检查一次课程提醒
setInterval(sendClassReminders, 30000);

// 检查授权状态中间件
function checkLicense(req, res, next) {
  // 跳过授权相关的API
  if (req.path.startsWith('/api/license/') || req.path === '/api/login') {
    return next();
  }
  
  db.query('SELECT * FROM software_license WHERE expire_date > NOW() ORDER BY expire_date DESC LIMIT 1', 
    (err, licenses) => {
    if (err) {
      console.error('检查授权失败:', err);
      return next(); // 出错时不阻断服务
    }
    
    if (licenses.length === 0) {
      return res.status(403).json({ 
        error: '软件未授权', 
        code: 'LICENSE_REQUIRED'
      });
    }
    
    next();
  });
}

// 应用授权检查（可选择性启用）
// app.use('/api/', checkLicense);

// 启动服务器
const port = process.env.PORT || 3001; // 使用3001端口
app.listen(port, () => {
  console.log(`乒乓球培训管理系统服务已在端口 ${port} 运行`);
});
