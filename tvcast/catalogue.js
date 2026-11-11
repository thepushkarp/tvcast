/* Catalogue ordering is independent of TV state and of the rendered view. */
function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}
// US age ratings in increasing strictness, matching metadata.CERTIFICATIONS.
const CERTIFICATIONS = ['G', 'PG', 'PG-13', 'R', 'NC-17'];
function defaultSortDescending(sort) { return sort === 'year' || sort === 'score'; }
function movieAttention(movie) {
  const match = movie.match || {};
  if (match.source === 'none') return [];
  const reasons = [];
  if (match.status === 'unmatched') reasons.push('Match needed');
  if (match.status === 'error' || match.error) reasons.push('Metadata unavailable');
  if (movie.tmdb_id && !movie.poster) reasons.push('Poster missing');
  return reasons;
}
function selectMovies(movies, {query = '', sort = 'title', descending = defaultSortDescending(sort), genre = '', person = '', language = '', certification = '', collection = '', watched = 'all', attention = false} = {}) {
  query = normalize(query).trim();
  return movies.filter(m => (!query || normalize([m.title, m.file_title, m.original_title, m.year].join(' ')).includes(query))
    && (!genre || (m.genres || []).includes(genre))
    && (!person || [...(m.directors || []), ...(m.cast || [])].some(name => normalize(name).includes(normalize(person).trim())))
    && (!language || (m.languages || []).some(item => item.code === language))
    && (!certification || (certification === 'none' ? !m.certification : m.certification === certification))
    && (!collection || (collection === 'none' ? !m.collection : String(m.collection?.id) === String(collection)))
    && (!attention || movieAttention(m).length)
    && (watched === 'all' || m.watched === (watched === 'watched'))).sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (x == null || y == null) return x == null ? (y == null ? a.title.localeCompare(b.title) : 1) : -1;
      const order = sort === 'title' ? normalize(x).localeCompare(normalize(y)) : x - y;
      return order * (descending ? -1 : 1) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
}
function spanLabel(minutes) {
  if (!minutes) return '0';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
function titleLetter(character) {
  // Ligatures such as Æ sort among the letters they expand to, so the heading has to use that
  // same span. Otherwise one letter is split into repeated sections.
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < letters.length - 1; i++) {
    if (character.localeCompare(letters[i]) >= 0 && character.localeCompare(letters[i + 1]) < 0) return letters[i].toLocaleUpperCase();
  }
  if (character.localeCompare('z', undefined, {sensitivity:'base'}) === 0) return 'Z';
  return [...character.toLocaleUpperCase()][0] || character;
}
function movieGroup(movie, sort, yearSpan) {
  if (sort === 'title') {
    const character = [...normalize(movie.title).trim()][0] || '';
    if (!character) return {key:'title:', label:'…'};
    if (/\p{N}/u.test(character)) return {key:'title:0-9', label:'0–9'};
    if (/\p{L}/u.test(character)) {
      const letter = titleLetter(character);
      return {key:'title:' + letter, label:letter};
    }
    return {key:'title:' + character, label:character};
  }
  if (sort === 'file_runtime_s') {
    if (movie.file_runtime_s == null) return {key:'runtime:unknown', label:'Runtime unknown'};
    const start = Math.floor(movie.file_runtime_s / 1800) * 30;
    return {key:'runtime:' + start, label:start ? `${spanLabel(start)}–${spanLabel(start + 30)}` : '0–30 min'};
  }
  if (sort === 'year') {
    if (!movie.year) return {key:'year:unknown', label:'Year unknown'};
    if (yearSpan === 'decade') {
      const start = Math.floor(movie.year / 10) * 10;
      return {key:'decade:' + start, label:`${start}s`};
    }
    return {key:'year:' + movie.year, label:String(movie.year)};
  }
  if (movie.score == null) return {key:'score:unknown', label:'Unrated'};
  const tenths = Math.floor(Number(movie.score) * 10 + 1e-6);
  const start = Math.min(9.5, Math.floor(tenths / 5) * 0.5);
  return {key:'score:' + start, label:`${start.toFixed(1)}–${(start + 0.5).toFixed(1)}`};
}
function groupMovies(movies, sort, {yearSpan = 'year'} = {}) {
  const groups = [];
  for (const movie of movies) {
    const group = movieGroup(movie, sort, yearSpan);
    const last = groups.at(-1);
    if (!last || last.key !== group.key) groups.push({...group, movies:[movie]});
    else last.movies.push(movie);
  }
  return groups;
}
function browseCollection(movies, folders, {folder = '', recursive = false, query = '', attention = false, collection = ''} = {}) {
  const inside = (path, parent) => path === parent || path.startsWith(parent.replace(/\/$/, '') + '/');
  const scoped = movies.filter(m => !folder || inside(m.collection_path, folder));
  if (recursive || query.trim() || attention || collection) return {movies:scoped, folders:[]};
  const children = folders.filter(f => folder ? f.parent === folder : f.parent === f.root)
    .map(f => ({...f, movies:scoped.filter(m => inside(m.collection_path, f.id))}))
    .filter(f => f.movies.length).sort((a, b) => a.name.localeCompare(b.name));
  return {movies:scoped.filter(m => m.collection_path === (folder || m.root)), folders:children};
}
function playHistory(movies, playingId, limit = 8) {
  return movies.filter(m => m.updated && m.id !== playingId).sort((a, b) => b.updated - a.updated).slice(0, limit);
}
function movieLinks(movie) {
  const query = encodeURIComponent([movie.title || movie.file_title, movie.year].filter(Boolean).join(' '));
  const imdb = typeof movie.imdb_id === 'string' && /^tt\d+$/.test(movie.imdb_id) ? movie.imdb_id : null;
  const tmdb = Number.isSafeInteger(movie.tmdb_id) && movie.tmdb_id > 0 ? movie.tmdb_id : null;
  return [
    {site:'imdb', label:imdb ? 'IMDb' : 'Search IMDb', href:imdb ? `https://www.imdb.com/title/${imdb}/` : `https://www.imdb.com/find/?q=${query}`},
    {site:'letterboxd', label:tmdb || imdb ? 'Letterboxd' : 'Search Letterboxd', href:tmdb ? `https://letterboxd.com/tmdb/${tmdb}/` : imdb ? `https://letterboxd.com/imdb/${imdb}/` : `https://letterboxd.com/search/films/${query}/`},
    {site:'tmdb', label:tmdb ? 'TMDB' : 'Search TMDB', href:tmdb ? `https://www.themoviedb.org/movie/${tmdb}` : `https://www.themoviedb.org/search/movie?query=${query}`},
    ...(typeof movie.wikipedia_url === 'string' && /^https:\/\/en\.wikipedia\.org\/wiki\/[^\s?#]+$/.test(movie.wikipedia_url)
      ? [{site:'wikipedia', label:'Wikipedia', href:movie.wikipedia_url}] : []),
  ];
}
if (typeof module !== 'undefined') module.exports = {CERTIFICATIONS, selectMovies, defaultSortDescending, groupMovies, browseCollection, playHistory, movieLinks, movieAttention};
