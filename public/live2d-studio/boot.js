// Catalog/module failures must offer a retry instead of an indefinite spinner.
// Persisted drafts are read before initialization enables autosaving.
try {
  await import('./ui.js');
} catch (error) {
  document.querySelector('#load-title').textContent = '创作台暂时无法启动';
  document.querySelector('#load-message').textContent = error.message;
  const retry = document.querySelector('#retry');
  retry.hidden = false;
  retry.textContent = '重新载入';
  retry.onclick = () => location.reload();
}
