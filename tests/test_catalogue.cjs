const assert = require('node:assert/strict');
const {test} = require('node:test');
const {selectMovies, defaultSortDescending, groupMovies, browseCollection, playHistory, movieLinks, movieAttention} = require('../tvcast/catalogue.js');
const movies = [
  {id:'a', title:'Éxample', file_title:'Original title', year:2001, file_runtime_s:7200, score:8, genres:['Drama'], watched:false},
  {id:'b', title:'Another', year:2002, file_runtime_s:5400, score:7, genres:['Comedy'], watched:true},
  {id:'c', title:'Example extended', year:2001, file_runtime_s:null, score:null, genres:['Drama'], watched:false},
];
test('movie websites use exact identifiers and safely encoded searches when unmatched', () => {
  const direct = movieLinks({title:'Example', imdb_id:'tt1234567', tmdb_id:42});
  assert.deepEqual(direct, [
    {site:'imdb', label:'IMDb', href:'https://www.imdb.com/title/tt1234567/'},
    {site:'letterboxd', label:'Letterboxd', href:'https://letterboxd.com/tmdb/42/'},
    {site:'tmdb', label:'TMDB', href:'https://www.themoviedb.org/movie/42'},
  ]);
  assert.equal(movieLinks({imdb_id:'tt1234567'})[1].href, 'https://letterboxd.com/imdb/tt1234567/');
  const fallback = movieLinks({title:'A & B / 名', year:2001, imdb_id:'tt1/../../bad', tmdb_id:-1});
  assert.equal(fallback[0].label, 'Search IMDb');
  assert.equal(new URL(fallback[0].href).searchParams.get('q'), 'A & B / 名 2001');
  assert.equal(fallback[1].label, 'Search Letterboxd');
  assert.equal(decodeURIComponent(new URL(fallback[1].href).pathname.slice('/search/films/'.length, -1)), 'A & B / 名 2001');
  assert.equal(fallback[2].label, 'Search TMDB');
  assert.equal(new URL(fallback[2].href).searchParams.get('query'), 'A & B / 名 2001');
  assert.equal(movieLinks({file_title:'Example'})[2].href, 'https://www.themoviedb.org/search/movie?query=Example');
});
test('runtime and score sorts place unknown values last in either direction', () => {
  for (const sort of ['file_runtime_s', 'score']) {
    assert.deepEqual(selectMovies(movies, {sort, descending:false}).map(m => m.id), ['b','a','c']);
    assert.deepEqual(selectMovies(movies, {sort, descending:true}).map(m => m.id), ['a','b','c']);
  }
});
test('Wikipedia appears only for a verified English article URL', () => {
  const url = 'https://en.wikipedia.org/wiki/Example_(film)';
  assert.deepEqual(movieLinks({wikipedia_url:url}).at(-1), {site:'wikipedia', label:'Wikipedia', href:url});
  for (const wikipedia_url of [null, '', 'javascript:alert(1)', 'http://en.wikipedia.org/wiki/Film',
    'https://en.wikipedia.org.evil/wiki/Film', 'https://en.wikipedia.org@evil.test/wiki/Film',
    'https://en.wikipedia.org/wiki/', 'https://en.wikipedia.org/wiki/Film\n']) {
    assert.equal(movieLinks({wikipedia_url}).some(link => link.site === 'wikipedia'), false);
  }
});
test('sort defaults use shorter runtimes, newer releases and higher ratings', () => {
  assert.equal(defaultSortDescending('title'), false);
  assert.equal(defaultSortDescending('file_runtime_s'), false);
  assert.deepEqual(selectMovies(movies, {sort:'year'}).map(m => m.id), ['b','a','c']);
  assert.deepEqual(selectMovies(movies, {sort:'score'}).map(m => m.id), ['a','b','c']);
});
test('people filtering includes directors and cast and combines with genres', () => {
  const items = [
    {...movies[0], directors:['Cary Joji Fukunaga'], cast:['Daniel Craig', 'Léa Seydoux']},
    {...movies[1], directors:['Another Director'], cast:['Daniel Craig']},
  ];
  assert.equal(selectMovies(items, {person:'Daniel Craig'}).length, 2);
  assert.equal(selectMovies(items, {person:'lea seydoux', genre:'Drama'})[0].id, 'a');
  assert.equal(selectMovies(items, {person:'fukunaga'})[0].id, 'a');
  assert.equal(selectMovies(items, {person:'Daniel Craig', genre:'Drama'}).length, 1);
});
test('age ratings filter by exact US certification or its absence and combine with genres', () => {
  const entries = [{...movies[0], certification:'PG-13'}, {...movies[1], certification:'R'}, {...movies[2], certification:null}, {...movies[2], id:'d'}];
  assert.deepEqual(selectMovies(entries, {certification:'PG-13'}).map(m => m.id), ['a']);
  assert.deepEqual(selectMovies(entries, {certification:'PG'}), []);
  assert.deepEqual(selectMovies(entries, {certification:'none'}).map(m => m.id), ['c', 'd']);
  assert.deepEqual(selectMovies(entries, {certification:'R', genre:'Drama'}), []);
  assert.deepEqual(selectMovies(entries, {certification:'none', genre:'Drama'}).map(m => m.id), ['c', 'd']);
});
test('film collections filter by provider ID across folders and combine with other filters', () => {
  const entries = [
    {...movies[0], languages:[{code:'en',name:'English'},{code:'hi',name:'Hindi'}], collection:{id:42,name:'Example Collection'}, root:'/movies', collection_path:'/movies/Part One'},
    {...movies[1], languages:[{code:'en',name:'English'}], collection:{id:42,name:'Example Collection'}, root:'/movies', collection_path:'/movies/Part Two'},
    {...movies[2], collection:{id:43,name:'Example Collection'}, root:'/movies', collection_path:'/movies'},
    {...movies[2], id:'d', collection:null, root:'/movies', collection_path:'/movies'},
    {...movies[2], id:'e', root:'/movies', collection_path:'/movies'},
  ];
  const matched = selectMovies(entries, {collection:'42'});
  assert.deepEqual(matched.map(m => m.id), ['b', 'a']);
  assert.deepEqual(browseCollection(matched, [], {collection:'42'}), {movies:matched, folders:[]});
  assert.deepEqual(selectMovies(entries, {collection:'42', genre:'Drama', watched:'unwatched'}).map(m => m.id), ['a']);
  assert.deepEqual(selectMovies(entries, {collection:'missing'}), []);
  assert.deepEqual(selectMovies(entries, {collection:'none'}).map(m => m.id), ['d', 'e']);
  assert.deepEqual(selectMovies(entries, {language:'hi'}).map(m => m.id), ['a']);
  assert.deepEqual(selectMovies(entries, {language:'en', collection:'42', watched:'watched'}).map(m => m.id), ['b']);
  assert.deepEqual(selectMovies(entries, {language:'en', collection:'none'}), []);
});
test('filters intersect, search includes original names, and separate editions remain separate', () => {
  assert.deepEqual(selectMovies(movies, {query:'example', genre:'Drama', watched:'unwatched'}).map(m => m.id), ['a','c']);
  assert.deepEqual(selectMovies(movies, {query:'original'}).map(m => m.id), ['a']);
  assert.equal(selectMovies(movies, {genre:'Drama', watched:'watched'}).length, 0);
  assert.equal(movies[0].id, 'a');
});

