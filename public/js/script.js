document.addEventListener("DOMContentLoaded", function () {
  const loginForm = document.getElementById("loginForm");
  if (!loginForm) return;
  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("inputPassword").value;

    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const info = data.data;
          localStorage.setItem('user', JSON.stringify(info));
          if (info.role === 'student') window.location.href = `student_reservation.html?student_id=${info.id}`;
          else if (info.role === 'coach') window.location.href = `coach_portal.html?coach_id=${info.id}`;
          else if (info.role === 'campus_admin' || info.role === 'super_admin') window.location.href = 'campus_admin.html';
          else alert('未知角色，无法跳转');
        } else {
          alert(data.error || data.message || '登录失败');
        }
      })
      .catch(err => {
        console.error('登录请求错误:', err);
        alert('登录请求出错');
      });
  });
});
