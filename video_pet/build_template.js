const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = value => String(value ?? '').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').trim();
const money = value => {
  if (value == null || value === '') return '';
  const n = Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) throw new Error('Precio inválido');
  return '$' + n.toLocaleString('en-US', {maximumFractionDigits:2});
};
function compile(data, config, exists = () => true) {
  if (!Array.isArray(data.scenes) || data.scenes.length !== 4) throw new Error('Se requieren cuatro escenas');
  const starts = []; let voiceDuration = 0;
  const durations = data.scenes.map((s, i) => {
    const d = Number(s.audio_duration);
    if (!Number.isFinite(d) || d <= 0) throw new Error(`Duración inválida en escena ${i+1}`);
    starts.push(voiceDuration); voiceDuration += d; return d;
  });
  // The existing generator concatenates voice snippets without inserted silence.
  const duration = Math.ceil(voiceDuration + config.closingHold);
  const title = clean(data.product_title);
  if (!title || title.length > 240) throw new Error('Título ausente o demasiado largo');
  const offer = money(data.offer_price);
  if (!offer) throw new Error('Falta precio de oferta');
  const original = money(data.original_price);
  const discount = Number(data.discount_percentage);
  const points = (data.scenes[1].key_points || data.key_points || []).slice(0,3).map(clean);
  if (!points.length || points.some(p=> !p || p.length>160)) throw new Error('Beneficios ausentes o demasiado largos');
  if (!exists('public/product.png')) throw new Error('Falta la imagen principal');
  const image = '<img class="product" src="public/product.png" alt="'+escape(title)+'">';
  const tag = text => '<div class="tag">'+escape(text)+'</div>';
  const footer = text => '<div class="footer">'+escape(text)+'</div>';
  const scene = (i, content) => `<section id="s${i+1}" class="scene clip ${i%2?'yellow':''}" data-start="${starts[i]}" data-duration="${i===3?duration-starts[i]:durations[i]}" data-track-index="0">${content}</section>`;
  const priceSize = Math.min(205, 1420/offer.length);
  const titleSize = title.length>140?30:title.length>85?38:title.length>45?48:60;
  const body = [
    scene(0, tag('ANTOJO DEL DÍA')+`<h1 id="hook" class="headline">${escape(config.hook)}</h1><div class="product-stage opening" id="p1">${image}</div><p class="product-title" style="font-size:${titleSize}px">${escape(title)}</p>`+footer('En Mercado Libre')),
    scene(1, tag('DALE LUGAR A ESE GUSTO')+`<div class="product-stage benefits" id="p2">${image}</div><div class="benefits-list">${points.map((p,i)=>`<p id="benefit${i}" style="font-size:${p.length>100?28:p.length>70?34:44}px"><span class="benefit-index">0${i+1}</span>${escape(p)}</p>`).join('')}</div>`+footer('Para eso trabajo.')),
    scene(2, tag('EL GUSTO. A ESTE PRECIO.')+(original?`<div id="old" class="old">${escape(original)}</div>`:'')+`<div id="amount" class="amount" style="font-size:${priceSize}px">${escape(offer)}</div>`+(discount>0&&discount<100?`<div id="discount" class="discount">−${escape(discount)}% DE DESCUENTO</div>`:'')+`<div class="product-stage price-product" id="p3">${image}</div>`+footer('En Mercado Libre · MXN')),
    scene(3, tag('TE LO GANASTE.')+'<h2 class="headline"><span id="cta1">Para eso</span><span id="cta2">trabajo.</span></h2>'+`<div class="product-stage closing" id="p4">${image}</div><div id="button" class="button"><span>${escape(config.cta)}</span><span>↗</span></div>`+footer('Date el gusto.'))
  ].join('\n');
  const captions = data.scenes.map((s,i)=> `<p id="c${i}" class="caption" style="font-size:${String(s.subtitle||'').length>100?28:32}px">${escape(s.subtitle||'')}</p>`).join('');
  const volume = (v,max=1) => { if(!Number.isFinite(v)||v<0||v>max) throw new Error('Volumen inválido'); return v; };
  let audio = `<audio id="voice" class="clip" src="public/voice.mp3" data-start="0" data-duration="${voiceDuration}" data-track-index="2" data-volume="1"></audio>`;
  if(config.music && exists(config.music.file)) {
    const v=volume(config.music.volume);
    const automation={version:1,lanes:[{target:'volume',points:[{t:0,v:0},{t:.6,v},{t:voiceDuration,v},{t:duration-.05,v:0}]}]};
    audio+=`<audio id="music" class="clip" src="${escape(config.music.file)}" data-start="0" data-duration="${duration}" data-track-index="3" data-volume="${v}" data-automation="${escape(JSON.stringify(automation))}"></audio>`;
  }
  const priceAt=starts[2]+Math.min(.6,durations[2]*.12);
  const sounds=[['whoosh',starts[1],.35],['pop',priceAt,.08],['ding',starts[3]+.72,.6]];
  sounds.forEach(([name,start,d],i)=> { if(exists(`public/sfx/${name}.mp3`))audio+=`<audio id="sfx${i}" class="clip" src="public/sfx/${name}.mp3" data-start="${start}" data-duration="${Math.min(d,duration-start)}" data-track-index="${4+i}" data-volume="${volume(config.sfxVolume)}"></audio>`; });
  const script=`const tl=gsap.timeline({paused:true});
tl.fromTo('#progress',{scaleX:0},{scaleX:1,duration:${duration},ease:'none'},0);
tl.fromTo('#hook',{y:30,opacity:0},{y:0,opacity:1,duration:.5,ease:'power3.out'},0);
${starts.map((s,i)=>`tl.fromTo('#p${i+1}',{opacity:.7,y:18},{opacity:1,y:0,duration:.5,ease:'power3.out'},${s});`).join('\n')}
${points.map((_,i)=>`tl.fromTo('#benefit${i}',{opacity:0,y:20},{opacity:1,y:0,duration:.4,ease:'power3.out'},${starts[1]+i*Math.min(.9,durations[1]/4)});`).join('\n')}
${original?`tl.fromTo('#old',{opacity:0},{opacity:1,duration:.3},${starts[2]});`:''}
tl.fromTo('#amount',{opacity:0,y:30},{opacity:1,y:0,duration:.45,ease:'power3.out'},${priceAt});
${discount>0&&discount<100?`tl.fromTo('#discount',{opacity:0,y:15},{opacity:1,y:0,duration:.35},${priceAt+.4});`:''}
tl.fromTo(['#cta1','#cta2'],{opacity:0,y:40},{opacity:1,y:0,duration:.62,ease:'power3.out',stagger:.1},${starts[3]});
tl.fromTo('#button',{opacity:0,scale:.9,y:20},{opacity:1,scale:1,y:0,duration:.6,ease:'back.out(1.5)'},${starts[3]+.72});
${starts.map((s,i)=>`tl.fromTo('#c${i}',{opacity:0},{opacity:1,duration:.15},${s+.15});tl.to('#c${i}',{opacity:0,duration:.12},${s+durations[i]-.12});`).join('\n')}
window.__timelines=window.__timelines||{};window.__timelines['main']=tl;`;
  return {body,captions,audio,script,duration,starts,voiceDuration};
}
function build(dir=__dirname) {
  const data=JSON.parse(fs.readFileSync(path.join(dir,'src/deal_data.json'),'utf8'));
  const config=JSON.parse(fs.readFileSync(path.join(dir,'template.config.json'),'utf8'));
  for(const color of Object.values(config.colors))if(!/^#[a-f\d]{6}$/i.test(color))throw new Error('Color inválido');
  const result=compile(data,config,f=>fs.existsSync(path.join(dir,f)));
  // Reject stale/inconsistent timing before producing a video.
  const actual=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path.join(dir,'public/voice.mp3')],{encoding:'utf8'}).trim());
  if(Math.abs(actual-result.voiceDuration)>.25)throw new Error(`Audio (${actual}s) y escenas (${result.voiceDuration}s) no coinciden`);
  let html=fs.readFileSync(path.join(dir,'template.html.txt'),'utf8');
  html=html.replace(/<div id="s1"[\s\S]*?(?=<div class="brand">)/,result.body+'\n');
  html=html.replace(/<div class="captions">[\s\S]*?<\/div>/,`<div class="captions">${result.captions}</div>`);
  html=html.replace(/<audio id="voice"[\s\S]*?<\/audio>/,result.audio);
  html=html.replace(/<script>[^]*?<\/script>/,`<script>\n${result.script}\n</script>`);
  html=html.replace('data-duration="30"',`data-duration="${result.duration}"`);
  const css=`\n.scene{background:${config.colors.paper}}.yellow{background:${config.colors.accent}}body{color:${config.colors.ink}}.mark,.button,.discount{background:${config.colors.ink};color:${config.colors.accent}}.headline{width:870px;font-size:138px;line-height:.97;letter-spacing:-7px}.product-stage{position:absolute;background:#fff;border-radius:36px;padding:35px;overflow:hidden}.product{width:100%;height:100%;object-fit:contain}.opening{left:90px;top:740px;width:870px;height:620px}.product-title{position:absolute;left:90px;top:1390px;width:870px;line-height:1.2;font-weight:700;height:180px;padding-top:5px}.benefits{left:90px;top:410px;width:870px;height:640px}.benefits-list{position:absolute;left:90px;right:120px;top:1100px;display:flex;flex-direction:column;gap:25px}.benefits-list p{display:flex;gap:24px;line-height:1.12;font-weight:700}.benefit-index{font-size:25px;min-width:45px;padding-top:10px}.price-product{left:270px;top:980px;width:600px;height:550px}.closing{left:170px;top:710px;width:700px;height:660px}.amount{letter-spacing:-12px}.caption{max-height:140px;overflow:hidden}\n`;
  html=html.replace('</style>',css+'</style>');
  fs.writeFileSync(path.join(dir,'index.html'),html.trimEnd() + '\n');
  const hf=JSON.parse(fs.readFileSync(path.join(dir,'hyperframes.json'),'utf8'));hf.compositions[0].duration=result.duration;fs.writeFileSync(path.join(dir,'hyperframes.json'),JSON.stringify(hf,null,2));
  console.log(`Plantilla lista: ${result.duration}s, voz ${actual.toFixed(3)}s, música y SFX disponibles incluidos.`);
  return result;
}
module.exports={compile,build};
if(require.main===module)build();


