// Presenter tools live above the app without consuming screen space.
export function setupPanels(onClose) {
  const pairs = [['remoteToggle', 'remotePanel'], ['demoToggle', 'demoPanel']];
  let active = null;
  let opener = null;
  function close() {
    if (!active) return;
    active.hidden = true;
    pairs.forEach(([id]) => document.getElementById(id).setAttribute('aria-expanded', 'false'));
    active = null;
    opener?.focus({preventScroll:true});
    onClose?.();
  }
  for (const [buttonId, panelId] of pairs) {
    const button = document.getElementById(buttonId);
    const panel = document.getElementById(panelId);
    button.addEventListener('click', () => {
      const wasOpen = active === panel;
      close();
      if (wasOpen) return;
      opener = button;
      active = panel;
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      panel.querySelector('button').focus({preventScroll:true});
    });
    panel.querySelector('[data-close-panel]').addEventListener('click', close);
  }
  document.addEventListener('pointerdown', event => {
    if (active && !active.contains(event.target) && !event.target.closest('.tools')) close();
  });
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close();
    } else if (event.key === 'Tab') {
      const items = [...active.querySelectorAll('button:not(:disabled),a[href]')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  return {close, isOpen:() => active !== null};
}
