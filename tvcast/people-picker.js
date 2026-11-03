/* A local, searchable combobox. The input retains focus while its active option is announced. */
class PeoplePicker {
  constructor(input, list, onChange) {
    this.input = input;
    this.list = list;
    this.onChange = onChange;
    this.options = [];
    this.matches = [];
    this.active = -1;
    this.optionsKey = '';
    this.renderKey = '';
    this.composing = false;
    input.removeAttribute('list');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('autocomplete', 'off');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Actors and directors');
    list.classList.add('people-options');
    list.hidden = true;
    this.status = document.createElement('span');
    this.status.className = 'people-picker-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    input.parentElement.append(this.status);

    input.addEventListener('focus', () => this.open());
    input.addEventListener('click', () => this.open());
    input.addEventListener('input', () => {
      if (this.composing) return;
      this.active = -1;
      this.open();
      this.onChange(input.value);
    });
    input.addEventListener('compositionstart', () => { this.composing = true; });
    input.addEventListener('compositionend', () => {
      this.composing = false;
      this.active = -1;
      this.open();
      this.onChange(input.value);
    });
    input.addEventListener('keydown', event => this.keydown(event));
    input.addEventListener('blur', () => this.close());
    list.addEventListener('pointerdown', event => {
      // Choosing an option must not blur the input before the click can commit it.
      if (event.target.closest('[data-person-index]')) event.preventDefault();
    });
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-person-index]');
      if (option) this.choose(Number(option.dataset.personIndex));
    });
    list.addEventListener('pointermove', event => {
      const option = event.target.closest('[data-person-index]');
      if (option) this.activate(Number(option.dataset.personIndex), false);
    });
    document.addEventListener('pointerdown', event => {
      if (!input.parentElement.contains(event.target)) this.close();
    });
  }

  static normalize(value) {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  }

  setOptions(names) {
    const options = [...new Set(names.filter(name => typeof name === 'string' && name.trim()))]
      .sort((a, b) => a.localeCompare(b));
    const key = JSON.stringify(options);
    if (key === this.optionsKey) return;
    const activeName = this.matches[this.active];
    this.options = options;
    this.optionsKey = key;
    if (!this.list.hidden) this.render(activeName);
  }

  setValue(value) {
    value = String(value || '');
    if (this.input.value === value) return;
    this.input.value = value;
    this.active = -1;
    if (!this.list.hidden) this.render();
  }

  open() {
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.render(this.matches[this.active]);
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.active = -1;
    this.status.textContent = '';
  }

  render(activeName) {
    const query = PeoplePicker.normalize(this.input.value.trim());
    const matches = this.options.filter(name => PeoplePicker.normalize(name).includes(query));
    this.matches = matches.slice(0, 60);
    const key = JSON.stringify([this.matches, matches.length]);
    if (key !== this.renderKey) {
      this.renderKey = key;
      const fragment = document.createDocumentFragment();
      this.matches.forEach((name, index) => {
        const option = document.createElement('li');
        option.id = this.list.id + '-option-' + index;
        option.dataset.personIndex = String(index);
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.textContent = name;
        fragment.append(option);
      });
      if (!matches.length || matches.length > 60) {
        const hint = document.createElement('li');
        hint.className = 'people-picker-hint';
        hint.setAttribute('role', 'presentation');
        hint.textContent = !matches.length
          ? (this.options.length ? 'No matching people in your library.' : 'People appear as movie information is downloaded.')
          : 'Type more to narrow the list.';
        fragment.append(hint);
      }
      this.list.replaceChildren(fragment);
      this.list.scrollTop = 0;
    }
    this.activate(activeName ? this.matches.indexOf(activeName) : -1, false);
    this.status.textContent = matches.length > 60
      ? matches.length + ' people found. Showing the first 60; type more to narrow the list.'
      : matches.length + (matches.length === 1 ? ' person found.' : ' people found.');
  }

  activate(index, scroll = true) {
    this.active = index >= 0 && index < this.matches.length ? index : -1;
    for (const option of this.list.querySelectorAll('[role=option]')) {
      option.setAttribute('aria-selected', String(Number(option.dataset.personIndex) === this.active));
    }
    if (this.active < 0) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    const id = this.list.id + '-option-' + this.active;
    this.input.setAttribute('aria-activedescendant', id);
    if (scroll) document.getElementById(id).scrollIntoView({block: 'nearest'});
  }

  choose(index) {
    const name = this.matches[index];
    if (name === undefined) return;
    this.input.value = name;
    this.close();
    this.onChange(name);
  }

  keydown(event) {
    if (event.isComposing || this.composing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const wasClosed = this.list.hidden;
      if (wasClosed) this.open();
      if (!this.matches.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = this.active < 0 ? (delta > 0 ? 0 : this.matches.length - 1)
        : Math.max(0, Math.min(this.matches.length - 1, this.active + delta));
      this.activate(next);
    } else if (event.key === 'Enter' && !this.list.hidden && this.active >= 0) {
      event.preventDefault();
      this.choose(this.active);
    } else if (event.key === 'Escape' && !this.list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'Tab') {
      this.close();
    }
  }
}
