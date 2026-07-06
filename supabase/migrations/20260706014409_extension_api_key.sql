-- Personal API key for the Chrome extension. Only the SHA-256 hex of the key
-- is stored (keys are 256-bit random, so an unsalted hash is sufficient and an
-- indexed equality lookup is timing-safe); the plaintext is shown once at
-- generation and never retrievable.
alter table public.profiles
  add column api_key_hash text unique,
  add column api_key_created_at timestamptz;
