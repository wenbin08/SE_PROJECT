class StudentPortal {
  constructor() {
    // 兼容旧逻辑（email）与新登录（user）
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    this.user = user;
    this.email = localStorage.getItem('email');
    if (!this.email && !user) { window.location = '/'; return; }
    this.init();
  }
  async init() {
    await this.loadStudentInfo();
    await this.loadCourses();
    this.setupEventListeners();
  }
  async fetchData(url) {
    try {
      const q = this.email ? `?email=${encodeURIComponent(this.email)}` : '';
      const res = await fetch(`${url}${q}`);
      return await res.json();
    } catch (e) { console.error('请求失败:', e); return null; }
  }
  async loadStudentInfo() {
    const data = await this.fetchData('/api/students');
    if (!data || !Array.isArray(data) || data.length === 0) return;
    const s = data[0];
    document.getElementById('studentName').textContent = s.name;
    document.getElementById('studentInfo').innerHTML = `
      <dt class="col-sm-3">学号</dt><dd class="col-sm-9">${s.student_id}</dd>
      <dt class="col-sm-3">专业</dt><dd class="col-sm-9">${s.major}</dd>
      <dt class="col-sm-3">邮箱</dt><dd class="col-sm-9">${s.email}</dd>
      <dt class="col-sm-3">电话</dt><dd class="col-sm-9">${s.phone || '未填写'}</dd>`;
  }
  async loadCourses() {
    const [available, enrolled] = await Promise.all([
      this.fetchData('/api/courses/available'),
      this.fetchData('/api/courses/enrolled')
    ]);
    this.renderAvailableCourses(available || []);
    this.renderEnrolledCourses(enrolled || []);
  }
  renderAvailableCourses(courses) {
    const c = document.getElementById('availableCourses');
    c.innerHTML = courses.length ? '' : '<div class="col-12">暂无可选课程</div>';
    courses.forEach(course => {
      const card = document.createElement('div');
      card.className = 'col-md-4 mb-4';
      card.innerHTML = `<div class="card course-card h-100"><div class="card-body">
        <h5 class="card-title">${course.course_name}</h5>
        <p class="card-text"><span class="badge badge-primary">${course.credits} 学分</span> ${course.teacher_name ? `<span class="ml-2">教师：${course.teacher_name}</span>` : ''}</p>
        <button class="btn btn-primary btn-sm" data-course-id="${course.course_id}">选课</button>
      </div></div>`;
      c.appendChild(card);
    });
  }
  renderEnrolledCourses(courses) {
    const tbody = document.getElementById('enrolledCourses');
    tbody.innerHTML = courses.length ? '' : '<tr><td colspan="5" class="text-center">暂无课程记录</td></tr>';
    courses.forEach(course => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${course.course_name}</td><td>${course.credits}</td><td>${course.grade || '未出分'}</td><td>${new Date(course.enroll_date).toLocaleDateString()}</td><td><button class="btn btn-danger btn-sm" data-course-id="${course.course_id}">退选</button></td>`;
      tbody.appendChild(tr);
    });
  }
  setupEventListeners() {
    document.body.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.courseId; if (!id) return;
      try {
        if (btn.textContent === '选课') await this.enrollCourse(id);
        else if (btn.textContent === '退选') await this.dropCourse(id);
        await this.loadCourses();
      } catch { alert('操作失败，请稍后重试'); }
    });
  }
  async enrollCourse(courseId) {
    const r = await fetch('/api/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: this.email, courseId }) });
    if (!r.ok) throw new Error('选课失败');
  }
  async dropCourse(courseId) {
    const r = await fetch('/api/drop', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: this.email, courseId }) });
    if (!r.ok) throw new Error('退选失败');
  }
}
const studentPortal = new StudentPortal();
window.logout = function () { localStorage.removeItem('email'); localStorage.removeItem('user'); window.location = '/'; };
window.showEditModal = function () { /* 可根据需要补充 */ };
window.saveStudentInfo = function () { /* 可根据需要补充 */ };
