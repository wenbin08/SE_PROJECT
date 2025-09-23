// server.js - new_se_project 骨架
const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

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
    actor_id INT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`;
  db.query(auditSql, ()=>{});
  // 启动时尝试创建默认账号（可控的幂等写入）
  ensureDefaultUsers();
});

// 审计日志
function logAudit(action, actorId, detailsObj) {
  try {
    const details = detailsObj ? JSON.stringify(detailsObj) : null;
    db.query(`INSERT INTO audit_log (action, actor_id, details) VALUES (?, ?, ?)`, [action, actorId || null, details]);
  } catch(e) { /* 忽略 */ }
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

// 通用：列出校区
app.get('/api/campuses', (req, res) => {
  db.query('SELECT id, name FROM campus', (err, results) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(results);
  });
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
  db.query(sql, [username, password, real_name, gender || '男', age || null, campus_id, phone, email || null], (err) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '用户名已存在' });
      return res.status(500).json({ error: '注册失败' });
    }
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
    if (!results || results.length === 0) return res.status(400).json({ error: '用户不存在' });
    const u = results[0];
    // 直接比较明文密码
    if (password !== u.password_hash) return res.status(400).json({ error: '密码错误' });
    if (u.role === 'coach' && u.status !== 'active') return res.status(403).json({ error: '教练员待审核或已拒绝' });
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
      // 通知教练有新的申请
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '双选申请', '有学员申请与你建立双选关系，请审核')`, [coach_id]);
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
    // 通知学员审批结果
    const msg = approve ? '您的双选申请已通过' : '您的双选申请被拒绝';
    db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '双选结果', ?)`, [student_id, msg]);
    logAudit('coach_select_approve', coach_id, { coach_id, student_id, approve });
    res.json({ success: true });
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
          // 发消息给教练
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '预约申请', '有新的预约申请待确认')`, [coach_id]);
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
  db.query(`INSERT INTO \`transaction\` (user_id, amount, type, description) VALUES (?, ?, 'recharge', ?)`, [user_id, amount, `${method === 'wechat' ? '微信' : method === 'alipay' ? '支付宝' : '线下'}充值`]);
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
  db.query(`INSERT INTO \`transaction\` (user_id, amount, type, ref_id) VALUES (?, ?, 'reservation_fee', ?)`, [r.student_id, -fee, r.id]);
        db.query(`UPDATE reservation SET status='confirmed' WHERE id=?`, [id]);
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '预约确认', '您的预约已被教练确认')`, [r.student_id]);
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
          // 通知对方确认
          const recipient = by==='student'? r.coach_id : r.student_id;
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '取消申请', '对方发起取消申请，需确认')`, [recipient]);
          res.json({ success: true, pending_confirm: true });
        });
      } else {
        // 对方来确认
        if (!confirm) return res.status(400).json({ error: '请携带 confirm=true 进行确认' });
        // 如果已付款（confirmed）则退款
        const finalize = ()=>{
          db.query(`UPDATE reservation SET status='canceled' WHERE id=?`, [id]);
          const recipient = by==='student'? r.coach_id : r.student_id;
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '取消成功', '预约已取消并处理完毕')`, [recipient]);
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
              db.query(`INSERT INTO \`transaction\` (user_id, amount, type, ref_id) VALUES (?, ?, 'refund', ?)`, [r.student_id, fee, r.id]);
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
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '开课提醒', ?)`, [r.student_id, content]);
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '开课提醒', ?)`, [r.coach_id, content]);
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

