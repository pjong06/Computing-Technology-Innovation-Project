const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

router.use(
  require('../middleware/iotAccess')
);

const {
  recentIotQuery,
} = require('../services/recentIotQuery');

const {
  getLatestReadings,
  getRecentReadings,
  getSummary,
} = require('../services/iotTelemetryService');

const {
  getAlerts,
  getActiveAlerts,
} = require('../services/iotAlertService');

let serverProfileClient = null;


/* Get backend-only Supabase client */

function getServerProfileClient() {
  const key =
    process.env.IOT_DATABASE_SERVER_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (
    !key ||
    !process.env.SUPABASE_URL
  ) {
    return null;
  }

  if (!serverProfileClient) {
    serverProfileClient =
      createClient(
        process.env.SUPABASE_URL,
        key,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );
  }

  return serverProfileClient;
}


/* Read staff display names */

async function getActorNames(
  req,
  actorIds
) {
  const names =
    new Map();

  if (
    actorIds.length === 0
  ) {
    return names;
  }

  /* Try normal authenticated access first */

  try {
    const {
      data,
      error,
    } =
      await req.supabase
        .from('profiles')
        .select(
          'id, full_name'
        )
        .in(
          'id',
          actorIds
        );

    if (!error) {
      for (
        const profile of
        data || []
      ) {
        if (
          profile.id &&
          profile.full_name
        ) {
          names.set(
            profile.id,
            profile.full_name
          );
        }
      }
    }
  } catch (error) {
    console.warn(
      'IoT profile lookup failed:',
      error
    );
  }

  const missingIds =
    actorIds.filter(
      (id) =>
        !names.has(id)
    );

  if (
    missingIds.length === 0
  ) {
    return names;
  }

  /* Use backend credential for names hidden by profile RLS */

  const serverClient =
    getServerProfileClient();

  if (!serverClient) {
    return names;
  }

  try {
    const {
      data,
      error,
    } =
      await serverClient
        .from('profiles')
        .select(
          'id, full_name'
        )
        .in(
          'id',
          missingIds
        );

    if (error) {
      console.warn(
        'IoT server profile lookup failed:',
        error
      );

      return names;
    }

    for (
      const profile of
      data || []
    ) {
      if (
        profile.id &&
        profile.full_name
      ) {
        names.set(
          profile.id,
          profile.full_name
        );
      }
    }
  } catch (error) {
    console.warn(
      'IoT server profile lookup failed:',
      error
    );
  }

  return names;
}


/* Add staff names to persistent alerts */

async function enrichAlertActors(
  req,
  alerts
) {
  const actorIds = [
    ...new Set(
      alerts
        .flatMap(
          (alert) => [
            alert.acknowledged_by,
            alert.resolved_by,
          ]
        )
        .filter(Boolean)
    ),
  ];

  const names =
    await getActorNames(
      req,
      actorIds
    );

  return alerts.map(
    (alert) => ({
      ...alert,

      acknowledged_by_name:
        alert.acknowledged_by
          ? names.get(
              alert.acknowledged_by
            ) || null
          : null,

      resolved_by_name:
        alert.resolved_by
          ? names.get(
              alert.resolved_by
            ) || null
          : null,
    })
  );
}


/* Persistent sensor history */

router.get(
  '/readings/history',
  recentIotQuery({
    table:
      'sensor_readings',

    columns:
      'id,station_id,recorded_at,received_at,temperature_c,humidity_percent,movement_detected,soil_raw,soil_moisture_pct,distance_cm,distance_valid,rain_raw,rain_intensity_pct,dht_valid,sequence,uptime_ms,vibration_level,battery_percent',

    orderBy:
      'recorded_at',

    message:
      'Sensor readings retrieved successfully',

    failure:
      'Failed to retrieve sensor readings',
  })
);


/* Live MQTT readings */

