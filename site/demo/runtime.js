(() => {
  // All service operations live in this iframe's memory. Never fall through to
  // browser fetch: the public preview must not reach devices or local services.
  const movies = structuredClone(window.demoMovies);
  const device = {id:'demo-tv',name:'Living room TV',model:'Samsung Smart TV',ip:'sample device',subtitle_mode:'auto',subtitles:'external'};
  let selected = device.id, discovered = true, now = null, queue = [];
  let menu='home', cursor=0, input='Mac';
  const tv = {state:'STOPPED',position:0,duration:0,volume:35,muted:false,uri:''};
  function publishScreen() {
    parent.postMessage({type:'demo-tv-state',connected:!!selected,film:now?{title:now.title,year:now.year,slug:now.slug}:null,state:tv.state,position:tv.position,duration:tv.duration,volume:tv.volume,muted:tv.muted,menu,cursor,input},'*');
  }
  const catalogue = () => ({library:movies,selected,folders:[],libraries:[{path:'/Movies',name:'Movies',problems:[],private:[]}],scanning:false,checking:0,ffprobe:true,metadata:{configured:true,pending:0}});
  const status = () => ({...catalogue(),tvs:discovered?[device]:[],tv:selected?tv:null,now,queue,burns:[],remote:{available:true,paired:true},server:{rate:0,active:0,sent:0,last_request_age:null,uptime:120},power:{on_battery:false,percent:100}});
  function open(id, fromStart=false) {
    const movie=movies.find(item=>item.id===id);
    if(!movie) throw new Error('Choose a sample film.');
    now={...movie,file:movie.filename,subtitles:{tracks:[],embedded:[],selected:null,live:true}};
    menu='';input='Mac';
    Object.assign(tv,{state:'PLAYING',position:fromStart?0:movie.position,duration:movie.file_runtime_s,uri:'/media/'+id});
    movie.updated=Date.now()/1000;
  }
  function remoteKey(key) {
    if(key==='KEY_HOME') {menu='home';cursor=0;}
    else if(key==='KEY_SOURCE') {menu='source';cursor=0;}
    else if(key==='KEY_RETURN') menu=menu?(now?'':'home'):'home';
    else if(key==='KEY_ENTER') {
      if(menu==='home') open(movies[cursor].id);
      else if(menu==='source') {input=['Mac','HDMI 1','HDMI 2'][cursor];menu='';if(input!=='Mac')tv.state='PAUSED_PLAYBACK';}
      else if(now)tv.state=tv.state==='PLAYING'?'PAUSED_PLAYBACK':'PLAYING';
    } else if(['KEY_LEFT','KEY_RIGHT','KEY_UP','KEY_DOWN'].includes(key)) {
      const delta=['KEY_LEFT','KEY_UP'].includes(key)?-1:1;
      if(menu)cursor=(cursor+delta+3)%3;
      else if(now&&input==='Mac')tv.position=Math.max(0,Math.min(tv.duration,tv.position+delta*10));
      else {menu='source';cursor=0;}
    }
  }
  const storage = () => { const values=new Map(); return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}; };
  for(const name of ['localStorage','sessionStorage']) Object.defineProperty(window,name,{value:storage()});
  window.fetch=async (input,options={}) => {
    const path=String(input), body=JSON.parse(options.body||'{}');
    let result={ok:true};
    try {
      if(path==='/api/library') result=catalogue();
      else if(path==='/api/status') result=status();
      else if(path.startsWith('/api/movies/')) {
        result=movies.find(movie=>movie.id===decodeURIComponent(path.split('/').pop()));
        if(!result) throw new Error('Sample film not found.');
      } else switch(path.slice(5)) {
        case 'discover': discovered=true; selected=device.id; break;
        case 'select': selected=device.id; break;
        case 'apps': result={apps:[]}; break;
        case 'keys': for(const key of body.keys||[])remoteKey(key); break;
        case 'open': open(body.id,body.from_start); break;
        case 'pause': tv.state='PAUSED_PLAYBACK'; break;
        case 'play': tv.state='PLAYING';menu='';input='Mac'; break;
        case 'stop': tv.state='STOPPED'; now=null;menu='home';cursor=0; break;
        case 'seek': tv.position=Math.max(0,Math.min(tv.duration,Number(body.seconds))); break;
        case 'volume': tv.volume=Math.max(0,Math.min(100,Number(body.level))); break;
        case 'mute': tv.muted=!!body.on; break;
        case 'watched': {const movie=movies.find(item=>item.id===body.id); if(movie) movie.watched=body.watched; break;}
        case 'queue_add': {const movie=movies.find(item=>item.id===body.id); if(movie&&!queue.some(item=>item.id===movie.id)) queue.push({...movie,available:true}); break;}
        case 'queue_remove': queue=queue.filter(item=>item.id!==body.id); break;
        case 'queue_clear': queue=[]; break;
        case 'queue_move': {const i=queue.findIndex(item=>item.id===body.id),j=i+body.direction; if(i>=0&&j>=0&&j<queue.length) [queue[i],queue[j]]=[queue[j],queue[i]]; break;}
        case 'queue_next': if(queue.length) open(queue.shift().id); break;
        case 'rescan': case 'metadata_refresh': break;
        case 'metadata_search': result={results:movies.filter(movie=>movie.title.toLowerCase().includes(String(body.title).toLowerCase())&&(!body.year||movie.year===Number(body.year))).map(movie=>({id:movies.indexOf(movie)+1,title:movie.title,year:movie.year,overview:movie.overview})),more:false}; break;
        case 'metadata_match': {
          const movie=movies.find(item=>item.id===body.id),match=movies[Number(body.tmdb_id)-1];
          if(movie&&match)for(const key of ['title','year','overview','poster','directors','genres'])movie[key]=structuredClone(match[key]);
          break;
        }
        case 'open_local': {
          const movie=movies.find(item=>item.id===body.id);
          if(!movie)throw new Error('Choose a sample film.');
          parent.postMessage({type:'demo-local-open',film:{title:movie.title,slug:movie.slug,filename:movie.filename,duration:movie.file_runtime_s}},'*');
          break;
        }
        case 'reveal': throw new Error('Demo only — the installed app opens Finder.');
        default: throw new Error('This action needs the installed app. Try browsing, watched status, the queue, or TV playback.');
      }
      publishScreen();
      return Response.json(result);
    } catch(error) {return Response.json({error:error.message},{status:400});}
  };
  setInterval(()=>{
    if(now&&tv.state==='PLAYING'&&!document.hidden) {
      tv.position=Math.min(tv.duration,tv.position+1);
      const movie=movies.find(item=>item.id===now.id); movie.position=tv.position;
      if(tv.position===tv.duration) {movie.watched=true;if(queue.length)open(queue.shift().id);else tv.state='STOPPED';}
      publishScreen();
    }
  },1000);
  addEventListener('message',event=>{
    if(event.source!==parent)return;
    if(event.data?.type==='landing-theme')document.documentElement.dataset.theme=event.data.theme;
    else if(event.data?.type==='demo-tv-choice'&&Number.isInteger(event.data.index)&&event.data.index>=0&&event.data.index<3&&menu) {cursor=event.data.index;remoteKey('KEY_ENTER');publishScreen();}
  });
  document.addEventListener('DOMContentLoaded',()=>{
    // Configuration is outside the sample's browse-and-cast flow. Do not solicit
    // credentials or imply that this page can choose folders on the visitor's Mac.
    document.querySelector('#settingsButton').hidden=true;
    document.querySelector('#themeButton').hidden=true;
    const filters=document.querySelector('.discovery-tools');
    filters.id='demo-filters';
    const filterToggle=document.createElement('button');
    filterToggle.type='button';filterToggle.className='mobile-filter-toggle';filterToggle.textContent='Filters';
    filterToggle.setAttribute('aria-controls',filters.id);filterToggle.setAttribute('aria-expanded','false');
    filterToggle.addEventListener('click',()=>filterToggle.setAttribute('aria-expanded',String(filterToggle.getAttribute('aria-expanded')!=='true')));
    filters.before(filterToggle);
    document.querySelectorAll('a[target="_blank"]').forEach(link=>link.removeAttribute('target'));
    parent.postMessage({type:'demo-ready'},'*');
    publishScreen();
  });
})();
