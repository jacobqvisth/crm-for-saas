// Import Estonia auto repair shops into discovered_shops table
// Run with: node scripts/import-estonia-shops.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
})

const dataPath = join(__dirname, 'estonia-shops-data.json')
const rows = JSON.parse(readFileSync(dataPath, 'utf8'))
console.log(`Loaded ${rows.length} shops from ${dataPath}`)

const BATCH_SIZE = 50
let inserted = 0
let errors = 0

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE)
  const { error } = await supabase
    .from('discovered_shops')
    .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })

  if (error) {
    console.error(`\nBatch ${Math.floor(i/BATCH_SIZE)+1} error:`, error.message)
    errors += batch.length
  } else {
    inserted += batch.length
    process.stdout.write(`\rProgress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`)
  }
}

console.log(`\n`)
console.log(`✅ Done!`)
console.log(`   Rows processed: ${inserted}`)
if (errors) console.log(`   Errors: ${errors}`)

const { count } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
console.log(`   Total in discovered_shops table: ${count}`)