router.get(
  '/readings',
  (req, res) => {
    res.json({
      message:
        'Sensor readings retrieved successfully',

      data:
        getRecentReadings(
          req.query.limit
        ),
    });
  }
);


router.get(
  '/latest',
  (_req, res) => {
    res.json({
      message:
        'Latest station readings retrieved successfully',

      data:
        getLatestReadings(),
    });
  }
);


/* Registered station summary */

router.get('/summary', async (req, res) => {
  try {
    const { data: stations, error } =
      await req.supabase
        .from('sensor_stations')
        .select(
          'id, station_code, station_status, last_seen_at'
        )
        .order(
          'station_code',
          {
            ascending: true,
          }
        );

    if (error) {
      console.error(
        'IoT summary error:',
        error
      );

      return res
        .status(500)
        .json({
          message:
            'Failed to retrieve IoT dashboard summary',
        });
    }

    const stationList =
      Array.isArray(stations)
        ? stations
        : [];

    const totalStations =
      stationList.length;

    const activeStations =
      stationList.filter(
        (station) =>
          station.station_status ===
          'active'
      ).length;

    return res.json({
      message:
        'IoT dashboard summary retrieved successfully',

      data: {
        total_stations:
          totalStations,

        active_stations:
          activeStations,

        stations:
          stationList,
      },
    });
  } catch (error) {
    console.error(
      'IoT summary error:',
      error
    );

    return res
      .status(500)
      .json({
        message:
          'Internal server error',
      });
  }
});


/* Live station summary */

router.get(
  '/summary/live',
  (_req, res) => {
    res.json({
      message:
        'IoT dashboard summary retrieved successfully',

      data:
        getSummary(),
    });
  }
);


/* Persistent alerts */

router.get(
  '/alerts',
  async (
    req,
    res
  ) => {
    try {
      const {
        data,
        error,
      } =
        await req.supabase
          .from('alerts')
          .select(
            'id,station_id,reading_id,alert_message,severity,alert_status,triggered_at,acknowledged_by,acknowledged_at,resolved_by,resolved_at,resolution_notes'
          )
          .order(
            'triggered_at',
            {
              ascending: false,
            }
          )
          .limit(100);

      if (error) {
        console.error(
          'IoT alert query error:',
          error
        );

        return res
          .status(500)
          .json({
            message:
              'Failed to retrieve IoT alerts',
          });
      }

      const alerts =
        await enrichAlertActors(
          req,
          data || []
        );

      return res.json({
        message:
          'IoT alerts retrieved successfully',

        data:
          alerts,
      });
    } catch (error) {
      console.error(
        'IoT alert query error:',
        error
      );

      return res
        .status(500)
        .json({
          message:
            'Internal server error',
        });
    }
  }
);


/* Live threat alerts */

router.get(
  '/alerts/live',
  (
    req,
    res
  ) => {
    const status =
      req.query.status ||
      'all';

    const limit =
      req.query.limit ===
      undefined
        ? 100
        : Number(
            req.query.limit
          );

    if (
      ![
        'all',
        'active',
        'resolved',
      ].includes(
        status
      )
    ) {
      return res
        .status(400)
        .json({
          message:
            'Invalid alert status',
        });
    }

    if (
      !Number.isInteger(
        limit
      ) ||
      limit < 1 ||
      limit > 500
    ) {
      return res
        .status(400)
        .json({
          message:
            'limit must be an integer from 1 to 500',
        });
    }

    const active =
      getActiveAlerts();

    return res.json({
      data:
        getAlerts({
          status:
            status ===
            'all'
              ? undefined
              : status,

          limit,
        }),

      summary: {
        active:
          active.length,

        critical:
          active.filter(
            (alert) =>
              alert.severity ===
              'critical'
          ).length,

        warning:
          active.filter(
            (alert) =>
              alert.severity ===
              'warning'
          ).length,
      },
    });
  }
);


router.use(
  require('./iotAlertActions')
);

module.exports =
  router;