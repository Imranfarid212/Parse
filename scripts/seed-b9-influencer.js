const { Client } = require('pg');

const code = String(process.env.INFLUENCER_CODE || '').trim().toUpperCase();
const payoutContact = String(process.env.INFLUENCER_PAYOUT_CONTACT || '').trim();
const apply = process.argv.includes('--apply');
const production = process.env.EXPO_PUBLIC_ENV === 'production';

if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new Error('INFLUENCER_CODE must use 6 unambiguous characters.');
if (!payoutContact) throw new Error('INFLUENCER_PAYOUT_CONTACT is required.');
if (production && !process.argv.includes('--allow-production')) throw new Error('Production requires --allow-production.');
if (!apply) {
  console.log('[b9:influencer] dry run valid - pass --apply to insert the code');
  process.exit(0);
}

const db = new Client({ connectionString: process.env.SUPABASE_DB_URL });
void db.connect().then(async () => {
  try {
    await db.query(
      `insert into public.referral_codes (code,kind,commission_rate,max_uses,active,payout_contact)
       values ($1,'influencer',0.15,null,true,$2)`, [code, payoutContact],
    );
    console.log(`[b9:influencer] created ${code}`);
  } finally { await db.end(); }
}).catch((error) => { console.error(`[b9:influencer] failed: ${error.message}`); process.exit(1); });
