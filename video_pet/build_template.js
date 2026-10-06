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
  const title = clean(data.product_title).substring(0, 240);
  if (!title) throw new Error('Título ausente');
  const offer = money(data.offer_price);
  if (!offer) throw new Error('Falta precio de oferta');
  const original = money(data.original_price);
  const discount = Number(data.discount_percentage);
  const rawPoints = (data.scenes[1].key_points || data.key_points || []).map(clean).filter(Boolean);
  const points = (rawPoints.length ? rawPoints : ['Calidad garantizada', 'Envío rápido a todo el país', 'Excelente precio']).slice(0,3).map(p => p.substring(0, 140));
  if (!exists('public/product.png')) throw new Error('Falta la imagen principal');
  const image = '<img class="product" src="public/product.png" alt="'+escape(title)+'">';
  const tag = text => '<div class="tag">'+escape(text)+'</div>';
  const footer = text => '<div class="footer">'+escape(text)+'</div>';
  const scene = (i, content) => `<section id="s${i+1}" class="scene clip ${i%2?'yellow':''}" data-start="${starts[i]}" data-duration="${i===3?duration-starts[i]:durations[i]}" data-track-index="0">${content}</section>`;
  const originalNumber = original ? Number(String(data.original_price).replace(/[$,\s]/g, '')) : 0;
  const offerNumber = Number(String(data.offer_price).replace(/[$,\s]/g, ''));
  const priceDrops = original && originalNumber > offerNumber;
  // El tamaño considera el número más largo que se mostrará durante la cuenta regresiva
  const priceSize = Math.min(205, 1420/Math.max(offer.length, priceDrops ? original.length : 0));
  const titleSize = title.length>140?30:title.length>85?38:title.length>45?48:60;
  const hookWords = String(config.hook).trim().split(/\s+/).map(w=>`<span class="w"><span>${escape(w)}</span></span>`).join(' ');
  const body = [
    scene(0, tag('ANTOJO DEL DÍA')+`<h1 id="hook" class="headline">${hookWords}</h1><div class="product-stage opening" id="p1">${image}</div><p class="product-title" id="ptitle" style="font-size:${titleSize}px">${escape(title)}</p>`+footer('En Mercado Libre')),
    scene(1, tag('DALE LUGAR A ESE GUSTO')+`<div class="product-stage benefits" id="p2">${image}</div><div class="benefits-list">${points.map((p,i)=>`<p id="benefit${i}" style="font-size:${p.length>100?28:p.length>70?34:44}px"><span class="benefit-index">0${i+1}</span>${escape(p)}</p>`).join('')}</div>`+footer('Para eso trabajo.')),
    scene(2, tag('EL GUSTO. A ESTE PRECIO.')+(original?`<div id="old" class="old">${escape(original)}<span class="strike" id="strike"></span></div>`:'')+`<div id="amount" class="amount" style="font-size:${priceSize}px">${escape(offer)}</div>`+(discount>0&&discount<100?`<div id="discount" class="discount">−${escape(discount)}% DE DESCUENTO</div>`:'')+`<div class="product-stage price-product" id="p3">${image}</div>`+footer('En Mercado Libre · MXN')),
    scene(3, tag('TE LO GANASTE.')+'<h2 class="headline"><span id="cta1">Para eso</span><span id="cta2">trabajo.</span></h2>'+`<div class="product-stage closing" id="p4">${image}</div><div id="button" class="button"><span>${escape(config.cta)}</span><span id="arrow">↗</span></div>`+footer('Date el gusto.')),
    '<div id="wipe" class="wipe"></div>'
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
  const dropDur=priceDrops?Math.min(1.1,durations[2]*.18):0;
  const landAt=priceAt+.35+dropDur;
  const sounds=[['whoosh',starts[1],.35],['pop',landAt,.08],['ding',starts[3]+.72,.6]];
  sounds.forEach(([name,start,d],i)=> { if(exists(`public/sfx/${name}.mp3`))audio+=`<audio id="sfx${i}" class="clip" src="public/sfx/${name}.mp3" data-start="${start}" data-duration="${Math.min(d,duration-start)}" data-track-index="${4+i}" data-volume="${volume(config.sfxVolume)}"></audio>`; });
  if(priceDrops && exists('public/sfx/cash.mp3')) audio+=`<audio id="sfx-cash" class="clip" src="public/sfx/cash.mp3" data-start="${landAt+.05}" data-duration="0.8" data-track-index="7" data-volume="${volume(config.sfxVolume)}"></audio>`;
  const benefitSlots=[.1,.38,.64];
  const presses=Math.max(1,Math.floor((duration-starts[3]-2)/1.3));
  const fmt='n=>"$"+Math.round(n).toLocaleString("en-US")';
  const script=`const tl=gsap.timeline({paused:true});
gsap.set('#wipe',{yPercent:100});
tl.fromTo('#progress',{scaleX:0},{scaleX:1,duration:${duration},ease:'none'},0);
tl.fromTo('#hook .w>span',{yPercent:110},{yPercent:0,duration:.5,ease:'power4.out',stagger:.09},.1);
tl.fromTo('#ptitle',{opacity:0,y:24},{opacity:1,y:0,duration:.4,ease:'power3.out'},.7);
${starts.map((s,i)=>`tl.fromTo('#s${i+1} .tag',{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:.35,ease:'power2.out'},${s+.05});
tl.fromTo('#p${i+1}',{opacity:0,scale:.86,rotation:${i%2?3:-3},y:40},{opacity:1,scale:1,rotation:0,y:0,duration:.55,ease:'back.out(1.6)'},${s+(i===0?.35:.12)});
tl.fromTo('#p${i+1} .product',{scale:.97},{scale:1.06,duration:${durations[i]},ease:'sine.inOut'},${s});`).join('\n')}
${starts.slice(1).map(s=>`tl.fromTo('#wipe',{yPercent:100},{yPercent:0,duration:.16,ease:'power3.in',immediateRender:false},${Math.max(0,s-.16)});tl.to('#wipe',{yPercent:-100,duration:.22,ease:'power3.out'},${s});`).join('\n')}
${points.map((_,i)=>`tl.fromTo('#benefit${i}',{opacity:0,x:-80},{opacity:1,x:0,duration:.4,ease:'power4.out'},${starts[1]+durations[1]*benefitSlots[i]});tl.fromTo('#benefit${i} .benefit-index',{scale:2.2},{scale:1,duration:.35,ease:'back.out(3)'},${starts[1]+durations[1]*benefitSlots[i]+.12});`).join('\n')}
${original?`tl.fromTo('#old',{opacity:0,y:20},{opacity:1,y:0,duration:.3,ease:'power3.out'},${starts[2]+.1});`:''}
tl.fromTo('#amount',{opacity:0,y:30},{opacity:1,y:0,duration:.35,ease:'power3.out'},${priceAt});
${priceDrops?`const price={v:${originalNumber}};const amountEl=document.getElementById('amount');const fmt=${fmt};
tl.fromTo(price,{v:${originalNumber}},{v:${offerNumber},duration:${dropDur},ease:'power2.inOut',onUpdate:()=>{amountEl.textContent=fmt(price.v);}},${priceAt+.3});
tl.set(amountEl,{textContent:${JSON.stringify(offer)}},${landAt});
tl.fromTo('#strike',{scaleX:0},{scaleX:1,duration:.3,ease:'power3.inOut'},${priceAt+.3});`:''}
tl.fromTo('#amount',{scale:1},{scale:1.08,duration:.12,yoyo:true,repeat:1,ease:'power2.out',transformOrigin:'0% 50%'},${landAt});
${discount>0&&discount<100?`tl.fromTo('#discount',{opacity:0,scale:2.2,rotation:-12},{opacity:1,scale:1,rotation:-3,duration:.4,ease:'back.out(2.4)'},${landAt+.25});`:''}
tl.fromTo(['#cta1','#cta2'],{opacity:0,y:60},{opacity:1,y:0,duration:.55,ease:'power4.out',stagger:.12},${starts[3]+.1});
tl.fromTo('#button',{opacity:0,scale:.8,y:30},{opacity:1,scale:1,y:0,duration:.55,ease:'back.out(1.8)'},${starts[3]+.72});
${Array.from({length:presses},(_,k)=>{const p=starts[3]+1.5+k*1.3;return `tl.to('#button',{x:8,y:8,boxShadow:'0px 0px 0 #ffffff',duration:.1,ease:'power2.in'},${p});tl.to('#button',{x:0,y:0,boxShadow:'10px 10px 0 #ffffff',duration:.24,ease:'back.out(3)'},${p+.1});tl.fromTo('#arrow',{x:0,y:0},{x:10,y:-10,duration:.18,yoyo:true,repeat:1,ease:'power2.out'},${p+.1});`;}).join('\n')}
${starts.map((s,i)=>`tl.fromTo('#c${i}',{opacity:0,y:14},{opacity:1,y:0,duration:.18,ease:'back.out(2)'},${s+.15});tl.to('#c${i}',{opacity:0,duration:.12},${s+durations[i]-.12});`).join('\n')}
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
  if(Math.abs(actual-result.voiceDuration)>1.5)throw new Error(`Audio (${actual}s) y escenas (${result.voiceDuration}s) no coinciden`);
  let html=fs.readFileSync(path.join(dir,'template.html.txt'),'utf8');
  html=html.replace(/<div id="s1"[\s\S]*?(?=<div class="brand">)/,()=>result.body+'\n');
  html=html.replace(/<div class="captions">[\s\S]*?<\/div>/,()=>`<div class="captions">${result.captions}</div>`);
  html=html.replace(/<audio id="voice"[\s\S]*?<\/audio>/,()=>result.audio);
  html=html.replace(/<script>[^]*?<\/script>/,()=>`<script>\n${result.script}\n</script>`);
  html=html.replace('data-duration="30"',`data-duration="${result.duration}"`);
  const css=`\n.scene{background:${config.colors.paper}}.yellow{background:${config.colors.accent}}body{color:${config.colors.ink}}.mark,.button,.discount{background:${config.colors.ink};color:${config.colors.accent}}.headline{width:870px;font-size:138px;line-height:.97;letter-spacing:-7px}.headline .w{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.08em;margin-bottom:-.08em}.headline .w>span{display:inline-block}.product-stage{position:absolute;background:#fff;border-radius:36px;padding:35px;overflow:hidden;box-shadow:0 18px 40px rgba(32,33,29,.12)}.product{width:100%;height:100%;object-fit:contain}.opening{left:90px;top:650px;width:870px;height:680px}.product-title{position:absolute;left:90px;top:1360px;width:870px;line-height:1.2;font-weight:700;height:160px;padding-top:5px}.benefits{left:90px;top:400px;width:870px;height:670px}.benefits-list{position:absolute;left:90px;right:120px;top:1110px;display:flex;flex-direction:column;gap:25px}.benefits-list p{display:flex;gap:24px;line-height:1.12;font-weight:700}.benefit-index{display:inline-block;font-size:25px;min-width:45px;padding-top:10px}.price-product{left:300px;top:1000px;width:600px;height:520px}.closing{left:170px;top:700px;width:700px;height:640px}.amount{letter-spacing:-12px;white-space:nowrap}.old{text-decoration:none}.strike{position:absolute;left:-6px;right:-6px;top:50%;height:7px;margin-top:-3px;background:${config.colors.ink};transform-origin:left center}.discount{transform:rotate(-3deg);box-shadow:8px 8px 0 ${config.colors.accent},8px 8px 0 3px ${config.colors.ink}}.button{box-shadow:10px 10px 0 #ffffff;border:4px solid ${config.colors.ink}}#arrow{display:inline-block}.footer{top:1555px}.wipe{position:absolute;inset:0;background:${config.colors.ink};z-index:9}.mark{transform:rotate(-4deg)}.caption{max-height:140px;overflow:hidden;background:${config.colors.ink};color:${config.colors.accent};padding:10px 24px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.25)}\n`;
  html=html.replace('</style>',css+'</style>');
  fs.writeFileSync(path.join(dir,'index.html'),html.trimEnd() + '\n');
  const hf=JSON.parse(fs.readFileSync(path.join(dir,'hyperframes.json'),'utf8'));hf.compositions[0].duration=result.duration;fs.writeFileSync(path.join(dir,'hyperframes.json'),JSON.stringify(hf,null,2));
  console.log(`Plantilla lista: ${result.duration}s, voz ${actual.toFixed(3)}s, música y SFX disponibles incluidos.`);
  return result;
}
module.exports={compile,build};
if(require.main===module)build();


