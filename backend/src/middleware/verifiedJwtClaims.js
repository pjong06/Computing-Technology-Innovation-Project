// Call only AFTER Supabase Auth has verified the original token.
// Decoding alone never authenticates a request.
function hasExpectedClaims(token, verifiedUserId, supabaseUrl) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3 || !supabaseUrl) return false;
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        let issuerEnd = supabaseUrl.length;
        while (issuerEnd > 0 && supabaseUrl[issuerEnd - 1] === '/') issuerEnd--;
        const expectedIssuer = `${supabaseUrl.slice(0, issuerEnd)}/auth/v1`;
        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        return claims.iss === expectedIssuer &&
            audiences.includes('authenticated') &&
            claims.sub === verifiedUserId;
    } catch {
        return false;
    }
}

module.exports = { hasExpectedClaims };
