/* Shared catalogue and navigation. TV playback stays in the existing panel controller. */
let catalogue = null, catalogueSig = '', folderSig = '', detailSig = '', detailMovie = null;
let localOnline = false, libraryRequest = 0, detailRequest = 0, currentRoute = '';
let pendingCast = null, castSending = false, matchMovieId = null, matchSearchRequest = 0;
const localBusy = new Set();
function stored(storage, key, fallback = '') {
  try { return storage.getItem(key) ?? fallback; } catch { return fallback; } // Browser privacy mode can disable storage.
}
function remember(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* Navigation still works without persisted preferences. */ }
}
let browse = {query:'', sort:stored(localStorage, 'library.sort', 'title'), descending:stored(localStorage, 'library.descending') === 'true', genre:'', person:'', watched:'all', attention:false, folder:'', recursive:stored(localStorage, 'library.recursive', 'false') === 'true'};
let libraryView = stored(localStorage, 'library.view', 'grid');
let libraryHref = stored(sessionStorage, 'library.href', '#/library');
const isTV = () => location.hash.split('?')[0] === '#/tv';
const movieId = () => location.hash.startsWith('#/movie/') ? location.hash.slice(8).split('?')[0] : null;
const iconNames = {play:'play', cast:'cast', list:'list', grid:'layout-grid', refresh:'refresh-cw', settings:'settings', up:'arrow-up', down:'arrow-down', auto:'monitor', light:'sun', dark:'moon', folder:'folder', scan:'folder-search', next:'chevron-right', check:'check', circle:'circle'};
const glyph = kind => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#${iconNames[kind]}"></use></svg>`;
const peoplePicker = new PeoplePicker($('person'), $('peopleOptions'), () => changeBrowsing());
const sortPicker = new ThemedSelect($('sort'), $('sortOptions'), () => { browse.descending = defaultSortDescending($('sort').value); changeBrowsing(); });
const genrePicker = new ThemedSelect($('genre'), $('genreOptions'), () => changeBrowsing());
const watchedPicker = new ThemedSelect($('filter'), $('watchedOptions'), () => changeBrowsing());
sortPicker.setOptions([['title','Title'], ['file_runtime_s','Runtime'], ['year','Year'], ['score','TMDB score']], browse.sort);
watchedPicker.setOptions([['all','All movies'], ['unwatched','Unwatched'], ['watched','Watched']], browse.watched);
let editingToken = false, credentialMode = '';
let theme = stored(localStorage, 'tvcast.theme.v1', 'auto');
if (!['auto','light','dark'].includes(theme)) theme = 'auto';
function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('themeButton').innerHTML = glyph(theme);
  const label = 'Theme: ' + theme[0].toUpperCase() + theme.slice(1);
  $('themeButton').dataset.tooltip = label;
  $('themeButton').setAttribute('aria-label', label + '. Switch to ' + ({auto:'light',light:'dark',dark:'auto'}[theme]));
  remember(localStorage, 'tvcast.theme.v1', theme);
}
$('themeButton').onclick = () => { theme = {auto:'light',light:'dark',dark:'auto'}[theme]; applyTheme(); };
applyTheme();
for (const [id, icon] of [['listView','list'],['gridView','grid'],['settingsButton','settings']]) $(id).innerHTML = glyph(icon);
const poster = m => `<span class="poster">${m.poster ? `<img src="${esc(m.poster)}" alt="" loading="lazy">` : `<span class="poster-placeholder" aria-hidden="true">${esc(m.title.slice(0, 1))}</span>`}</span>`;
const watchedCorner = (m, disabled = false) => `<button class="poster-status poster-watched ${m.watched ? 'is-watched' : 'is-unwatched'}" data-watched="${esc(m.id)}" aria-label="Mark ${esc(m.title)} ${m.watched ? 'unwatched' : 'watched'}" aria-pressed="${!!m.watched}" data-tooltip="${m.watched ? 'Mark unwatched' : 'Mark watched'}" ${disabled ? 'disabled' : ''}>${glyph(m.watched ? 'check' : 'circle')}</button>`;
const movieMeta = m => `<div class="movie-meta"><span>${m.year || 'Year unknown'}</span><span>${m.file_runtime_s ? runtime(m.file_runtime_s) : 'Runtime unknown'}</span>${m.score != null ? `<span>TMDB ${Number(m.score).toFixed(1)}</span>` : ''}</div>`;

