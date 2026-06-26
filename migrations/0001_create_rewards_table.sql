-- Create rewards table for Lucky Reward Wheel
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reward_id TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  name TEXT DEFAULT '',
  reward_amount INTEGER NOT NULL,
  reward_label TEXT NOT NULL,
  order_id TEXT DEFAULT '',
  status TEXT DEFAULT 'claimed',
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  claimed_at TEXT DEFAULT NULL
);

-- Index for fast phone lookup
CREATE INDEX IF NOT EXISTS idx_rewards_phone ON rewards(phone);

-- Index for reward_id lookup
CREATE INDEX IF NOT EXISTS idx_rewards_reward_id ON rewards(reward_id);
