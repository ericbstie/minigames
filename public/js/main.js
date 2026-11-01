document.querySelectorAll('.hub-card').forEach(b => b.addEventListener('click', () => window.GameHub.open(b.dataset.game)));
window.addEventListener('hashchange', () => window.GameHub.route());
window.GameHub.route();
