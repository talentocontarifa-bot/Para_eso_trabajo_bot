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
  const duration = Math.ceil(voiceDuration + config.closingHold);
  const title = clean(data.product_title).substring(0, 240);
  if (!title) throw new Error('Título ausente');
  const offer = money(data.offer_price);
  if (!offer) throw new Error('Falta precio de oferta');
  const original = money(data.original_price);
  const discount = Number(data.discount_percentage);
  const hasDiscount = Number.isFinite(discount) && discount > 0 && discount < 100;
  const roundedDecade = hasDiscount ? Math.floor(discount / 10) * 10 : 0;
  const isRoundedPlus = hasDiscount && discount >= 15 && (discount % 10 !== 0);
  const discountBadgeText = hasDiscount
    ? (isRoundedPlus ? `+${roundedDecade}% OFF` : `−${discount}% OFF`)
    : 'OFERTA HOY';
  const discountLongText = hasDiscount
    ? (isRoundedPlus ? `MÁS DEL ${roundedDecade}% OFF` : `−${discount}% OFF`)
    : '';
  const offerNum = Number(String(data.offer_price).replace(/[$,\s]/g, ''));
  const origNum = Number(String(data.original_price || '').replace(/[$,\s]/g, ''));
  const savings = (Number.isFinite(origNum) && Number.isFinite(offerNum) && origNum > offerNum)
    ? '$' + Math.round(origNum - offerNum).toLocaleString('en-US')
    : '';
  const points = (data.scenes[1]?.key_points || data.scenes[2]?.key_points || data.key_points || []).slice(0,3).map(clean);
  if (!points.length || points.some(p=> !p || p.length>160)) throw new Error('Beneficios ausentes o demasiado largos');
  if (!exists('public/product.png')) throw new Error('Falta la imagen principal');
  const img2Src = exists('public/product_2.png') ? 'public/product_2.png' : 'public/product.png';
  const hasMeliFull = exists('public/meli_logo_full.png');
  const hasMeliIcon = exists('public/meli_handshake.png');
  const meliFullImg = hasMeliFull ? `<img class="meli-logo-full" src="public/meli_logo_full.png" alt="Mercado Libre">` : `<span>MERCADO LIBRE</span>`;
  const meliIconImg = hasMeliIcon ? `<img class="meli-icon" src="public/meli_handshake.png" alt="ML">` : '';
  const image1 = '<img class="product" src="public/product.png" alt="'+escape(title)+'">';
  const image2 = '<img class="product product-zoom" src="'+img2Src+'" alt="'+escape(title)+'">';
  const scene = (i, content) => `<section id="s${i+1}" class="scene clip ${i%2?'yellow':''}" data-start="${starts[i]}" data-duration="${i===3?duration-starts[i]:durations[i]}" data-track-index="0">${content}</section>`;
  const priceSize = Math.min(220, 1480/offer.length);
  const heroPriceSize = Math.min(148, 1080/offer.length);
  const titleSize = title.length>120?36:title.length>75?44:title.length>42?52:60;

  // ESCENA 1: DIRECTO AL PRECIO, DESCUENTO REDONDEADO (+70% OFF), FOTO GIGANTE Y LOGO MERCADO LIBRE
  const s1Header = `<div class="s1-top-strip">` +
    `<div class="s1-discount-pill">${escape(discountBadgeText)}</div>` +
    `<div class="s1-price-box">` +
      (original ? `<span class="s1-old">ANTES ${escape(original)}</span>` : `<span class="s1-old">PRECIO OFERTA</span>`) +
      `<span id="hook" class="s1-offer" style="font-size:${heroPriceSize}px">${escape(offer)}</span>` +
    `</div>` +
  `</div>`;
  const s1Stage = `<div class="product-stage stage-s1" id="p1">${image1}<div class="stage-floating-tag">${meliIconImg}<span>COMPRA SEGURA EN MERCADO LIBRE</span></div></div>`;
  const s1Title = `<div class="s1-title-card"><p class="s1-title-text" style="font-size:${titleSize}px">${escape(title)}</p></div>`;

  // ESCENA 2: QUÉ ES Y QUÉ HACE (FOTO GIGANTE + 3 BLOQUES CONTUNDENTES)
  const s2Header = `<div class="s2-top-bar"><span class="s2-badge">¿QUÉ ES Y QUÉ HACE?</span><span class="s2-mini-price">${escape(offer)}${hasDiscount ? ` · ${escape(discountBadgeText)}` : ''}</span></div>`;
  const s2Stage = `<div class="product-stage stage-s2" id="p2">${image2}<div class="stage-floating-tag">${meliIconImg}<span>DISPONIBLE EN MERCADO LIBRE</span></div></div>`;
  const s2Cards = `<div class="benefits-list">${points.map((p,i)=>`<div id="benefit${i}" class="benefit-card"><span class="benefit-index">0${i+1}</span><span class="benefit-text" style="font-size:${p.length>85?32:p.length>55?38:44}px">${escape(p)}</span></div>`).join('')}</div>`;

  // ESCENA 3: IMPACTO TOTAL DE PRECIO Y AHORRO + FOTO GRANDE
  const s3Header = `<div class="s3-price-hero">` +
    `<div class="s3-price-row">` +
      (original ? `<div id="old" class="old">ANTES ${escape(original)}</div>` : '') +
      (hasDiscount ? `<div id="discount" class="discount">${escape(discountLongText)}</div>` : '') +
    `</div>` +
    `<div id="amount" class="amount" style="font-size:${priceSize}px">${escape(offer)}</div>` +
    (savings ? `<div class="s3-savings-banner">🔥 TE AHORRAS ${escape(savings)} PESOS EN MERCADO LIBRE</div>` : `<div class="s3-savings-banner">🔥 OFERTA DIRECTA EN MERCADO LIBRE</div>`) +
  `</div>`;
  const s3Stage = `<div class="product-stage stage-s3" id="p3">${image1}<div class="stage-floating-tag">${meliIconImg}<span>ENVÍO RÁPIDO · MERCADO LIBRE</span></div></div>`;

  // ESCENA 4: CIERRE AGRESIVO + FOTO GRANDE + BOTÓN MASIVO CON LOGO MERCADO LIBRE
  const s4Header = `<div class="s4-header"><div class="s4-kicker">OFERTA EN MERCADO LIBRE · ${escape(offer)}${hasDiscount ? ` (${escape(discountBadgeText)})` : ''}</div><h2 class="s4-headline"><span id="cta1">¡Para eso</span> <span id="cta2">trabajo!</span></h2></div>`;
  const s4Stage = `<div class="product-stage stage-s4" id="p4">${image1}</div>`;
  const s4Button = `<div id="button" class="button"><div class="button-left">${meliIconImg}<span>COMPRA EN MERCADO LIBRE · LINK EN BIO</span></div><span class="button-arrow">↗</span></div>`;

  const body = [
    scene(0, s1Header + s1Stage + s1Title),
    scene(1, s2Header + s2Stage + s2Cards),
    scene(2, s3Header + s3Stage),
    scene(3, s4Header + s4Stage + s4Button)
  ].join('\n');

  const captions = data.scenes.map((s,i)=> `<p id="c${i}" class="caption" style="font-size:${String(s.subtitle||'').length>95?28:33}px">${escape(s.subtitle||'')}</p>`).join('');
  const volume = (v,max=1) => { if(!Number.isFinite(v)||v<0||v>max) throw new Error('Volumen inválido'); return v; };
  let audio = `<audio id="voice" class="clip" src="public/voice.mp3" data-start="0" data-duration="${voiceDuration}" data-track-index="2" data-volume="1"></audio>`;
  if(config.music && exists(config.music.file)) {
    const v=volume(config.music.volume);
    const automation={version:1,lanes:[{target:'volume',points:[{t:0,v:0},{t:.4,v},{t:voiceDuration,v},{t:duration-.05,v:0}]}]};
    audio+=`<audio id="music" class="clip" src="${escape(config.music.file)}" data-start="0" data-duration="${duration}" data-track-index="3" data-volume="${v}" data-automation="${escape(JSON.stringify(automation))}"></audio>`;
  }
  const priceAt=starts[2]+Math.min(.4,durations[2]*.10);
  const sounds=[['whoosh',starts[1],.35],['pop',priceAt,.08],['ding',starts[3]+.5,.6]];
  sounds.forEach(([name,start,d],i)=> { if(exists(`public/sfx/${name}.mp3`))audio+=`<audio id="sfx${i}" class="clip" src="public/sfx/${name}.mp3" data-start="${start}" data-duration="${Math.min(d,duration-start)}" data-track-index="${4+i}" data-volume="${volume(config.sfxVolume)}"></audio>`; });
  const script=`const tl=gsap.timeline({paused:true});
tl.fromTo('#progress',{scaleX:0},{scaleX:1,duration:${duration},ease:'none'},0);
tl.fromTo('#hook',{scale:0.82,opacity:0},{scale:1,opacity:1,duration:.38,ease:'back.out(1.8)'},0);
${starts.map((s,i)=>`tl.fromTo('#p${i+1}',{scale:.92,opacity:.75,y:24},{scale:1,opacity:1,y:0,duration:.45,ease:'power3.out'},${s});`).join('\n')}
${points.map((_,i)=>`tl.fromTo('#benefit${i}',{opacity:0,x:-35},{opacity:1,x:0,duration:.35,ease:'power3.out'},${starts[1]+i*Math.min(.65,durations[1]/4)});`).join('\n')}
${original?`tl.fromTo('#old',{opacity:0,y:-10},{opacity:1,y:0,duration:.25},${starts[2]});`:''}
tl.fromTo('#amount',{opacity:0,scale:.85,y:25},{opacity:1,scale:1,y:0,duration:.4,ease:'back.out(1.6)'},${priceAt});
${hasDiscount?`tl.fromTo('#discount',{opacity:0,scale:.85},{opacity:1,scale:1,duration:.3,ease:'back.out(1.6)'},${starts[2]+.1});`:''}
tl.fromTo(['#cta1','#cta2'],{opacity:0,y:30},{opacity:1,y:0,duration:.45,ease:'power3.out',stagger:.08},${starts[3]});
tl.fromTo('#button',{opacity:0,scale:.88,y:20},{opacity:1,scale:1,y:0,duration:.45,ease:'back.out(1.7)'},${starts[3]+.4});
${starts.map((s,i)=>`tl.fromTo('#c${i}',{opacity:0,y:8},{opacity:1,y:0,duration:.14},${s+.1});tl.to('#c${i}',{opacity:0,duration:.1},${s+durations[i]-.1});`).join('\n')}
window.__timelines=window.__timelines||{};window.__timelines['main']=tl;`;
  return {body,captions,audio,script,duration,starts,voiceDuration,meliFullImg};
}
function build(dir=__dirname) {
  const data=JSON.parse(fs.readFileSync(path.join(dir,'src/deal_data.json'),'utf8'));
  const config=JSON.parse(fs.readFileSync(path.join(dir,'template.config.json'),'utf8'));
  for(const color of Object.values(config.colors))if(!/^#[a-f\d]{6}$/i.test(color))throw new Error('Color inválido');
  const result=compile(data,config,f=>fs.existsSync(path.join(dir,f)));
  const actual=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path.join(dir,'public/voice.mp3')],{encoding:'utf8'}).trim());
  if(Math.abs(actual-result.voiceDuration)>1.5)throw new Error(`Audio (${actual}s) y escenas (${result.voiceDuration}s) no coinciden`);
  let html=fs.readFileSync(path.join(dir,'template.html.txt'),'utf8');
  html=html.replace(/<div id="s1"[\s\S]*?(?=<div class="brand">)/,result.body+'\n');
  html=html.replace(/<div class="brand">[\s\S]*?<\/div>\s*<\/div>/,`<div class="brand"><div><span>para eso</span><span>trabajo.</span></div><div class="meli-header-pill">${result.meliFullImg}</div></div>`);
  html=html.replace(/<div class="captions">[\s\S]*?<\/div>/,`<div class="captions">${result.captions}</div>`);
  html=html.replace(/<audio id="voice"[\s\S]*?<\/audio>/,result.audio);
  html=html.replace(/<script>[^]*?<\/script>/,`<script>\n${result.script}\n</script>`);
  html=html.replace('data-duration="30"',`data-duration="${result.duration}"`);
  const css=`
.scene{background:${config.colors.paper}}
.yellow{background:${config.colors.accent}}
body{color:${config.colors.ink}}
.brand{top:42px!important;left:50px!important;right:50px!important;font-size:32px!important}
.meli-header-pill{background:#FFE600;border:3px solid #141512;padding:10px 22px;border-radius:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,0.12)}
.meli-logo-full{height:52px;width:auto;display:block}
.meli-icon{height:42px;width:auto;display:block;flex-shrink:0}
.product-stage{position:absolute;background:#ffffff;border-radius:36px;padding:14px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.14);border:4px solid #141512;display:flex;align-items:center;justify-content:center}
.product{width:100%;height:100%;object-fit:contain;transform:scale(1.04)}
.product-zoom{transform:scale(1.14)}

/* ESCENA 1: PRECIO + DESCUENTO ARRIBA Y FOTO GIGANTE */
.s1-top-strip{position:absolute;top:145px;left:50px;right:50px;height:210px;background:#141512;border-radius:28px;display:flex;align-items:center;justify-content:space-between;padding:0 36px;color:#ffffff;box-shadow:0 16px 40px rgba(0,0,0,0.18)}
.s1-discount-pill{background:#ff2a00;color:#ffffff;font-size:64px;font-weight:900;padding:22px 32px;border-radius:20px;letter-spacing:-2px;line-height:1;text-transform:uppercase;box-shadow:0 8px 24px rgba(255,42,0,0.45)}
.s1-price-box{display:flex;flex-direction:column;align-items:flex-end;justify-content:center}
.s1-old{font-size:34px;font-weight:700;color:#a8a89e;text-decoration:line-through;letter-spacing:0}
.s1-offer{font-weight:900;color:${config.colors.accent};line-height:0.92;letter-spacing:-6px}
.stage-s1{left:50px;top:380px;width:980px;height:960px}
.stage-floating-tag{position:absolute;bottom:20px;right:20px;background:#141512;color:#FFE600;font-size:25px;font-weight:900;padding:12px 22px;border-radius:16px;letter-spacing:1px;display:flex;align-items:center;gap:14px;border:2px solid #FFE600;box-shadow:0 10px 24px rgba(0,0,0,0.25)}
.s1-title-card{position:absolute;left:50px;right:50px;top:1365px;height:215px;background:${config.colors.accent};border:4px solid #141512;border-radius:26px;padding:22px 32px;display:flex;align-items:center}
.s1-title-text{font-weight:900;line-height:1.12;color:#141512;letter-spacing:-1.5px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}

/* ESCENA 2: QUÉ ES Y QUÉ HACE + FOTO GRANDE */
.s2-top-bar{position:absolute;top:145px;left:50px;right:50px;display:flex;justify-content:space-between;align-items:center;background:#141512;color:#fff;padding:20px 32px;border-radius:22px}
.s2-badge{font-size:38px;font-weight:900;color:${config.colors.accent};letter-spacing:1px}
.s2-mini-price{font-size:42px;font-weight:900;background:#ff2a00;color:#fff;padding:8px 22px;border-radius:14px}
.stage-s2{left:50px;top:275px;width:980px;height:800px}
.benefits-list{position:absolute;left:50px;right:50px;top:1100px;display:flex;flex-direction:column;gap:18px}
.benefit-card{background:#141512;color:#ffffff;border-radius:22px;padding:24px 30px;display:flex;align-items:center;gap:24px;box-shadow:0 10px 28px rgba(0,0,0,0.14)}
.benefit-index{background:${config.colors.accent};color:#141512;font-size:32px;font-weight:900;min-width:64px;height:64px;border-radius:16px;display:flex;align-items:center;justify-content:center}
.benefit-text{font-weight:800;line-height:1.1;letter-spacing:-0.8px}

/* ESCENA 3: GOLPE DE PRECIO Y AHORRO + FOTO GRANDE */
.s3-price-hero{position:absolute;top:145px;left:50px;right:50px;background:#141512;color:#fff;border-radius:32px;padding:32px 40px;display:flex;flex-direction:column;align-items:center;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.2)}
.s3-price-row{display:flex;align-items:center;justify-content:center;gap:28px;width:100%;margin-bottom:8px}
.old{position:static!important;font-size:50px!important;font-weight:800;color:#a8a89e!important;text-decoration:line-through}
.discount{position:static!important;background:#ff2a00!important;color:#ffffff!important;padding:14px 28px!important;font-size:44px!important;font-weight:900;border-radius:18px}
.amount{position:static!important;font-weight:900;color:${config.colors.accent};line-height:0.92;letter-spacing:-10px!important;margin:6px 0 14px 0}
.s3-savings-banner{background:${config.colors.accent};color:#141512;font-size:35px;font-weight:900;padding:14px 28px;border-radius:16px;width:100%;letter-spacing:-0.5px}
.stage-s3{left:50px;top:730px;width:980px;height:860px}

/* ESCENA 4: CIERRE AGRESIVO + FOTO GRANDE + BOTÓN MASIVO */
.s4-header{position:absolute;top:145px;left:50px;right:50px;text-align:center}
.s4-kicker{display:inline-block;background:#ff2a00;color:#fff;font-size:36px;font-weight:900;padding:12px 28px;border-radius:16px;margin-bottom:14px}
.s4-headline{font-size:112px;font-weight:900;line-height:0.95;letter-spacing:-5px;color:#141512}
.stage-s4{left:50px;top:430px;width:980px;height:920px}
.button{position:absolute;top:1380px!important;left:50px!important;right:50px!important;background:#141512!important;color:#FFE600!important;padding:34px 36px!important;font-size:36px!important;font-weight:900;border-radius:26px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 18px 45px rgba(0,0,0,0.25);border:3px solid #141512}
.button-left{display:flex;align-items:center;gap:18px}
.button-arrow{background:#ff2a00;color:#fff;width:68px;height:68px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:44px;flex-shrink:0}

/* SUBTÍTULOS */
.captions{position:absolute;left:50px!important;right:50px!important;top:1625px!important;height:190px;display:flex;align-items:center;justify-content:center;z-index:25}
.caption{position:absolute;left:0;right:0;background:rgba(20,21,18,0.92);color:#ffffff;padding:20px 28px;border-radius:20px;font-weight:800;line-height:1.22;border:2px solid ${config.colors.accent};max-height:175px;overflow:hidden}
`;
  html=html.replace('</style>',css+'</style>');
  fs.writeFileSync(path.join(dir,'index.html'),html.trimEnd() + '\n');
  const hf=JSON.parse(fs.readFileSync(path.join(dir,'hyperframes.json'),'utf8'));hf.compositions[0].duration=result.duration;fs.writeFileSync(path.join(dir,'hyperframes.json'),JSON.stringify(hf,null,2));
  console.log(`Plantilla lista: ${result.duration}s, voz ${actual.toFixed(3)}s, música y SFX disponibles incluidos.`);
  return result;
}
module.exports={compile,build};
if(require.main===module)build();


