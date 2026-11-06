import { resolve } from 'node:path';
const app=resolve(import.meta.dir,'../../tvcast');
const read=(file:string)=>Bun.file(resolve(app,file)).text();
const films=[
 {title:'Spring',year:2019,slug:'spring',director:'Andy Goralczyk',overview:'A shepherd girl and her dog encounter ancient forest spirits.'},
 {title:'Charge',year:2022,slug:'charge',director:'Hjalti Hjalmarsson',overview:'A break-in at a battery factory leads to a confrontation with a security droid.'},
 {title:'Sprite Fright',year:2021,slug:'sprite-fright',director:'Matthew Luhn',overview:'A forest outing takes an unexpected turn when teenagers meet its mushroom inhabitants.'},
];
const movies=await Promise.all(films.map(async(film,i)=>({...film,id:`sample-${i}`,file_title:film.title,filename:`${film.title}.${film.year}.mkv`,file_runtime_s:[480,240,600][i],genres:['Animation'],directors:[film.director],cast:[],poster:'data:image/jpeg;base64,'+Buffer.from(await Bun.file(resolve(import.meta.dir,`../public/artwork/${film.slug}.jpg`)).arrayBuffer()).toString('base64'),root:'/Movies',collection_path:'/Movies',watched:i===1,position:0,match:{status:'matched',source:'sample'}})));
const runtime=await Bun.file(resolve(import.meta.dir,'../demo/runtime.js')).text();
const previewStyles=await Bun.file(resolve(import.meta.dir,'../demo/preview.css')).text();
const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
let html=(await read('panel.html')).replace('<head>',`<head>${csp}<script>window.demoMovies=${JSON.stringify(movies)};</script><script>${runtime}</script>`);
for(const name of ['library.css','people-picker.css','themed-select.css']) html=html.replace(`<link rel="stylesheet" href="/${name}">`,`<style>${await read(name)}</style>`);
for(const name of ['catalogue.js','people-picker.js','themed-select.js','library.js']) html=html.replace(`<script src="/${name}"></script>`,`<script>${await read(name)}</script>`);
html=html.replace('<main>','<main aria-label="TV Cast demo">').replace('<body>','<body>'+(await read('icons.svg')).replace('<svg ','<svg style="display:none" ')).replaceAll('/icons.svg#','#');
html=html.replaceAll('/tmdb.svg','data:image/svg+xml;base64,'+Buffer.from(await read('tmdb.svg')).toString('base64'));
html=html.replace('</head>',`<style>${previewStyles}</style></head>`);
html=html.replace('<h2>Remote</h2>','<h2>Samsung remote</h2>');
for(const [direction,symbol] of Object.entries({Up:'↑',Left:'←',Right:'→',Down:'↓'})) html=html.replace(`aria-label="${direction}">${direction}</button>`,`aria-label="${direction}"><span aria-hidden="true">${symbol}</span></button>`);
await Bun.write(resolve(import.meta.dir,'../public/demo/index.html'),html);
await Bun.write(resolve(import.meta.dir,'../public/demo/LICENSE-ICONS.txt'),Bun.file(resolve(app,'../LICENSE-ICONS')));
console.log('Built self-contained TV Cast demo from the real app UI.');
