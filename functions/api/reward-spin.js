// Lucky Reward Wheel API endpoint
// Uses existing D1 binding (DB), same patterns as order.js

const REWARDS = [
  { amount: 100, label: "\u20b9100 Cash Reward", weight: 35 },
  { amount: 250, label: "\u20b9250 Cash Reward", weight: 30 },
  { amount: 500, label: "\u20b9500 Cash Reward", weight: 20 },
  { amount: 1000, label: "\u20b91000 Cash Reward", weight: 15 }
];

function corsHeaders(env) {
  const origin = (env && env.ALLOWED_ORIGIN) || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  };
}

function pickReward() {
  const totalWeight = REWARDS.reduce((sum, r) => sum + r.weight, 0);
  let random = Math.random() * totalWeight;
  for (const reward of REWARDS) {
    random -= reward.weight;
    if (random <= 0) return { amount: reward.amount, label: reward.label };
  }
  return { amount: 100, label: "\u20b9100 Cash Reward" };
}

function generateRewardId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `AVN-RWD-${ts}-${rand}`;
}

function cleanPhone(phone) {
  return phone.replace(/\D/g, '').slice(-10);
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = corsHeaders(env);
  
  try {
    const body = await request.json();
    const rawPhone = body.phone || '';
    const name = (body.name || '').trim().slice(0, 100);
    const phone = cleanPhone(rawPhone);
    
    if (!phone || phone.length !== 10) {
      return jsonResponse({ success: false, error: 'Valid 10-digit mobile number is required' }, 400, headers);
    }
    
    // Check existing reward for this phone
    const existing = await env.DB.prepare(
      'SELECT reward_id, reward_amount, reward_label, status, created_at FROM rewards WHERE phone = ? ORDER BY id DESC LIMIT 1'
    ).bind(phone).first();
    
    if (existing) {
      return jsonResponse({
        success: true,
        existing: true,
        reward_id: existing.reward_id,
        reward_amount: existing.reward_amount,
        reward_label: existing.reward_label,
        status: existing.status,
        created_at: existing.created_at
      }, 200, headers);
    }
    
    // New spin - pick a reward
    const reward = pickReward();
    const rewardId = generateRewardId();
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
    const ua = request.headers.get('User-Agent') || '';
    
    // Insert into D1
    await env.DB.prepare(
      'INSERT INTO rewards (reward_id, phone, name, reward_amount, reward_label, status, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, \'claimed\', ?, ?)'
    ).bind(rewardId, phone, name, reward.amount, reward.label, ip, ua).run();
    
    return jsonResponse({
      success: true,
      existing: false,
      reward_id: rewardId,
      reward_amount: reward.amount,
      reward_label: reward.label,
      status: 'claimed',
      message: `\ud83c\udf89 Congratulations! You have won ${reward.label}.`
    }, 200, headers);
    
  } catch (err) {
    console.error('Reward spin error:', err);
    return jsonResponse({ success: false, error: 'Server error. Please try again.' }, 500, headers);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const headers = corsHeaders(env);
  
  try {
    const url = new URL(request.url);
    const phone = cleanPhone(url.searchParams.get('phone') || '');
    
    if (!phone || phone.length !== 10) {
      return jsonResponse({ success: false, error: 'Valid 10-digit phone number required' }, 400, headers);
    }
    
    const existing = await env.DB.prepare(
      'SELECT reward_id, reward_amount, reward_label, status, created_at FROM rewards WHERE phone = ? ORDER BY id DESC LIMIT 1'
    ).bind(phone).first();
    
    if (existing) {
      return jsonResponse({ success: true, found: true, reward: existing }, 200, headers);
    }
    
    return jsonResponse({ success: true, found: false }, 200, headers);
    
  } catch (err) {
    console.error('Reward lookup error:', err);
    return jsonResponse({ success: false, error: 'Server error' }, 500, headers);
  }
}


export async function onRequestPatch(context) {
  const { request, env } = context;
  const headers = corsHeaders(env);
  
  try {
    const body = await request.json();
    const rewardId = (body.reward_id || '').trim();
    const newStatus = (body.status || '').trim();
    const phone = cleanPhone(body.phone || '');
    
    if (!rewardId || !newStatus) {
      return jsonResponse({ success: false, error: 'reward_id and status are required' }, 400, headers);
    }
    
    const validStatuses = ['claimed', 'pending_confirmation', 'delivered', 'paid_out', 'expired'];
    if (!validStatuses.includes(newStatus)) {
      return jsonResponse({ success: false, error: 'Invalid status' + newStatus }, 400, headers);
    }
    
    // Find the reward by reward_id or phone
    let existing;
    if (rewardId) {
      existing = await env.DB.prepare(
        'SELECT id, reward_id, phone, status FROM rewards WHERE reward_id = ?'
      ).bind(rewardId).first();
    } else if (phone) {
      existing = await env.DB.prepare(
        'SELECT id, reward_id, phone, status FROM rewards WHERE phone = ? ORDER BY id DESC LIMIT 1'
      ).bind(phone).first();
    }
    
    if (!existing) {
      return jsonResponse({ success: false, error: 'Reward not found' }, 404, headers);
    }
    
    const now = new Date().toISOString();
    const claimedAt = newStatus === 'paid_out' ? `, claimed_at = '${now}'` : '';
    
    await env.DB.prepare(
      `UPDATE rewards SET status = ?${claimedAt} WHERE id = ?`
    ).bind(newStatus, existing.id).run();
    
    return jsonResponse({
      success: true,
      reward_id: existing.reward_id,
      status: newStatus,
      message: `Reward status updated to ${newStatus}`
    }, 200, headers);
    
  } catch (err) {
    console.error('Reward update error:', err);
    return jsonResponse({ success: false, error: 'Server error' }, 500, headers);
  }
}

export async function onRequestOptions(context) {
  const { env } = context;
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}
