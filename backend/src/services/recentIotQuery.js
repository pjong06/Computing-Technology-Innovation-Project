// Shared bounded history query. Route configuration is server-owned, not input.
function recentIotQuery({ table, columns, orderBy, message, failure }) {
  return async (req, res) => {
    try {
      const { data, error } = await req.supabase.from(table).select(columns)
        .order(orderBy, { ascending: false }).limit(100);
      if (error) return res.status(500).json({ message: failure });
      return res.json({ message, data });
    } catch {
      return res.status(500).json({ message: 'Internal server error' });
    }
  };
}
module.exports = { recentIotQuery };