// 更换教练员功能
app.post('/api/coach/change', (req, res) => {
  const { student_id, old_coach_id, new_coach_id } = req.body;
  if (!student_id || !old_coach_id || !new_coach_id) return res.status(400).json({ error: '缺少参数' });
  
  // 1. 检查当前关系是否存在
  db.query(`SELECT * FROM coach_student WHERE student_id=? AND coach_id=? AND status='approved'`, 
    [student_id, old_coach_id], (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (!rows || rows.length === 0) return res.status(400).json({ error: '当前教练关系不存在' });
    
    // 2. 检查新教练容量
    db.query(`SELECT COUNT(*) AS cnt FROM coach_student WHERE coach_id=? AND status='approved'`, 
      [new_coach_id], (e2, r2) => {
      if (e2) return res.status(500).json({ error: '查询失败' });
      if (r2[0].cnt >= 20) return res.status(400).json({ error: '新教练名额已满' });
      
      // 3. 通知三方：当前教练、新教练、校区管理员
      const msgContent = `学员${student_id}申请从教练${old_coach_id}更换到教练${new_coach_id}`;
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '更换教练申请', ?)`, [old_coach_id, msgContent]);
      db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '更换教练申请', ?)`, [new_coach_id, msgContent]);
      
      // 获取校区管理员
      db.query(`SELECT u.id FROM user u WHERE u.role='campus_admin' AND u.campus_id=(SELECT campus_id FROM user WHERE id=?)`, 
        [student_id], (e3, adminRows) => {
        if (adminRows && adminRows.length > 0) {
          db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '更换教练申请', ?)`, [adminRows[0].id, msgContent]);
        }
        
        logAudit('coach_change_request', student_id, { old_coach_id, new_coach_id });
        res.json({ success: true, message: '更换申请已提交，等待三方确认' });
      });
    });
  });
});

// 管理员审核教练更换
app.post('/api/admin/coach-change/approve', (req, res) => {
  const { student_id, old_coach_id, new_coach_id, approved } = req.body;
  if (!student_id || !old_coach_id || !new_coach_id || approved === undefined) {
    return res.status(400).json({ error: '缺少参数' });
  }
  
  if (approved) {
    // 更新关系
    db.query(`UPDATE coach_student SET status='rejected' WHERE student_id=? AND coach_id=?`, 
      [student_id, old_coach_id], (e1) => {
      if (e1) return res.status(500).json({ error: '更新失败' });
      
      db.query(`INSERT INTO coach_student (student_id, coach_id, status) VALUES (?, ?, 'approved') 
                ON DUPLICATE KEY UPDATE status='approved'`, [student_id, new_coach_id], (e2) => {
        if (e2) return res.status(500).json({ error: '创建新关系失败' });
        
        // 通知所有相关人员
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换成功', '您的教练更换申请已通过')`, [student_id]);
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换通知', '学员已更换到您处')`, [new_coach_id]);
        db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换通知', '学员已离开您的教学')`, [old_coach_id]);
        
        logAudit('coach_change_approved', null, { student_id, old_coach_id, new_coach_id });
        res.json({ success: true });
      });
    });
  } else {
    // 拒绝申请
    db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '教练更换被拒绝', '您的教练更换申请被拒绝')`, [student_id]);
    logAudit('coach_change_rejected', null, { student_id, old_coach_id, new_coach_id });
    res.json({ success: true });
  }
});

// 校区管理员管理用户信息
app.get('/api/admin/users', (req, res) => {
  const { campus_id, role, search } = req.query;
  let where = ['1=1'];
  let params = [];
  
  if (campus_id) { where.push('campus_id=?'); params.push(campus_id); }
  if (role) { where.push('role=?'); params.push(role); }
  if (search) { where.push('(real_name LIKE ? OR phone LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  
  const sql = `SELECT id, username, real_name, gender, age, campus_id, phone, email, role, status, 
               coach_level, hourly_fee, created_at FROM user WHERE ${where.join(' AND ')} ORDER BY id DESC`;
  
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
  });
});

// 校区管理员修改用户信息
app.put('/api/admin/user/:id', (req, res) => {
  const { id } = req.params;
  const { real_name, phone, email, gender, age } = req.body;
  
  if (phone && !validatePhone(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (email && !validateEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  
  const fields = [];
  const params = [];
  if (real_name) { fields.push('real_name=?'); params.push(real_name); }
  if (phone) { fields.push('phone=?'); params.push(phone); }
  if (email) { fields.push('email=?'); params.push(email); }
  if (gender) { fields.push('gender=?'); params.push(gender); }
  if (age) { fields.push('age=?'); params.push(age); }
  
  if (fields.length === 0) return res.status(400).json({ error: '无可更新字段' });
  
  params.push(id);
  const sql = `UPDATE user SET ${fields.join(', ')} WHERE id=?`;
  
  db.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ error: '更新失败' });
    if (result.affectedRows === 0) return res.status(404).json({ error: '用户不存在' });
    
    // 通知用户信息被修改
    db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '个人信息更新', '您的个人信息已被管理员更新')`, [id]);
    
    logAudit('admin_user_update', null, { user_id: id, fields: fields.map(f => f.split('=')[0]) });
    res.json({ success: true });
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
    
    db.query(`INSERT INTO \`transaction\` (user_id, amount, type) VALUES (?, ?, 'recharge')`, [user_id, amount]);
    db.query(`INSERT INTO message (recipient_id, title, content) VALUES (?, '账户充值', CONCAT('管理员为您充值￥', ?))`, [user_id, amount]);
    
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
  const { action, actor_id, from, to, limit = 100 } = req.query;
  let where = ['1=1'];
  let params = [];
  
  if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
  if (actor_id) { where.push('actor_id=?'); params.push(actor_id); }
  if (from) { where.push('created_at>=?'); params.push(from); }
  if (to) { where.push('created_at<=?'); params.push(to); }
  
  const sql = `SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
  params.push(parseInt(limit));
  
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    res.json(rows);
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
    if (e1) return res.status(500).json({ error: '统计失败' });
    stats.users = userStats.reduce((acc, row) => ({ ...acc, [row.role]: row.count }), {});
    
    // 预约统计
    db.query(`SELECT status, COUNT(*) as count FROM reservation r ${whereClause ? `WHERE r.campus_id=${campus_id}` : ''} GROUP BY status`, (e2, resStats) => {
      if (e2) return res.status(500).json({ error: '统计失败' });
      stats.reservations = resStats.reduce((acc, row) => ({ ...acc, [row.status]: row.count }), {});
      
      // 收入统计
      db.query(`SELECT type, SUM(amount) as total FROM \`transaction\` WHERE amount > 0 GROUP BY type`, (e3, revStats) => {
        if (e3) return res.status(500).json({ error: '统计失败' });
        stats.revenue = revStats.reduce((acc, row) => ({ ...acc, [row.type]: row.total }), {});
        
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
      const sql = `INSERT INTO coach_change_requests (student_id, current_coach_id, new_coach_id, reason, status) 
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
          
          // 批量发送消息
          messages.forEach(msg => {
            sendMessage(msg.recipient_id, msg.title, msg.content);
          });
        });
        
        logAudit('coach_change_request', student_id, { old_coach_id, new_coach_id });
        res.json({ success: true, request_id: requestId });
      });
    });
  });
});

// 处理教练更换申请
app.post('/api/coach/change-request/:id/respond', (req, res) => {
  const requestId = req.params.id;
  const { user_id, user_type, approve } = req.body;
  
  if (!user_id || !user_type || approve === undefined) {
    return res.status(400).json({ error: '缺少参数' });
  }
  
  // 获取申请详情
  db.query('SELECT * FROM coach_change_requests WHERE id = ? AND status = "pending"', [requestId], (err, requests) => {
    if (err) return res.status(500).json({ error: '查询失败' });
    if (requests.length === 0) return res.status(404).json({ error: '申请不存在或已处理' });
    
    const request = requests[0];
    const updateField = `${user_type}_approved`;
    
    // 验证用户权限
    if ((user_type === 'current_coach' && request.current_coach_id !== user_id) ||
        (user_type === 'new_coach' && request.new_coach_id !== user_id) ||
        (user_type === 'admin' && !isAdminForStudent(user_id, request.student_id))) {
      return res.status(403).json({ error: '无权限处理此申请' });
    }
    
    // 更新审批状态
    db.query(`UPDATE coach_change_requests SET ${updateField} = ? WHERE id = ?`, [approve, requestId], (err) => {
      if (err) return res.status(500).json({ error: '更新失败' });
      
      if (!approve) {
        // 拒绝申请，直接设为rejected
        db.query('UPDATE coach_change_requests SET status = "rejected" WHERE id = ?', [requestId], (err) => {
          if (err) return res.status(500).json({ error: '更新失败' });
          sendMessage(request.student_id, '教练更换申请被拒绝', `您的教练更换申请已被拒绝`);
          res.json({ success: true });
        });
      } else {
        // 检查是否三方都同意
        db.query('SELECT * FROM coach_change_requests WHERE id = ?', [requestId], (err, updated) => {
          if (err) return res.status(500).json({ error: '查询失败' });
          
          const req = updated[0];
          if (req.current_coach_approved && req.new_coach_approved && req.admin_approved) {
            // 三方都同意，执行更换
            executeCoachChange(request.student_id, request.current_coach_id, request.new_coach_id, requestId, res);
          } else {
            res.json({ success: true, message: '等待其他相关人员确认' });
          }
        });
      }
    });
  });
});

// 执行教练更换
function executeCoachChange(studentId, currentCoachId, newCoachId, requestId, res) {
  // 更新双选关系
  db.query('UPDATE coach_student SET coach_id = ? WHERE student_id = ? AND coach_id = ?', 
    [newCoachId, studentId, currentCoachId], (err) => {
    if (err) return res.status(500).json({ error: '更换失败' });
    
    // 更新申请状态
    db.query('UPDATE coach_change_requests SET status = "approved" WHERE id = ?', [requestId], (err) => {
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
    AND r.reminder_sent = 0
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
      
      // 标记提醒已发送
      db.query('UPDATE reservation SET reminder_sent = 1 WHERE id = ?', [lesson.id], (err) => {
        if (err) console.error('更新提醒状态失败:', err);
      });
      
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
  const annualFee = 5000; // 年费5000元
  
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
const port = process.env.PORT || 3001; // 避免和 old_project 冲突
app.listen(port, () => {
  console.log(`乒乓球培训管理系统服务已在端口 ${port} 运行`);
});
