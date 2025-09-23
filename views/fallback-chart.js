/**
 * 简单的备选图表绘制函数
 * 当Chart.js失败时可以使用此函数直接在Canvas上绘制简单柱状图
 */
function drawFallbackBarChart(canvasId, labels, values, title) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return false;
  
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  // 清空画布
  ctx.clearRect(0, 0, width, height);
  
  // 绘制标题
  ctx.font = '16px Arial';
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.fillText(title || '校区用户分布', width / 2, 20);
  
  // 绘制图表
  const barCount = labels.length;
  if (barCount === 0) return false;
  
  // 计算最大值以确定比例
  const maxValue = Math.max(...values, 1);
  
  // 计算图表区域尺寸
  const chartMargin = { top: 30, right: 20, bottom: 40, left: 40 };
  const chartWidth = width - chartMargin.left - chartMargin.right;
  const chartHeight = height - chartMargin.top - chartMargin.bottom;
  
  // 计算每个柱状图的宽度
  const barWidth = chartWidth / barCount * 0.7;
  const barSpacing = chartWidth / barCount * 0.3;
  
  // 绘制Y轴刻度
  ctx.beginPath();
  ctx.strokeStyle = '#ddd';
  ctx.font = '10px Arial';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#666';
  
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const y = chartMargin.top + chartHeight - (chartHeight * i / ySteps);
    ctx.moveTo(chartMargin.left, y);
    ctx.lineTo(width - chartMargin.right, y);
    
    // 刻度标签
    const value = Math.round(maxValue * i / ySteps);
    ctx.fillText(value, chartMargin.left - 5, y + 3);
  }
  ctx.stroke();
  
  // 绘制X轴
  ctx.beginPath();
  ctx.moveTo(chartMargin.left, chartMargin.top + chartHeight);
  ctx.lineTo(width - chartMargin.right, chartMargin.top + chartHeight);
  ctx.strokeStyle = '#333';
  ctx.stroke();
  
  // 绘制每个柱状图
  const colors = [
    '#36a2eb', '#ff6384', '#4bc0c0', '#ffcd56', '#9966ff',
    '#ff9f40', '#c9cbcf', '#7cfc00', '#dc143c', '#00ffff'
  ];
  
  for (let i = 0; i < barCount; i++) {
    // 计算柱状图位置
    const barHeight = chartHeight * (values[i] / maxValue);
    const barLeft = chartMargin.left + (chartWidth / barCount) * i + (chartWidth / barCount - barWidth) / 2;
    const barTop = chartMargin.top + chartHeight - barHeight;
    
    // 绘制柱状图
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(barLeft, barTop, barWidth, barHeight);
    
    // 绘制数值
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.font = '12px Arial';
    ctx.fillText(values[i], barLeft + barWidth / 2, barTop - 5);
    
    // 绘制标签
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.font = '12px Arial';
    const label = labels[i];
    const displayLabel = label.length > 8 ? label.substring(0, 8) + '...' : label;
    ctx.fillText(displayLabel, barLeft + barWidth / 2, chartMargin.top + chartHeight + 15);
  }
  
  return true;
}