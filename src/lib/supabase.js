"use strict";

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || (!supabaseAnonKey && !supabaseServiceKey)) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_KEY — check your .env file",
  );
}

// Default client (uses service key if available, else anon)
const adminClient = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

/**
 * Creates a client scoped to a specific user's token.
 * This ensures auth.uid() in RLS policies works correctly.
 */
function getClient(userToken) {
  if (supabaseServiceKey) return adminClient;
  if (!userToken) return adminClient;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } }
  });
}

module.exports = adminClient;
module.exports.getClient = getClient;
