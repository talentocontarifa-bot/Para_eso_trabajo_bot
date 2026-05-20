// ============================================
// SCHEDULER — Para eso trabajo
// Calendariza los posts DIRECTAMENTE en Facebook
// Facebook los publica solo en la fecha/hora exacta
// Tu computadora NO necesita estar encendida
// ============================================
require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const { PAGE_ACCESS_TOKEN, PAGE_ID } = process.env;
const QUEUE_FILE = path.join(__dirname, 'queue.json');

function scheduleOnFacebook(message, link, scheduledDate) {
  return new Promise((resolve, reject) => {
    let dateStr = scheduledDate;
    // Si la fecha no especifica zona horaria, forzar zona horaria de México (UTC-6)
    if (!dateStr.includes('Z') && !dateStr.match(/[+-]\d{2}:?\d{2}$/)) {
      dateStr += '-06:00';
    }
    const unixTimestamp = Math.floor(new Date(dateStr).getTime() / 1000);

    const postData = JSON.stringify({
      message,
      link,
      scheduled_publish_time: unixTimestamp,
      published: false,          // ← clave: Facebook lo guarda y publica solo
      access_token: PAGE_ACCESS_TOKEN
    });

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v25.0/${PAGE_ID}/feed`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runScheduler() {
  console.log('\n📅 Calendarizando posts en Facebook...');
  console.log('   (Facebook los publicará solo — sin necesidad de tu PC)\n');

  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  const now = new Date();
  let scheduled = 0;
  let skipped = 0;

  for (const post of queue) {
    const scheduledDate = new Date(post.scheduled_date);

    if (post.status === 'published' || post.status === 'scheduled') {
      console.log(`⏭️  [${post.id}] Ya procesado (${post.status}): ${post.producto}`);
      skipped++;
      continue;
    }

    // Facebook requiere que sea mínimo 10 minutos en el futuro
    const minDate = new Date(now.getTime() + 10 * 60 * 1000);
    if (scheduledDate < minDate) {
      // Si la fecha ya pasó o está muy cerca, ajustar a 15 min desde ahora
      console.log(`⚠️  [${post.id}] Fecha pasada, ajustando a 15 min desde ahora...`);
      post.scheduled_date = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    }

    console.log(`📌 [${post.id}] Calendarizando: ${post.producto}`);
    console.log(`   ⏰ Fecha: ${new Date(post.scheduled_date).toLocaleString('es-MX')}`);

    try {
      const result = await scheduleOnFacebook(post.copy, post.link, post.scheduled_date);

      if (result.error) {
        console.log(`   ❌ Error: ${result.error.message}`);
      } else {
        console.log(`   ✅ ¡Calendarizado! Facebook Post ID: ${result.id}`);
        post.status = 'scheduled';
        post.fb_post_id = result.id;
        post.scheduled_at = new Date().toISOString();
        scheduled++;
      }
    } catch (err) {
      console.log(`   ❌ Error de red: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));

  console.log('\n' + '━'.repeat(50));
  console.log(`✅ Posts calendarizados en Facebook: ${scheduled}`);
  console.log(`⏭️  Ya procesados anteriormente: ${skipped}`);
  console.log('\n🎉 Facebook publicará cada post automáticamente.');
  console.log('   Tu computadora NO necesita estar encendida.');
  console.log('━'.repeat(50) + '\n');
}

runScheduler().catch(console.error);
