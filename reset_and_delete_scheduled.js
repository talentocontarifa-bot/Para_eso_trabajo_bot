require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const { PAGE_ACCESS_TOKEN } = process.env;
const QUEUE_FILE = path.join(__dirname, 'queue.json');

function deletePost(postId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v25.0/${postId}?access_token=${PAGE_ACCESS_TOKEN}`,
      method: 'DELETE'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  let deletedCount = 0;

  for (const post of queue) {
    if (post.status === 'scheduled' && post.fb_post_id) {
      console.log(`Eliminando post en Facebook: ${post.fb_post_id}`);
      const res = await deletePost(post.fb_post_id);
      if (res.error) {
        console.error(`Error eliminando ${post.fb_post_id}:`, res.error.message);
      } else {
        console.log(`✅ Eliminado correctamente.`);
        deletedCount++;
      }
      
      // Reseteamos el estado local para que se vuelva a calendarizar
      post.status = 'pending';
      delete post.fb_post_id;
      delete post.scheduled_at;
    }
  }

  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  console.log(`\n🎉 Operación completada: Se eliminaron ${deletedCount} posts programados y se reseteó la cola local.`);
}

main().catch(console.error);
