// Usage: OPENROUTER_API_KEY=... node gen-asset.mjs <outfile.png> "<prompt>" [reference.png]
// ponytail: sequential single-image generator, parallelize by running N processes
import fs from 'node:fs'
const [out, prompt, ref] = process.argv.slice(2)
const key = process.env.OPENROUTER_API_KEY
if (!key || !out || !prompt) { console.error('missing args/key'); process.exit(1) }

const content = ref
  ? [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${fs.readFileSync(ref).toString('base64')}` } },
    ]
  : prompt

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'openai/gpt-5.4-image-2',
    messages: [{ role: 'user', content }],
    modalities: ['image', 'text'],
  }),
})
const json = await res.json()
const img = json.choices?.[0]?.message?.images?.[0]?.image_url?.url
if (!img) { console.error('no image:', JSON.stringify(json).slice(0, 800)); process.exit(1) }
await fs.promises.writeFile(out, Buffer.from(img.split(',')[1], 'base64'))
console.log('wrote', out)
