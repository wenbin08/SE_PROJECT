document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/courses').then(r => r.json()).then(courses => {
    const tbody = document.getElementById('courseList');
    tbody.innerHTML = courses.map(c => `
      <tr>
        <td>${c.course_id}</td>
        <td>${c.course_name}</td>
        <td>${c.credits}</td>
        <td>${c.teacher_name || '-'}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="showEditModal(${c.course_id}, '${c.course_name}', ${c.credits}, ${c.teacher_id || 'null'}, '${c.schedule || ''}', '${c.location || ''}')">修改</button>
          <button class="btn btn-sm btn-danger" onclick="deleteCourse(${c.course_id})">删除</button>
        </td>
      </tr>`).join('');
  });
});

function parseSchedule(schedule) { if (!schedule) return { day: '周一', start: '', end: '' }; const [day, time] = schedule.split(' '); const [start, end] = (time || '').split('-'); return { day, start, end }; }
function populateTeacherSelect(selectId) { return fetch('/api/teachers').then(r => r.json()).then(list => { const s = document.getElementById(selectId); s.innerHTML = '<option value="">请选择教师</option>' + list.map(t => `<option value="${t.teacher_id}">${t.name}</option>`).join(''); }); }
async function showEditModal(id, name, credits, teacherId, schedule, location) {
  await populateTeacherSelect('editTeacherId'); document.getElementById('editCourseId').value = id; document.getElementById('editCourseName').value = name || ''; document.getElementById('editCredits').value = credits || ''; document.getElementById('editTeacherId').value = teacherId || ''; const { day, start, end } = parseSchedule(schedule); document.getElementById('editScheduleDay').value = day || '周一'; document.getElementById('editScheduleStart').value = start || ''; document.getElementById('editScheduleEnd').value = end || ''; document.getElementById('editLocation').value = location || ''; $('#editModal').modal('show'); }
function updateCourse() {
  const id = document.getElementById('editCourseId').value; const course_name = document.getElementById('editCourseName').value; const credits = parseFloat(document.getElementById('editCredits').value); const teacher_id = document.getElementById('editTeacherId').value; const day = document.getElementById('editScheduleDay').value; const start = document.getElementById('editScheduleStart').value; const end = document.getElementById('editScheduleEnd').value; const location = document.getElementById('editLocation').value; if (!course_name || isNaN(credits) || !day || !start || !end) { alert('请填写所有必填字段'); return; } if (credits <= 0 || credits > 99.9) { alert('学分必须在 0.1 到 99.9 之间'); return; } const schedule = `${day} ${start}-${end}`;
  fetch(`/api/courses/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course_name, credits, teacher_id: teacher_id === '' ? null : parseInt(teacher_id), schedule, location: location || null }) })
    .then(r => r.json()).then(d => { if (d.message) { alert(d.message); location.reload(); } else { throw new Error('更新失败'); } })
    .catch(e => console.error('更新课程失败:', e)); $('#editModal').modal('hide'); }
function showAddCourseModal() { document.getElementById('addCourseId').value=''; document.getElementById('addCourseName').value=''; document.getElementById('addCredits').value=''; document.getElementById('addTeacherId').value=''; populateTeacherSelect('addTeacherId').then(() => $('#addModal').modal('show')); }
function addCourse() {
  const course_id = document.getElementById('addCourseId').value; const course_name = document.getElementById('addCourseName').value; const credits = parseFloat(document.getElementById('addCredits').value); const teacher_id = document.getElementById('addTeacherId').value; const day = document.getElementById('addScheduleDay').value; const start = document.getElementById('addScheduleStart').value; const end = document.getElementById('addScheduleEnd').value; const location = document.getElementById('addLocation').value; if (!course_id || !course_name || isNaN(credits) || !day || !start || !end) { alert('请填写所有必填字段'); return; } if (parseInt(course_id) <= 0) { alert('课程ID必须为正整数'); return; } if (credits <= 0 || credits > 99.9) { alert('学分必须在 0.1 到 99.9 之间'); return; } const schedule = `${day} ${start}-${end}`;
  fetch('/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course_id: parseInt(course_id), course_name, credits, teacher_id: teacher_id === '' ? null : parseInt(teacher_id), schedule, location: location || null }) })
    .then(r => r.json()).then(d => { if (d.message) { alert(d.message); location.reload(); } else { throw new Error('新增失败'); } })
    .catch(e => console.error('新增课程失败:', e)); $('#addModal').modal('hide'); }
window.showEditModal = showEditModal; window.updateCourse = updateCourse; window.showAddCourseModal = showAddCourseModal; window.addCourse = addCourse; window.deleteCourse = function(id){ if(confirm('确定删除该课程？')){ fetch(`/api/courses/${id}`, { method: 'DELETE' }).then(r=>r.json()).then(d=>{ if(d.message){ alert(d.message); location.reload(); } }); } };
window.logout = function(){ localStorage.removeItem('email'); localStorage.removeItem('user'); window.location = '/'; };
