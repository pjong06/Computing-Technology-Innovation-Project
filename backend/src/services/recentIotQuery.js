
'use strict';

function parseDate(value, endOfDay = false) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (dateOnly) {
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);

    if (Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value) {
      return null;
    }

    return date.toISOString();
  }

  // Require an explicit timezone for date-time values.
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? null
    : timestamp.toISOString();
}

function recentIotQuery({ table, columns, orderBy, message, failure }) {
  return async (req, res) => {
   const { from, to, station_id: stationId, page, page_size: pageSize } = req.query || {};

    const start = from === undefined ? null : parseDate(from);
    const end = to === undefined ? null : parseDate(to, true);

    if ((from !== undefined && start === null) ||
        (to !== undefined && end === null) ||
        (start && end && start > end)) {
      return res.status(400).json({ message: 'Invalid date range' });
    }

    // Station IDs in sensor_readings are database UUIDs.
    if (stationId !== undefined &&
        (typeof stationId !== 'string' ||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stationId))) {
      return res.status(400).json({ message: 'Invalid station_id' });
    }

    const safePage = page === undefined ? 1 : Number(page);
    const safePageSize = pageSize === undefined ? 100 : Number(pageSize);

    if (!Number.isSafeInteger(safePage) || safePage < 1 ||
        !Number.isSafeInteger(safePageSize) ||
        safePageSize < 1 || safePageSize > 100) {
      return res.status(400).json({ message: 'Invalid pagination parameters' });
    }

    const startIndex = (safePage - 1) * safePageSize;
    const endIndex = startIndex + safePageSize - 1;

    if (!Number.isSafeInteger(startIndex) ||
        !Number.isSafeInteger(endIndex)) {
      return res.status(400).json({ message: 'Pagination range is too large' });
    }

    try {
      let query = req.supabase
        .from(table)
        .select(columns)
        .order(orderBy, { ascending: false })
        .order('id', { ascending: false });

      if (start) query = query.gte(orderBy, start);
      if (end) query = query.lte(orderBy, end);
      if (stationId) query = query.eq('station_id', stationId);

      const { data, error } = await query.range(startIndex, endIndex);

      if (error) {
        return res.status(500).json({ message: failure });
      }

      return res.json({
        message,
        data,
        pagination: {
          page: safePage,
          page_size: safePageSize
        }
      });
    } catch {
      return res.status(500).json({ message: 'Internal server error' });
    }
  };
}

module.exports = { recentIotQuery };
