/* Select-only comboboxes retain keyboard focus while the list announces its active option. */
class ThemedSelect {
  constructor(button, list, onChange) {
    this.button = button;
    this.list = list;
    this.onChange = onChange;
    this.options = [];
    this.optionsKey = '';
    this.active = -1;
    this.typeahead = '';
    this.typedAt = 0;
    button.type = 'button';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-controls', list.id);
    button.setAttribute('aria-expanded', 'false');
    this.label = document.createElement('span');
    this.label.className = 'themed-select-label';
    button.replaceChildren(this.label, ThemedSelect.icon('chevron-down'));
    list.classList.add('themed-select-options');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', button.getAttribute('aria-label') + ' options');
    list.hidden = true;
    button.addEventListener('click', () => list.hidden ? this.open() : this.close());
    button.addEventListener('keydown', event => this.keydown(event));
    button.addEventListener('blur', () => this.close());
    list.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-choice-index]')) event.preventDefault();
    });
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-choice-index]');
      if (option) this.choose(Number(option.dataset.choiceIndex));
    });
    list.addEventListener('pointermove', event => {
      const option = event.target.closest('[data-choice-index]');
      if (option) this.activate(Number(option.dataset.choiceIndex), false);
    });
    document.addEventListener('pointerdown', event => {
      if (!button.parentElement.contains(event.target)) this.close();
    });
    document.addEventListener('scroll', event => {
      if (!list.hidden && !list.contains(event.target)) this.close();
    }, true);
    window.addEventListener('resize', () => this.close());
    window.addEventListener('hashchange', () => this.close());
  }

  static icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '/icons.svg#' + name);
    svg.append(use);
    return svg;
  }

  setOptions(entries, value) {
    const options = entries.map(([key, label]) => [String(key), String(label)]);
    const key = JSON.stringify(options);
    if (key !== this.optionsKey) {
      const activeValue = this.options[this.active]?.[0];
      this.options = options;
      this.optionsKey = key;
      const fragment = document.createDocumentFragment();
      options.forEach(([, label], index) => {
        const option = document.createElement('li');
        option.id = this.list.id + '-option-' + index;
        option.dataset.choiceIndex = String(index);
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        const text = document.createElement('span');
        text.textContent = label;
        option.append(ThemedSelect.icon('check'), text);
        fragment.append(option);
      });
      this.list.replaceChildren(fragment);
      this.active = options.findIndex(([key]) => key === activeValue);
    }
    this.setValue(value);
  }

  setValue(value) {
    value = String(value ?? '');
    const changed = this.button.value !== value;
    this.button.value = value;
    this.label.textContent = this.options.find(([key]) => key === value)?.[1] ?? value;
    for (const [index, option] of [...this.list.children].entries()) {
      option.setAttribute('aria-selected', String(this.options[index][0] === value));
    }
    if (!this.list.hidden) {
      this.activate(changed ? this.options.findIndex(([key]) => key === value) : this.active, false);
      this.position();
    }
  }

  position() {
    const rect = this.button.getBoundingClientRect();
    const width = Math.min(innerWidth - 16, Math.max(rect.width, 210));
    const below = innerHeight - rect.bottom - 14, above = rect.top - 14;
    const upwards = below < 240 && above > below;
    this.list.style.width = width + 'px';
    this.list.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left)) + 'px';
    this.list.style.maxHeight = Math.max(44, Math.min(320, upwards ? above : below)) + 'px';
    this.list.style.top = upwards ? 'auto' : rect.bottom + 6 + 'px';
    this.list.style.bottom = upwards ? innerHeight - rect.top + 6 + 'px' : 'auto';
  }

  open() {
    if (this.button.disabled || !this.options.length) return;
    this.list.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.position();
    this.activate(Math.max(0, this.options.findIndex(([key]) => key === this.button.value)));
  }

  close() {
    this.list.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.button.removeAttribute('aria-activedescendant');
    this.active = -1;
    this.typeahead = '';
  }

  activate(index, scroll = true) {
    this.active = index >= 0 && index < this.options.length ? index : -1;
    for (const [i, option] of [...this.list.children].entries()) option.classList.toggle('is-active', i === this.active);
    if (this.active < 0) {
      this.button.removeAttribute('aria-activedescendant');
      return;
    }
    const option = this.list.children[this.active];
    this.button.setAttribute('aria-activedescendant', option.id);
    if (scroll) option.scrollIntoView({block:'nearest'});
  }

  choose(index) {
    if (!this.options[index]) return;
    const value = this.options[index][0], changed = this.button.value !== value;
    this.setValue(value);
    this.close();
    if (changed) this.onChange(value);
  }

  keydown(event) {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const closed = this.list.hidden;
      if (closed) this.open();
      if (key === 'Home') this.activate(0);
      else if (key === 'End') this.activate(this.options.length - 1);
      else if (!closed) this.activate(Math.max(0, Math.min(this.options.length - 1, this.active + (key === 'ArrowDown' ? 1 : -1))));
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (this.list.hidden) this.open(); else this.choose(this.active);
    } else if (key === 'Escape' && !this.list.hidden) {
      event.preventDefault(); event.stopPropagation(); this.close();
    } else if (key === 'Tab') this.close();
    else if (key.length === 1) {
      event.preventDefault();
      if (this.list.hidden) this.open();
      const now = performance.now(), character = key.toLocaleLowerCase();
      this.typeahead = now - this.typedAt < 700 ? this.typeahead + character : character;
      this.typedAt = now;
      const query = [...this.typeahead].every(c => c === character) ? character : this.typeahead;
      const start = query.length === 1 ? this.active + 1 : this.active;
      for (let offset = 0; offset < this.options.length; offset++) {
        const index = (Math.max(0, start) + offset) % this.options.length;
        if (this.options[index][1].toLocaleLowerCase().startsWith(query)) { this.activate(index); break; }
      }
    }
  }
}