const iconTooltip = document.createElement('div');
iconTooltip.id = 'iconTooltip'; iconTooltip.className = 'icon-tooltip';
iconTooltip.setAttribute('role', 'tooltip'); iconTooltip.hidden = true;
document.querySelector('main').append(iconTooltip);
let tooltipTarget = null, tooltipTimer;
function hideIconTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTarget?.removeAttribute('aria-describedby');
  tooltipTarget = null; iconTooltip.hidden = true;
}
function showIconTooltip(button) {
  hideIconTooltip(); tooltipTarget = button;
  // Keep the label in the active dialog's top layer when Settings is open.
  (button.closest('dialog') || document.querySelector('main')).append(iconTooltip);
  iconTooltip.textContent = button.dataset.tooltip; iconTooltip.hidden = false;
  button.setAttribute('aria-describedby', iconTooltip.id);
  const rect = button.getBoundingClientRect(), width = iconTooltip.offsetWidth, height = iconTooltip.offsetHeight;
  iconTooltip.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left + (rect.width - width) / 2)) + 'px';
  iconTooltip.style.top = (rect.top >= height + 12 ? rect.top - height - 6 : rect.bottom + 6) + 'px';
}
document.addEventListener('pointerover', e => {
  const button = e.target.closest('[data-tooltip]');
  if (button) showIconTooltip(button);
});
document.addEventListener('pointerout', e => {
  if (!tooltipTarget || tooltipTarget.contains(e.relatedTarget) || iconTooltip.contains(e.relatedTarget)
      || document.activeElement === tooltipTarget) return;
  tooltipTimer = setTimeout(hideIconTooltip, 150);
});
iconTooltip.addEventListener('pointerenter', () => clearTimeout(tooltipTimer));
iconTooltip.addEventListener('pointerleave', hideIconTooltip);
document.addEventListener('focusin', e => { if (e.target.matches('[data-tooltip]')) showIconTooltip(e.target); });
document.addEventListener('focusout', hideIconTooltip);
document.addEventListener('pointerdown', hideIconTooltip);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideIconTooltip(); });
document.addEventListener('scroll', hideIconTooltip, true);
window.addEventListener('resize', hideIconTooltip);
window.addEventListener('hashchange', hideIconTooltip);

