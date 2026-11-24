import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const authRoleSource = fs.readFileSync(
  path.resolve(here, '../context/AuthRoleContext.tsx'),
  'utf8'
);

test('a previously verified staff identity is restored when Supabase is unreachable', () => {
  assert.match(authRoleSource, /const AUTH_IDENTITY_CACHE_KEY = 'niah-verified-auth-identity'/);
  assert.match(authRoleSource, /isAuthRetryableFetchError\(sessionError\)/);
  assert.match(authRoleSource, /isAuthRetryableFetchError\(authError\)/);
  assert.match(authRoleSource, /restoreCachedIdentity\(sessionUserId\)/);
  assert.match(authRoleSource, /userId: authData\.user\.id,\s*role: activeRole,\s*userName: verifiedName/);
});

test('the offline identity cannot cross accounts and is cleared for guest mode and logout', () => {
  assert.match(authRoleSource, /expectedUserId && cached\.userId !== expectedUserId/);
  assert.match(authRoleSource, /const setVisitorMode = async \(\) => \{[\s\S]*?await clearCachedIdentity\(\)/);
  assert.match(authRoleSource, /const logout = async \(\) => \{[\s\S]*?await clearCachedIdentity\(\)/);
  assert.doesNotMatch(authRoleSource, /setRole\('botanist'\)/);
});
