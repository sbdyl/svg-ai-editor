// Keep native selects as the data source; animate a keyboard-accessible popover above the canvas.
export function enhanceSelects() {
  const controls = [];
  let opened = null;
  const compactLabel = select => {
    const option = select.selectedOptions[0];
    if (select.id === 'ai-model') return !select.value ? 'CLI 默认' : select.value === '__custom' ? '自定义' : option?.textContent;
    if (select.id === 'ai-effort') return !select.value ? '默认思考' : option?.textContent.split(' · ')[0];
    return option?.textContent || '请选择';
  };

  for (const select of document.querySelectorAll('select')) {
    const wrapper = document.createElement('span'); wrapper.className = 'select-shell';
    select.before(wrapper); wrapper.append(select);
    select.classList.add('native-select'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    const trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'select-trigger'; trigger.id = `${select.id}-trigger`;
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent.trim() || '选择');
    trigger.setAttribute('aria-expanded', 'false');
    const value = document.createElement('span'); value.className = 'select-value';
    const chevron = document.createElement('span'); chevron.className = 'select-chevron'; chevron.setAttribute('aria-hidden', 'true');
    trigger.append(value, chevron); wrapper.append(trigger);
    const menu = document.createElement('div'); menu.className = 'select-menu'; menu.id = `${select.id}-menu`;
    menu.setAttribute('popover', 'manual'); menu.setAttribute('role', 'listbox'); menu.tabIndex = -1;
    menu.setAttribute('aria-label', trigger.getAttribute('aria-label'));
    trigger.setAttribute('aria-controls', menu.id);
    // A popover belonging to a modal must remain inside that dialog's focus scope.
    (select.closest('dialog') || document.body).append(menu);
    let active = 0, options = [], closing = null, search = '', searchTimer, positionFrame;

    function sync() {
      value.textContent = compactLabel(select);
      trigger.title = `${trigger.getAttribute('aria-label')} · ${select.selectedOptions[0]?.textContent || ''}`;
      trigger.disabled = select.disabled;
      wrapper.hidden = select.hidden;
      if (select.disabled && opened?.select === select) close(false);
    }
    function highlight(index) {
      active = (index + options.length) % options.length;
      [...menu.children].forEach((el, i) => el.classList.toggle('active', i === active));
      const item = menu.children[active];
      if (item) { menu.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
    }
    function position() {
      const rect = trigger.getBoundingClientRect();
      const composer = trigger.closest('.composer');
      const anchor = composer?.getBoundingClientRect() || rect;
      const container = (composer ? trigger.closest('.editor') : select.closest('dialog'))?.getBoundingClientRect();
      const leftEdge = Math.max(12, (container?.left || 0) + 12);
      const rightEdge = Math.min(innerWidth - 12, (container?.right || innerWidth) - 12);
      const width = Math.min(Math.max(rect.width, select.id === 'ai-model' ? 272 : 236), rightEdge - leftEdge);
      menu.style.width = `${width}px`;
      const below = innerHeight - anchor.bottom - 22, above = anchor.top - 22;
      const desiredHeight = Math.min(282, menu.scrollHeight || options.length * 44 + 16);
      const up = below < desiredHeight && above > below;
      menu.dataset.direction = up ? 'up' : 'down';
      menu.style.maxHeight = `${Math.max(44, Math.min(282, up ? above : below))}px`;
      menu.style.left = `${Math.max(leftEdge, Math.min(rect.left, rightEdge - width, composer ? anchor.right - width : rightEdge - width))}px`;
      menu.style.top = up ? 'auto' : `${anchor.bottom + 10}px`;
      menu.style.bottom = up ? `${innerHeight - anchor.top + 10}px` : 'auto';
    }
    function trackPosition() {
      if (opened?.select !== select) return;
      position(); positionFrame = requestAnimationFrame(trackPosition);
    }
    function choose(index) {
      const option = options[index];
      if (!option || option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync(); close(true);
    }
    function open() {
      if (select.disabled) return;
      opened?.close(false, true);
      if (closing) { closing.cancel(); closing = null; }
      menu.replaceChildren(); options = [...select.options];
      options.forEach((option, index) => {
        const item = document.createElement('div'); item.className = 'select-option'; item.id = `${menu.id}-${index}`;
        item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
        item.setAttribute('aria-disabled', String(option.disabled));
        const text = document.createElement('span'); text.textContent = option.textContent;
        const mark = document.createElement('span'); mark.className = 'option-check'; mark.textContent = option.selected ? '✓' : '';
        item.append(text, mark); item.onclick = () => choose(index); item.onpointermove = () => highlight(index);
        menu.append(item);
      });
      position(); menu.showPopover(); trigger.setAttribute('aria-expanded', 'true');
      opened = { select, close, trigger, menu, position };
      cancelAnimationFrame(positionFrame); trackPosition();
      menu.focus({ preventScroll: true }); highlight(Math.max(0, select.selectedIndex));
    }
    function close(focus = true, immediate = false) {
      cancelAnimationFrame(positionFrame);
      if (opened?.select === select) opened = null;
      trigger.setAttribute('aria-expanded', 'false');
      if (focus) trigger.focus({ preventScroll: true });
      if (!menu.matches(':popover-open')) return;
      if (immediate) { menu.hidePopover(); return; }
      closing?.cancel();
      closing = menu.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `0 ${menu.dataset.direction === 'up' ? '5px' : '-5px'}` }], { duration: 110, easing: 'ease-out' });
      closing.onfinish = () => { menu.hidePopover(); closing = null; };
    }
    trigger.onclick = () => opened?.select === select ? close() : open();
    trigger.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); open(); }
    };
    menu.onkeydown = event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Tab') { close(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); highlight(active + (event.key === 'ArrowDown' ? 1 : -1)); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); highlight(event.key === 'Home' ? 0 : options.length - 1); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
      else if (event.key.length === 1) {
        search += event.key.toLowerCase(); clearTimeout(searchTimer); searchTimer = setTimeout(() => { search = ''; }, 600);
        const match = options.findIndex(option => option.textContent.toLowerCase().startsWith(search));
        if (match !== -1) highlight(match);
      }
    };
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { childList: true, attributes: true, subtree: true });
    select.closest('dialog')?.addEventListener('close', () => close(false, true));
    controls.push(sync); sync();
  }
  document.addEventListener('pointerdown', event => {
    if (opened && !opened.menu.contains(event.target) && !opened.trigger.contains(event.target)) opened.close(false);
  });
  window.addEventListener('resize', () => opened?.close(false, true));
  document.addEventListener('scroll', event => { if (opened && !opened.menu.contains(event.target)) opened.close(false, true); }, true);
  return () => controls.forEach(sync => sync());
}