function listHash(values = browse) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== '' && value !== false) p.set(key, value);
  return '#/library?' + p.toString();
}
function saveBrowsing() {
  libraryHref = listHash();
  remember(sessionStorage, 'library.href', libraryHref);
  remember(sessionStorage, 'library.scroll', String(window.scrollY));
  if (currentRoute === 'library') history.replaceState({scroll:window.scrollY}, '', libraryHref);
  updateLibraryLinks();
}
function updateLibraryLinks() {
  document.querySelectorAll('#libraryTab, #backToLibrary, #castRequest a.back-link').forEach(a => a.href = libraryHref);
}
function renderLibrary() {
  if (!catalogue) return;
  const genres = [['', 'All genres'], ...[...new Set(catalogue.library.flatMap(m => m.genres || []))].sort().map(g => [g, g])];
  if (browse.genre && !genres.some(([value]) => value === browse.genre)) genres.push([browse.genre, browse.genre + ' (unavailable)']);
  genrePicker.setOptions(genres, browse.genre);
  sortPicker.setValue(browse.sort); watchedPicker.setValue(browse.watched);
  $('clearPerson').hidden = !browse.person;
  const people = catalogue.library.flatMap(m => [...(m.directors || []), ...(m.cast || [])]);
  peoplePicker.setOptions(people);
  $('clearFilters').hidden = !browse.genre && !browse.person && browse.watched === 'all' && !browse.attention;
  const visible = browseCollection(selectMovies(catalogue.library, browse), catalogue.folders, browse);
  const movies = visible.movies;
  const attentionCount = browseCollection(catalogue.library, catalogue.folders, {...browse, query:'', recursive:true}).movies.filter(m => movieAttention(m).length).length;
  $('attentionFilter').hidden = !attentionCount && !browse.attention;
  $('attentionFilter').setAttribute('aria-pressed', String(browse.attention));
  $('attentionCount').textContent = attentionCount || '';
  renderFolders(visible.folders);
  $('libraryCount').textContent = `${movies.length} ${movies.length === 1 ? 'movie' : 'movies'}${visible.folders.length ? ', ' + visible.folders.length + (visible.folders.length === 1 ? ' collection' : ' collections') : ''}`;
  $('sortDirection').innerHTML = glyph(browse.descending ? 'down' : 'up');
  $('sortDirection').dataset.tooltip = browse.descending ? 'Sort ascending' : 'Sort descending';
  $('sortDirection').setAttribute('aria-label', $('sortDirection').dataset.tooltip);
  $('listView').setAttribute('aria-pressed', String(libraryView !== 'grid'));
  $('gridView').setAttribute('aria-pressed', String(libraryView === 'grid'));
  const sig = JSON.stringify([movies, libraryView, localOnline, browse.query.trim(), browse.attention, browse.folder]);
  if (sig !== catalogueSig) {
    catalogueSig = sig;
    const watchedFocus = document.activeElement?.dataset.watched;
    // Keep unchanged cards, decoded posters and keyboard focus during background enrichment.
    let list = $('libbody').querySelector('.movie-list');
    if (movies.length) {
      if (!list) { $('libbody').innerHTML = '<ul class="movie-list"></ul>'; list = $('libbody').firstElementChild; }
      list.className = 'movie-list ' + (libraryView === 'grid' ? 'grid' : 'list');
      const existing = new Map([...list.children].map(el => [el.dataset.id, el]));
      for (const [index, m] of movies.entries()) {
        const item = existing.get(m.id) || document.createElement('li');
        item.className = 'movie-card'; item.dataset.id = m.id;
        const collection = browse.query.trim() && catalogue.folders.find(f => f.id === m.collection_path);
        const reasons = browse.attention ? movieAttention(m) : [];
        const html = `<div class="poster-shell"><div class="poster-cover"><a href="#/movie/${esc(m.id)}" aria-label="Details for ${esc(m.title)}, ${m.watched ? 'watched' : 'unwatched'}">${poster(m)}</a>${watchedCorner(m, !localOnline)}</div><div class="movie-actions"><button data-local="${esc(m.id)}" data-tooltip="Open in default player" aria-label="Open ${esc(m.title)} in default player" ${!localOnline ? 'disabled' : ''}>${glyph('play')}</button><button data-cast="${esc(m.id)}" data-tooltip="Play on TV" aria-label="Play ${esc(m.title)} on TV" ${!localOnline ? 'disabled' : ''}>${glyph('cast')}</button></div></div><div class="movie-copy"><a class="movie-name" title="${esc(m.title)}" href="#/movie/${esc(m.id)}">${esc(m.title)}</a>${movieMeta(m)}${collection ? `<a class="movie-collection" data-folder href="${esc(listHash({...browse, query:'', folder:collection.id}))}">${esc(collection.name)}</a>` : ''}${reasons.length ? `<p class="attention-reason">${esc(reasons.join(' · '))}</p>` : ''}</div>`;
        if (item._html !== html) { item.innerHTML = html; item._html = html; }
        if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null);
        existing.delete(m.id);
      }
      for (const item of existing.values()) item.remove();
    } else $('libbody').innerHTML = `<p class="empty">${catalogue.scanning ? 'Finding your movies…' : visible.folders.length ? '' : catalogue.library.length ? 'No matching movies. Clear a filter or try another search.' : 'No movies found. Add a folder in Settings, then rescan.'}</p>`;
    if (watchedFocus && !document.activeElement?.dataset.watched) [...$('libbody').querySelectorAll('[data-watched]')].find(b => b.dataset.watched === watchedFocus)?.focus({preventScroll:true});
  }
  $('rescan').disabled = !localOnline || catalogue.scanning;
  $('rescan').innerHTML = glyph('scan');
  $('refreshMetadata').innerHTML = glyph('refresh');
  $('refreshMetadata').disabled = !localOnline || !!catalogue.metadata.pending;
  const notes = [];
  if (!catalogue.ffprobe) notes.push('File runtimes need ffprobe. Install FFmpeg, then restart TV Cast when nothing is casting.');
  if (catalogue.checking) notes.push(`Reading file information (${catalogue.checking} left)…`);
  if (!catalogue.metadata.configured) notes.push('Add TMDB in Settings for posters and movie information.');
  else if (catalogue.metadata.pending) notes.push(`Fetching movie information (${catalogue.metadata.pending} left)…`);
  if (catalogue.metadata.error) notes.push(catalogue.metadata.error);
  if (catalogue.libraries.some(l => l.problems.length)) notes.push('Some folders are unavailable. See Settings.');
  $('libraryNote').textContent = notes.join(' ');
  const folders = JSON.stringify(catalogue.libraries);
  if (folderSig !== folders) {
    folderSig = folders;
    $('folders').innerHTML = catalogue.libraries.map(l => `<span class="folder"><span title="${esc(l.path)}">${esc(l.name)}</span><button class="icon-button" data-remove="${esc(l.path)}" data-tooltip="Remove folder from library" aria-label="Remove ${esc(l.name)} from library"><span class="icon icon-x" aria-hidden="true"></span></button></span>`).join('');
    $('folderNotes').innerHTML = catalogue.libraries.map(l => l.problems.map(p => `<p class="msg">${esc(l.name)}: ${esc(p)}</p>`).join('') + l.private.map(p => `<p class="note">Skipped ${esc(l.name + '/' + p)}: macOS restricted access.</p>`).join('')).join('');
  }
  $('metadataStatus').textContent = catalogue.metadata.error || (catalogue.metadata.configured ? 'TMDB configured. Downloaded information is available offline.' : 'TMDB is not connected.');
  $('removeToken').disabled = !catalogue.metadata.configured;
  renderCredential();
  const selected = catalogue.library.find(m => m.id === movieId());
  if (selected) renderMovie(selected);
}
function renderCredential() {
  const configured = !!catalogue?.metadata.configured;
  const masked = configured && !editingToken;
  const mode = masked ? 'saved' : configured ? 'replace' : 'new';
  if (credentialMode !== mode) { $('tmdbToken').value = masked ? '••••••••••••' : ''; credentialMode = mode; }
  $('tmdbToken').readOnly = masked;
  $('tmdbToken').placeholder = configured ? 'Paste replacement token' : 'Paste your token';
  $('saveToken').textContent = masked ? 'Replace token' : 'Save token';
  $('cancelTokenEdit').hidden = !configured || !editingToken;
}
function renderFolders(folders) {
  $('showCollections').checked = !browse.recursive;
  const ancestors = [];
  let folder = catalogue.folders.find(f => f.id === browse.folder);
  while (folder) { ancestors.unshift(folder); folder = catalogue.folders.find(f => f.id === folder.parent); }
  const crumbs = [{id:'', name:'Library'}, ...ancestors];
  const breadcrumbHTML = crumbs.map((f, i) => `${i ? glyph('next') : ''}<a data-folder href="${esc(listHash({...browse, folder:f.id}))}" ${i === crumbs.length - 1 ? 'aria-current="page"' : ''}>${esc(f.name)}</a>`).join('');
  if ($('breadcrumbs').innerHTML !== breadcrumbHTML) $('breadcrumbs').innerHTML = breadcrumbHTML;
  const html = folders.length ? '<ul class="collection-list">' + folders.map(f => `<li><a data-folder href="${esc(listHash({...browse, folder:f.id}))}"><span class="collection-art">${f.movies.slice(0, 3).map(poster).join('')}</span><span class="collection-copy"><strong>${glyph('folder')}${esc(f.name)}</strong><span>${f.movies.length} ${f.movies.length === 1 ? 'movie' : 'movies'}</span></span>${glyph('next')}</a></li>`).join('') + '</ul>' : '';
  if ($('folderbody')._html !== html) { $('folderbody').innerHTML = html; $('folderbody')._html = html; }
}
async function refreshLibrary() {
  const generation = ++libraryRequest;
  try {
    const next = await request('/api/library', {}, 10000);
    if (generation !== libraryRequest) return;
    catalogue = next; localOnline = true;
    renderLibrary();
    if ($('libmsg').dataset.connection) { show('libmsg', ''); delete $('libmsg').dataset.connection; }
  } catch (e) {
    if (generation !== libraryRequest) return;
    localOnline = false; renderLibrary();
    show('libmsg', 'Cannot reach TV Cast. Start it with “tv install”, then reload.');
    $('libmsg').dataset.connection = '1';
  }
}
async function libraryPoll() {
  if (!isTV()) await refreshLibrary();
  setTimeout(libraryPoll, document.hidden ? 10000 : 2500);
}
function browseLinks(values, kind) {
  return (values || []).map(value => `<button class="metadata-link" data-browse-${kind}="${esc(value)}">${esc(value)}</button>`).join('') || '—';
}
function renderMovie(m) {
  if (movieId() !== m.id) return;
  detailMovie = m;
  const sig = JSON.stringify(m);
  if (detailSig === sig) return;
  const focusedToggle = $('movieContent').querySelector('[data-watched]:focus');
  const watchedFocused = focusedToggle ? '.poster-watched' : null;
  detailSig = sig;
  const matched = !!m.tmdb_id;
  const websites = `<nav class="movie-websites" aria-label="Movie websites">${movieLinks(m).map(link => `<a href="${esc(link.href)}" data-tooltip="${esc(link.label)}" aria-label="${esc(link.label)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><use ${link.site === 'letterboxd' ? 'class="brand-logo-light"' : ''} href="/icons.svg#brand-${link.site}"></use>${link.site === 'letterboxd' ? '<use class="brand-logo-dark" href="/icons.svg#brand-letterboxd-dark"></use>' : ''}</svg></a>`).join('')}</nav>`;
  $('movieContent').innerHTML = `<article class="movie-detail"><div class="poster-cover">${poster(m)}${watchedCorner(m)}</div><div class="detail-copy"><div class="detail-heading"><h2 tabindex="-1">${esc(m.title)}</h2>${movieMeta(m)}</div><div class="detail-body"><div class="detail-buttons"><button class="primary" data-local="${esc(m.id)}">Open in default player</button><button data-cast="${esc(m.id)}">Play on TV</button><button data-add-queue="${esc(m.id)}">Add to TV queue</button></div>${websites}${m.position >= RESUME_MIN ? `<p class="note">TV resume point: ${clock(m.position)}. <button class="link-button" data-cast="${esc(m.id)}" data-from-start="true">Start over on TV</button></p>` : ''}<p class="synopsis">${esc(m.overview || (matched ? 'No synopsis available.' : m.match?.reason || 'Movie information is not available yet. Use Correct match to identify this film.'))}</p><dl><dt>Genres</dt><dd>${browseLinks(m.genres, 'genre')}</dd><dt>Director</dt><dd>${browseLinks(m.directors, 'person')}</dd><dt>Cast</dt><dd>${browseLinks(m.cast, 'person')}</dd>${m.score != null ? `<dt>Rating</dt><dd>TMDB ${Number(m.score).toFixed(1)} / 10 (${Number(m.vote_count).toLocaleString()} votes)</dd>` : ''}${m.tmdb_runtime_min ? `<dt>TMDB runtime</dt><dd>${esc(m.tmdb_runtime_min)} min (reference)</dd>` : ''}</dl><p class="file">${esc(m.filename)}</p>${m.problem ? `<p class="note warn">TV compatibility: ${esc(m.problem)}</p>` : ''}${m.match?.error ? `<p class="msg">${esc(m.match.error)}</p>` : ''}<div class="detail-secondary"><button class="link-button" data-reveal="${esc(m.id)}">Reveal in Finder</button><button class="link-button" data-correct="${esc(m.id)}">Correct match</button><button class="link-button" data-refresh="${esc(m.id)}">Refresh metadata</button></div></div></div></article>`;
  if (watchedFocused) $('movieContent').querySelector(watchedFocused).focus({preventScroll:true});
}
async function loadMovie(id) {
  const generation = ++detailRequest;
  $('movieContent').textContent = 'Loading movie…'; detailSig = ''; detailMovie = null;
  show('moviemsg', '');
  try {
    const movie = await request('/api/movies/' + encodeURIComponent(id));
    if (generation !== detailRequest || movieId() !== id) return;
    renderMovie(movie);
    $('movieContent').querySelector('h2')?.focus({preventScroll:true});
  } catch (e) {
    if (generation !== detailRequest || movieId() !== id) return;
    $('movieContent').textContent = ''; show('moviemsg', e.message);
  }
}
function route() {
  const previous = currentRoute;
  currentRoute = isTV() ? 'tv' : movieId() ? 'movie' : 'library';
  $('libraryPage').hidden = currentRoute !== 'library';
  $('moviePage').hidden = currentRoute !== 'movie';
  $('tvPage').hidden = currentRoute !== 'tv';
  $('libraryTab').setAttribute('aria-current', currentRoute === 'tv' ? 'false' : 'page');
  $('tvTab').setAttribute('aria-current', currentRoute === 'tv' ? 'page' : 'false');
  document.title = currentRoute === 'tv' ? 'TV — TV Cast' : 'Library — TV Cast';
  if (currentRoute === 'library') {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    browse = {...browse, query:params.get('query') || '', genre:params.get('genre') || '', person:params.get('person') || '', watched:params.get('watched') || 'all', attention:params.get('attention') === 'true', folder:params.get('folder') || '', recursive:params.has('sort') ? params.get('recursive') === 'true' : browse.recursive, sort:params.get('sort') || browse.sort, descending:params.has('sort') ? params.get('descending') === 'true' : browse.descending};
    if (!['title', 'file_runtime_s', 'year', 'score'].includes(browse.sort)) browse.sort = 'title';
    $('search').value = browse.query; sortPicker.setValue(browse.sort); watchedPicker.setValue(browse.watched); peoplePicker.setValue(browse.person);
    libraryHref = listHash(); updateLibraryLinks(); renderLibrary();
    const href = location.hash;
    // New collection entries start at the top; history entries retain their own scroll position.
    const scroll = Number(history.state?.scroll ?? (previous === 'library' ? 0 : stored(sessionStorage, 'library.scroll', '0')));
    refreshLibrary().then(() => { if (currentRoute === 'library' && location.hash === href) window.scrollTo(0, scroll); });
  } else {
    window.scrollTo(0, 0);
    if (currentRoute === 'movie') loadMovie(movieId());
    else refresh();
  }
}
async function localAction(action, body, area = movieId() ? 'moviemsg' : 'libmsg') {
  const key = action + ':' + (body.id || '');
  if (localBusy.has(key)) return null;
  localBusy.add(key); show(area, '');
  try {
    const result = await api(action, body);
    await refreshLibrary();
    return result;
  } catch (e) { show(area, e.message); return null; }
  finally { localBusy.delete(key); }
}
let watchedUndo = null, watchedUndoTimer;
function dismissWatchedNotice() {
  if ($('watchedNotice').contains(document.activeElement)) {
    watchedUndoTimer = setTimeout(dismissWatchedNotice, 8000);
    return;
  }
  $('watchedNotice').hidden = true; watchedUndo = null;
}
async function toggleWatched(id) {
  if (localBusy.has('watched:' + id)) return;
  const movie = catalogue?.library.find(m => m.id === id) || (detailMovie?.id === id ? detailMovie : null);
  if (!movie) return;
  const previous = !!movie.watched;
  if (!await localAction('watched', {id, watched:!previous})) return;
  watchedUndo = {id, watched:previous};
  $('watchedNotice').hidden = false;
  $('watchedNoticeText').textContent = `${movie.title} marked ${previous ? 'unwatched' : 'watched'}.`;
  clearTimeout(watchedUndoTimer); watchedUndoTimer = setTimeout(dismissWatchedNotice, 8000);
  if (document.activeElement === document.body) $('undoWatched').focus({preventScroll:true});
}
$('undoWatched').onclick = async () => {
  const change = watchedUndo;
  if (!change || localBusy.has('watched:' + change.id)) return;
  $('undoWatched').disabled = true;
  try {
    if (await localAction('watched', change) && watchedUndo === change) {
      const focused = document.activeElement === $('undoWatched') || document.activeElement === document.body;
      clearTimeout(watchedUndoTimer); watchedUndo = null; $('watchedNotice').hidden = true;
      if (focused) [...document.querySelectorAll('[data-watched]')].find(b => b.dataset.watched === change.id && b.closest('section:not([hidden])'))?.focus({preventScroll:true});
    }
  } finally { $('undoWatched').disabled = false; }
};
document.addEventListener('keydown', event => {
  if (!watchedUndo || isTV() || event.defaultPrevented || event.shiftKey || event.altKey
      || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z'
      || event.target.closest('input, textarea, [contenteditable]')) return;
  event.preventDefault(); $('undoWatched').click();
});
function renderCastRequest() {
  $('castRequest').hidden = !pendingCast;
  if (!pendingCast) return;
  $('castMessage').textContent = pendingCast.error || (pendingCast.sent ? `Opening ${pendingCast.title}…` : `Choose a TV to play ${pendingCast.title}.`);
  $('retryCast').hidden = !pendingCast.error;
  $('cancelCast').hidden = pendingCast.sent;
}
async function sendCast() {
  if (!pendingCast || pendingCast.sent || castSending) return;
  const job = pendingCast;
  job.sent = true; job.error = null; castSending = true; opening = job.id;
  renderCastRequest(); if (st) renderStatus();
  try {
    await api('open', {id:job.id, from_start:job.fromStart});
    if (pendingCast === job) pendingCast = null;
  } catch (e) {
    if (pendingCast === job) { job.error = e.message; job.sent = false; }
  } finally {
    castSending = false; opening = null; renderCastRequest();
    if (isTV()) await refresh();
    if (pendingCast && pendingCast !== job) continueCast();
  }
}
function continueCast() {
  if (pendingCast && !pendingCast.error && st?.selected) sendCast();
}
async function startCast(id, fromStart = false) {
  // The catalogue isn't loaded until the Library opens, and the TV tab casts from its status.
  const movie = catalogue?.library.find(m => m.id === id) || st?.library.find(m => m.id === id) || detailMovie;
  if (!movie) return;
  if (movie.problem && !confirm(`TV compatibility: ${movie.problem}. Try playing anyway?`)) return;
  if (currentRoute === 'library') saveBrowsing();
  const job = {id, title:movie.title, fromStart, sent:false, error:null};
  pendingCast = job; location.hash = '#/tv'; renderCastRequest();
  await refreshLibrary();
  if (pendingCast === job && catalogue?.selected) sendCast();
}
$('retryCast').onclick = () => { if (pendingCast) { pendingCast.error = null; continueCast(); renderCastRequest(); } };
$('cancelCast').onclick = () => { pendingCast = null; renderCastRequest(); };

