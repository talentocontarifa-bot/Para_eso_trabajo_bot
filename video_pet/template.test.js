const {test}=require('node:test');
const assert=require('node:assert/strict');
const {compile}=require('./build_template');
const config=require('./template.config.json');
const sample=require('./src/deal_data.json');
test('timings follow concatenated voice instead of artificial pauses',()=>{
 const r=compile(sample,config);assert.equal(r.starts[1],sample.scenes[0].audio_duration);
 assert.ok(Math.abs(r.voiceDuration-29.208)<.001);
 assert.ok(r.audio.includes('id="music"'));assert.ok(r.audio.includes('id="sfx2"'));
});
test('long names and large prices remain data; HTML is escaped',()=>{
 const r=compile({...sample,product_title:'Perfume <especial> & edición de colección '.repeat(4),offer_price:'123,456.78'},config);
 assert.ok(r.body.includes('&lt;especial&gt;'));assert.ok(r.body.includes('$123,456.78'));assert.ok(!r.body.includes('Sony'));
});
test('missing optional audio is omitted; missing photo fails',()=>{
 const r=compile(sample,config,p=>p==='public/product.png');assert.ok(!r.audio.includes('id="music"'));
 assert.throws(()=>compile(sample,config,()=>false),/imagen principal/);
});
test('invalid timing fails before video generation',()=>{
 const bad=structuredClone(sample);bad.scenes[2].audio_duration=0;assert.throws(()=>compile(bad,config),/Duración/);
});
test('unknown original price and discount are omitted',()=>{
 const r=compile({...sample,original_price:null,discount_percentage:null},config);assert.ok(!r.body.includes('id="old"'));assert.ok(!r.body.includes('id="discount"'));
});
