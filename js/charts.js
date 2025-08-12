// Chart.js helpers

export function renderRadar(canvas, labels, data, opts = {}) {
  if (!canvas || !window.Chart) return null;
  const ctx = canvas.getContext('2d');
  const chart = new window.Chart(ctx, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: opts.label || 'Ratings',
        data,
        borderColor: '#4cc9f0',
        backgroundColor: 'rgba(76, 201, 240, 0.2)',
        pointBackgroundColor: '#4cc9f0',
      }]
    },
    options: {
      responsive: true,
      scales: { r: { beginAtZero: true, suggestedMax: 100, ticks: { color: '#8ea0b5' }, grid: { color: 'rgba(142,160,181,.2)' } } },
      plugins: { legend: { labels: { color: '#8ea0b5' } } }
    }
  });
  return chart;
}