function changeBrowsing() {
  browse.query = $('search').value; browse.sort = $('sort').value; browse.genre = $('genre').value;
  browse.watched = $('filter').value; browse.person = $('person').value;
  remember(localStorage, 'library.sort', browse.sort); remember(localStorage, 'library.descending', String(browse.descending));
  saveBrowsing(); renderLibrary();
}
$('search').oninput = changeBrowsing;
$('sortDirection').onclick = () => { browse.descending = !browse.descending; changeBrowsing(); };
for (const view of ['list', 'grid']) $(view + 'View').onclick = () => { libraryView = view; remember(localStorage, 'library.view', view); renderLibrary(); };
$('clearFilters').onclick = () => { genrePicker.setValue(''); peoplePicker.setValue(''); watchedPicker.setValue('all'); browse.attention = false; changeBrowsing(); };
$('attentionFilter').onclick = () => { browse.attention = !browse.attention; changeBrowsing(); };
$('clearPerson').onclick = () => { peoplePicker.setValue(''); changeBrowsing(); $('person').focus(); peoplePicker.close(); };
$('rescan').onclick = () => localAction('rescan', {});
$('showCollections').onchange = () => { browse.recursive = !$('showCollections').checked; remember(localStorage, 'library.recursive', String(browse.recursive)); changeBrowsing(); };
$('refreshMetadata').onclick = () => { if (!catalogue?.metadata.configured) $('librarySettings').showModal(); else localAction('metadata_refresh_all', {}); };
$('settingsButton').onclick = () => { show('settingsmsg', ''); $('librarySettings').showModal(); };
for (const dialog of document.querySelectorAll('dialog')) {
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  // Releasing a text-selection drag outside the dialog must not dismiss it.
  let startedOutside = false;
  dialog.addEventListener('pointerdown', event => { startedOutside = event.target === dialog && outside(event); });
  dialog.addEventListener('click', event => {
    if (startedOutside && event.target === dialog && outside(event)) dialog.close();
    startedOutside = false;
  });
}
$('addFolder').onclick = async () => { $('addFolder').disabled = true; await localAction('add_folder', {}, 'settingsmsg'); $('addFolder').disabled = false; };
$('folders').onclick = e => { const b = e.target.closest('[data-remove]'); if (b) localAction('remove_folder', {path:b.dataset.remove}, 'settingsmsg'); };
$('metadataSetup').onsubmit = async e => {
  e.preventDefault();
  if (catalogue?.metadata.configured && !editingToken) { editingToken = true; renderCredential(); $('tmdbToken').focus(); return; }
  const token = $('tmdbToken').value.trim();
  if (!token) { show('settingsmsg', 'Paste a TMDB API Read Access Token.'); return; }
  if (await localAction('metadata_configure', {token}, 'settingsmsg')) { editingToken = false; credentialMode = ''; renderCredential(); }
};
$('cancelTokenEdit').onclick = () => { editingToken = false; renderCredential(); show('settingsmsg', ''); };
$('removeToken').onclick = async () => { if (await localAction('metadata_configure', {token:''}, 'settingsmsg')) { editingToken = false; renderCredential(); } };
$('matchSearch').onsubmit = async e => {
  e.preventDefault(); const target = matchMovieId, generation = ++matchSearchRequest; show('matchmsg', 'Searching…', true); $('matchResults').textContent = '';
  try {
    const result = await api('metadata_search', {title:$('matchQuery').value, year:$('matchYear').value});
    if (target !== matchMovieId || generation !== matchSearchRequest) return;
    show('matchmsg', result.more ? 'More results are available. Narrow the title or year.' : result.results.length ? '' : 'No matches. Try a different title or year.', true);
    $('matchResults').innerHTML = result.results.map(m => `<button class="match-candidate" data-match="${m.id}">${esc(m.title)} (${m.year || 'year unknown'})<span>${esc(m.overview.slice(0, 180))}</span></button>`).join('');
  } catch (e) { if (target === matchMovieId && generation === matchSearchRequest) show('matchmsg', e.message); }
};
async function chooseMatch(tmdb_id) {
  if (await localAction('metadata_match', {id:matchMovieId, tmdb_id}, 'matchmsg')) $('matchDialog').close();
}
$('matchResults').onclick = e => { const b = e.target.closest('[data-match]'); if (b) chooseMatch(Number(b.dataset.match)); };
$('leaveUnmatched').onclick = () => chooseMatch(null);
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (a && currentRoute === 'library') saveBrowsing();
  if (a?.hasAttribute('data-folder')) remember(sessionStorage, 'library.scroll', '0');
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.close) $(b.dataset.close).close();
  if (b.dataset.browseGenre || b.dataset.browsePerson) {
    // Start a fresh facet browse so an earlier title query cannot hide related movies.
    browse = {...browse, query:'', genre:b.dataset.browseGenre || '', person:b.dataset.browsePerson || '', watched:'all', attention:false, folder:'', recursive:true};
    libraryHref = listHash(); remember(sessionStorage, 'library.scroll', '0');
    location.hash = libraryHref; return;
  }
  if (b.dataset.local) localAction('open_local', {id:b.dataset.local});
  if (b.dataset.cast) startCast(b.dataset.cast, b.dataset.fromStart === 'true');
  if (b.dataset.reveal) localAction('reveal', {id:b.dataset.reveal});
  if (b.dataset.watched) toggleWatched(b.dataset.watched);
  if (b.dataset.addQueue) localAction('queue_add', {id:b.dataset.addQueue}).then(result => { if (result) show('moviemsg', 'Added to TV queue.', true); });
  if (b.dataset.refresh) {
    if (!catalogue?.metadata.configured) { $('librarySettings').showModal(); return; }
    localAction('metadata_refresh', {id:b.dataset.refresh}).then(result => { if (result) show('moviemsg', 'Refreshing movie information…', true); });
  }
  if (b.dataset.correct) {
    matchSearchRequest++;
    matchMovieId = b.dataset.correct; $('matchQuery').value = detailMovie.file_title; $('matchYear').value = detailMovie.year || '';
    $('matchResults').textContent = ''; show('matchmsg', ''); $('matchDialog').showModal();
  }
});
window.addEventListener('hashchange', route);
window.addEventListener('pagehide', () => { if (currentRoute === 'library') saveBrowsing(); });
history.scrollRestoration = 'manual';
if (!location.hash) history.replaceState(null, '', '#/library');
route(); poll(); setTimeout(libraryPoll, 2500);
