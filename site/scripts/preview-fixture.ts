import { resolve } from 'node:path';

// Serve the real app assets with an isolated, read-only catalogue. This server
// never imports the Python service or contacts a TV, media folder, or provider.
const app = resolve(import.meta.dir, '../../tvcast');
const films = [
  {title:'Spring',year:2019,slug:'spring',director:'Andy Goralczyk',overview:'A shepherd girl and her dog encounter ancient forest spirits in an open film from Blender Studio.'},
  {title:'Charge',year:2022,slug:'charge',director:'Hjalti Hjalmarsson',overview:'A break-in at a battery factory becomes a confrontation with a security droid. An open film from Blender Studio.'},
  {title:'Sprite Fright',year:2021,slug:'sprite-fright',director:'Matthew Luhn',overview:'A forest outing takes an unexpected turn when a group of teenagers meets its mushroom inhabitants. An open film from Blender Studio.'},
];
const movies = films.map((film, i) => ({
  id:`sample-${i}`,title:film.title,file_title:film.title,filename:`${film.title.replaceAll(' ','.')}.${film.year}.mkv`,
  year:film.year,file_runtime_s:[480,240,600][i],genres:['Animation'],directors:[film.director],cast:[],
  overview:film.overview,poster:`/artwork/${film.slug}.jpg`,root:'/Movies',collection_path:'/Movies',
  watched:i === 1,position:0,match:{status:'matched',source:'sample'},
}));
const catalogue = {library:movies,folders:[],libraries:[{path:'/Movies',name:'Movies',problems:[],private:[]}],scanning:false,checking:0,ffprobe:true,metadata:{configured:true,pending:0}};
const assets = new Set(['panel.html','library.css','people-picker.css','themed-select.css','catalogue.js','people-picker.js','themed-select.js','library.js','icons.svg','tmdb.svg']);
Bun.serve({hostname:'127.0.0.1',port:4331,async fetch(request) {
  const path = new URL(request.url).pathname;
  if (request.method !== 'GET') return new Response('Capture fixture is read-only', {status:405});
  if (path === '/api/library') return Response.json(catalogue);
  if (path.startsWith('/api/movies/')) {
    const movie = movies.find(m => m.id === path.split('/').pop());
    return movie ? Response.json(movie) : new Response('Unknown sample', {status:404});
  }
  if (films.some(film => path === `/artwork/${film.slug}.jpg`)) return new Response(Bun.file(resolve(import.meta.dir, '../public'+path)));
  const file = path === '/' ? 'panel.html' : path.slice(1);
  if (!assets.has(file)) return new Response('Unknown capture route', {status:404});
  if (file === 'panel.html') {
    const html = await Bun.file(resolve(app,file)).text();
    // Fix only the clock and theme for reproducible captures; all UI rendering
    // and styling are the checked-in app implementation.
    return new Response(html.replace('<head>', `<head><script>localStorage.setItem('tvcast.theme.v1','${new URL(request.url).searchParams.get('theme') === 'light' ? 'light' : 'dark'}');const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-01-15T19:30:00Z']))}};</script>`), {headers:{'Content-Type':'text/html'}});
  }
  return new Response(Bun.file(resolve(app,file)));
}});
console.log('TV Cast capture fixture: http://127.0.0.1:4331/#/library');
