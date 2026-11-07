/* Catalogue ordering is independent of TV state and of the rendered view. */
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
function selectMovies(movies, {query = '', sort = 'title', descending = defaultSortDescending(sort), genre = '', person = '', watched = 'all', attention = false} = {}) {
  const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  query = normalize(query).trim();
  return movies.filter(m => (!query || normalize([m.title, m.file_title, m.original_title, m.year].join(' ')).includes(query))
    && (!genre || (m.genres || []).includes(genre))
    && (!person || [...(m.directors || []), ...(m.cast || [])].some(name => normalize(name).includes(normalize(person).trim())))
    && (!attention || movieAttention(m).length)
    && (watched === 'all' || m.watched === (watched === 'watched'))).sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (x == null || y == null) return x == null ? (y == null ? a.title.localeCompare(b.title) : 1) : -1;
      const order = sort === 'title' ? normalize(x).localeCompare(normalize(y)) : x - y;
      return order * (descending ? -1 : 1) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
}
function browseCollection(movies, folders, {folder = '', recursive = false, query = '', attention = false} = {}) {
  const inside = (path, parent) => path === parent || path.startsWith(parent.replace(/\/$/, '') + '/');
  const scoped = movies.filter(m => !folder || inside(m.collection_path, folder));
  if (recursive || query.trim() || attention) return {movies:scoped, folders:[]};
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
  ];
}
if (typeof module !== 'undefined') module.exports = {selectMovies, defaultSortDescending, browseCollection, playHistory, movieLinks, movieAttention};