test('collection browsing keeps direct films and child folders separate, including nested collections', () => {
  const entries = [
    {...movies[0], root:'/movies', collection_path:'/movies'},
    {...movies[1], root:'/movies', collection_path:'/movies/Series'},
    {...movies[2], root:'/movies', collection_path:'/movies/Series/Trilogy'},
    {id:'d', title:'Other', root:'/movies', collection_path:'/movies/Series extended'},
    {id:'e', title:'Second root', root:'/other', collection_path:'/other'},
  ];
  const folders = [
    {id:'/movies/Series', parent:'/movies', root:'/movies', name:'Series'},
    {id:'/movies/Series/Trilogy', parent:'/movies/Series', root:'/movies', name:'Trilogy'},
    {id:'/movies/Series extended', parent:'/movies', root:'/movies', name:'Series extended'},
  ];
  const root = browseCollection(entries, folders, {});
  assert.deepEqual(root.movies.map(m => m.id), ['a', 'e']);
  assert.deepEqual(root.folders.map(f => [f.name, f.movies.length]), [['Series', 2], ['Series extended', 1]]);
  const series = browseCollection(entries, folders, {folder:'/movies/Series'});
  assert.deepEqual(series.movies.map(m => m.id), ['b']);
  assert.deepEqual(series.folders.map(f => f.name), ['Trilogy']);
  const recursive = browseCollection(entries, folders, {folder:'/movies/Series', recursive:true});
  assert.deepEqual(recursive.movies.map(m => m.id), ['b', 'c']);
  assert.deepEqual(recursive.folders, []);
  const filtered = browseCollection(selectMovies(entries, {query:'extended'}), folders, {});
  assert.equal(filtered.movies.length, 0);
  assert.deepEqual(filtered.folders.map(f => [f.name, f.movies.length]), [['Series', 1]]);
});

