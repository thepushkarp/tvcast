const assert = require('node:assert/strict');
const {test} = require('node:test');
const {selectMovies, defaultSortDescending, browseCollection, playHistory, movieLinks, movieAttention} = require('../tvcast/catalogue.js');
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
  ]);
  assert.equal(movieLinks({imdb_id:'tt1234567'})[1].href, 'https://letterboxd.com/imdb/tt1234567/');
  const fallback = movieLinks({title:'A & B / 名', year:2001, imdb_id:'tt1/../../bad', tmdb_id:-1});
  assert.equal(fallback[0].label, 'Search IMDb');
  assert.equal(new URL(fallback[0].href).searchParams.get('q'), 'A & B / 名 2001');
  assert.equal(fallback[1].label, 'Search Letterboxd');
  assert.equal(decodeURIComponent(new URL(fallback[1].href).pathname.slice('/search/films/'.length, -1)), 'A & B / 名 2001');
});
test('runtime and score sorts place unknown values last in either direction', () => {
  for (const sort of ['file_runtime_s', 'score']) {
    assert.deepEqual(selectMovies(movies, {sort, descending:false}).map(m => m.id), ['b','a','c']);
    assert.deepEqual(selectMovies(movies, {sort, descending:true}).map(m => m.id), ['a','b','c']);
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
test('play history lists played movies newest first, without the one playing', () => {
  const played = [{id:'a', updated:10}, {id:'b', updated:30}, {id:'c', updated:20}, {id:'d', updated:null}];
  assert.deepEqual(playHistory(played).map(m => m.id), ['b', 'c', 'a']);
  assert.deepEqual(playHistory(played, 'b').map(m => m.id), ['c', 'a']);
  assert.deepEqual(playHistory(played, null, 2).map(m => m.id), ['b', 'c']);
});
