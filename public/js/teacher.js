class TeacherPortal {
  constructor() {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    this.user = user;
    this.email = localStorage.getItem('email');
    if (!this.email && !user) { window.location = '/'; return; }
    document.addEventListener('DOMContentLoaded', () => this.init());
  }
  async init() { await this.loadTeachingCourses(); this.setupEventListeners(); }
  async fetchData(url) {
    try { const res = await fetch(`${url}?email=${encodeURIComponent(this.email)}`); if (!res.ok) return null; return await res.json(); } catch { return null; }
  }
  async loadTeachingCourses() {
    const data = await this.fetchData('/api/teacher/courses');
    if (!Array.isArray(data)) return; this.renderTeachingCourses(data);
  }
  renderTeachingCourses(courses) {
    const tbody = document.getElementById('teachingCourses'); if (!tbody) return; tbody.innerHTML = '';
    courses.forEach(c => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${c.course_id}</td><td>${c.course_name}</td><td>${c.credits}</td><td>${c.student_count}</td>`; tbody.appendChild(tr); });
    const courseSelect = document.getElementById('courseSelect'); if (!courseSelect) return; courseSelect.innerHTML = '<option value="">请选择课程</option>';
    courses.forEach(c => { const opt = document.createElement('option'); opt.value = c.course_id; opt.textContent = `${c.course_name} (${c.course_id})`; courseSelect.appendChild(opt); });
    courseSelect.addEventListener('change', async (e) => { const id = e.target.value; if (!id) return; await this.loadGrades(id); });
  }
  async loadGrades(courseId) { const grades = await this.fetchData(`/api/teacher/grades?course_id=${courseId}`); if (!Array.isArray(grades)) return; this.renderGrades(grades); }
  renderGrades(grades) {
    const tbody = document.getElementById('gradeList'); if (!tbody) return; tbody.innerHTML = grades.length ? '' : `<tr><td colspan="4" class="text-center">暂无成绩记录</td></tr>`;
    grades.forEach(g => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${g.student_id}</td><td>${g.name}</td><td><input type="number" value="${g.grade || ''}" data-student-id="${g.student_id}" class="form-control grade-input"></td><td><button class="btn btn-primary btn-sm" data-student-id="${g.student_id}">保存</button></td>`; tbody.appendChild(tr); });
  }
  setupEventListeners() {
    const gradeList = document.getElementById('gradeList'); if (!gradeList) return; gradeList.addEventListener('click', async (e) => {
      const btn = e.target.closest('button'); if (!btn) return; const studentId = btn.dataset.studentId; const gradeInput = document.querySelector(`.grade-input[data-student-id="${studentId}"]`); if (!gradeInput) return; const grade = gradeInput.value; const courseId = document.getElementById('courseSelect').value;
      try { const r = await fetch('/api/teacher/grades', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId, studentId, grade }) }); if (!r.ok) throw new Error('更新成绩失败'); alert('成绩更新成功'); } catch { alert('更新成绩失败，请稍后重试'); }
    });
  }
}
new TeacherPortal();
window.logout = function () { localStorage.removeItem('email'); localStorage.removeItem('user'); window.location = '/'; };