test('search shows matching movies directly across collections and retains the current folder scope', () => {
  const entries = [
    {...movies[0], root:'/movies', collection_path:'/movies/Series'},
    {...movies[2], root:'/movies', collection_path:'/movies/Series/Trilogy'},
    {...movies[0], id:'d', root:'/movies', collection_path:'/movies/Series extended'},
  ];
  const folders = [{id:'/movies/Series', parent:'/movies', root:'/movies', name:'Series'}];
  const matches = selectMovies(entries, {query:'example'});
  assert.deepEqual(browseCollection(matches, folders, {query:'example'}), {movies:matches, folders:[]});
  assert.deepEqual(browseCollection(matches, folders, {query:'example', folder:'/movies/Series'}).movies.map(m => m.id), ['a', 'c']);
  assert.deepEqual(browseCollection(matches, folders, {query:'  '}).movies, []);
});

test('attention combines actionable metadata issues with filters and respects explicit unmatched choices', () => {
  const entries = [
    {...movies[0], match:{status:'unmatched', source:'auto'}, cast:['Actor'], root:'/movies', collection_path:'/movies/Series'},
    {...movies[1], match:{status:'error', error:'Timed out'}, root:'/movies', collection_path:'/movies'},
    {...movies[2], tmdb_id:42, poster:null, match:{status:'matched'}, root:'/movies', collection_path:'/movies'},
    {...movies[0], id:'d', match:{source:'none', status:'unmatched'}},
    {...movies[0], id:'e', match:{status:'pending'}},
    {...movies[0], id:'f', tmdb_id:43, poster:'/api/posters/43', match:{status:'matched'}},
  ];
  assert.deepEqual(entries.map(movieAttention), [['Match needed'], ['Metadata unavailable'], ['Poster missing'], [], [], []]);
  assert.deepEqual(movieAttention({}), []);
  assert.deepEqual(movieAttention({match:{error:'Unavailable'}, tmdb_id:1}), ['Metadata unavailable', 'Poster missing']);
  const attention = selectMovies(entries, {attention:true});
  assert.deepEqual(attention.map(m => m.id), ['b', 'a', 'c']);
  assert.deepEqual(browseCollection(attention, [], {attention:true}).movies, attention);
  assert.deepEqual(selectMovies(entries, {attention:true, genre:'Drama', watched:'unwatched', person:'Actor', query:'original'}).map(m => m.id), ['a']);
});
test('grouping follows the sorted order for letters, digits, symbols, and unknown values', () => {
  const titles = [
    {id:'bang', title:'!Bang'},
    {id:'hash', title:'#Hash'},
    {id:'two', title:'2 Fast'},
    {id:'ten', title:'10 Things'},
    {id:'amelie', title:'Amélie'},
    {id:'another', title:'another'},
    {id:'example', title:'Éxample'},
    {id:'zoo', title:'Zoo'},
    {id:'cyr', title:'Лето'},
  ].map(movie => ({...movie, year:2001}));
  const labels = (sort, descending, yearSpan) => groupMovies(selectMovies(titles, {sort, descending}), sort, {yearSpan}).map(group => [group.label, group.movies.map(m => m.id)]);
  assert.deepEqual(labels('title', false), [['!', ['bang']], ['#', ['hash']], ['0–9', ['ten', 'two']], ['A', ['amelie', 'another']], ['E', ['example']], ['Z', ['zoo']], ['Л', ['cyr']]]);
  assert.deepEqual(labels('title', true).map(([label]) => label), ['Л', 'Z', 'E', 'A', '0–9', '#', '!']);
  const ligatures = [
    {id:'aardvark', title:'Aardvark', year:2001},
    {id:'aeon', title:'Æon', year:2001},
    {id:'apple', title:'Apple', year:2001},
    {id:'open', title:'Open', year:2001},
    {id:'oeuvre', title:'Œuvre', year:2001},
  ];
  const ligatureGroups = (descending) => groupMovies(selectMovies(ligatures, {sort:'title', descending}), 'title').map(group => [group.label, group.movies.map(movie => movie.id)]);
  assert.deepEqual(ligatureGroups(false), [['A', ['aardvark', 'aeon', 'apple']], ['O', ['oeuvre', 'open']]]);
  assert.deepEqual(ligatureGroups(true), [['O', ['open', 'oeuvre']], ['A', ['apple', 'aeon', 'aardvark']]]);
  const measured = [
    {id:'short', title:'Short', file_runtime_s:29 * 60, year:1999, score:7},
    {id:'half', title:'Half', file_runtime_s:30 * 60, year:1990, score:7.49},
    {id:'feature', title:'Feature', file_runtime_s:90 * 60, year:2001, score:7.5},
    {id:'long', title:'Long', file_runtime_s:120 * 60, year:2014, score:10},
    {id:'unknown', title:'Unknown', file_runtime_s:null, year:null, score:null},
  ];
  const sections = (sort, descending, yearSpan) => groupMovies(selectMovies(measured, {sort, descending}), sort, {yearSpan}).map(group => [group.label, group.movies.map(m => m.id)]);
  assert.deepEqual(sections('file_runtime_s', false), [['0–30 min', ['short']], ['30 min–1h', ['half']], ['1h 30m–2h', ['feature']], ['2h–2h 30m', ['long']], ['Runtime unknown', ['unknown']]]);
  assert.deepEqual(sections('file_runtime_s', true).at(-1), ['Runtime unknown', ['unknown']]);
  assert.deepEqual(sections('year', false), [['1990', ['half']], ['1999', ['short']], ['2001', ['feature']], ['2014', ['long']], ['Year unknown', ['unknown']]]);
  assert.deepEqual(sections('year', true, 'decade'), [['2010s', ['long']], ['2000s', ['feature']], ['1990s', ['short', 'half']], ['Year unknown', ['unknown']]]);
  assert.deepEqual(sections('score', false), [['7.0–7.5', ['short', 'half']], ['7.5–8.0', ['feature']], ['9.5–10.0', ['long']], ['Unrated', ['unknown']]]);
  assert.deepEqual(sections('score', true)[0][0], '9.5–10.0');
  assert.deepEqual(sections('score', true).at(-1)[0], 'Unrated');
});
test('play history lists played movies newest first, without the one playing', () => {
  const played = [{id:'a', updated:10}, {id:'b', updated:30}, {id:'c', updated:20}, {id:'d', updated:null}];
  assert.deepEqual(playHistory(played).map(m => m.id), ['b', 'c', 'a']);
  assert.deepEqual(playHistory(played, 'b').map(m => m.id), ['c', 'a']);
  assert.deepEqual(playHistory(played, null, 2).map(m => m.id), ['b', 'c']);
});
