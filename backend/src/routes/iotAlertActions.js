const express =
  require('express');

const router =
  express.Router();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const columns =
  'id,alert_status,acknowledged_by,acknowledged_at,resolved_by,resolved_at,resolution_notes';


/* Alert status transition */

function transition(
  from,
  to
) {
  return async (
    req,
    res
  ) => {
    res.set(
      'Cache-Control',
      'no-store'
    );

    if (
      !UUID.test(
        req.params.alertId
      )
    ) {
      return res.sendStatus(
        400
      );
    }

    const body =
      req.body || {};

    const allowedKeys =
      to === 'resolved'
        ? ['resolution_notes']
        : [];

    if (
      typeof body !==
        'object' ||
      Array.isArray(body) ||
      Object.keys(
        body
      ).some(
        (key) =>
          !allowedKeys.includes(
            key
          )
      )
    ) {
      return res.sendStatus(
        400
      );
    }

    if (
      body.resolution_notes !==
        undefined &&
      (
        typeof body.resolution_notes !==
          'string' ||
        body.resolution_notes.length >
          2000
      )
    ) {
      return res.sendStatus(
        400
      );
    }

    try {
      const current =
        await req.supabase
          .from('alerts')
          .select(columns)
          .eq(
            'id',
            req.params.alertId
          )
          .maybeSingle();

      if (
        current.error
      ) {
        return res.sendStatus(
          503
        );
      }

      if (
        !current.data
      ) {
        return res.sendStatus(
          404
        );
      }

      if (
        current.data
          .alert_status ===
        to
      ) {
        return res.json({
          data:
            current.data,

          unchanged:
            true,
        });
      }

      if (
        current.data
          .alert_status !==
        from
      ) {
        return res
          .status(409)
          .json({
            message:
              'Invalid alert state transition',
          });
      }

      const patch = {
        alert_status:
          to,
      };

      if (
        to ===
        'resolved'
      ) {
        patch.resolution_notes =
          body
            .resolution_notes
            ?.trim() ||
          null;
      }

      const updated =
        await req.supabase
          .from('alerts')
          .update(patch)
          .eq(
            'id',
            req.params.alertId
          )
          .eq(
            'alert_status',
            from
          )
          .select(columns)
          .maybeSingle();

      if (
        updated.error
      ) {
        return res.sendStatus(
          503
        );
      }

      if (
        !updated.data
      ) {
        return res
          .status(409)
          .json({
            message:
              'Alert changed; refresh and retry',
          });
      }

      return res.json({
        data:
          updated.data,
      });
    } catch {
      return res.sendStatus(
        503
      );
    }
  };
}


/* Acknowledge */

router.patch(
  '/alerts/:alertId/acknowledge',
  transition(
    'open',
    'acknowledged'
  )
);


/* Resolve */

router.patch(
  '/alerts/:alertId/resolve',
  transition(
    'acknowledged',
    'resolved'
  )
);


/* Permanent delete */

router.delete(
  '/alerts/:alertId',
  async (
    req,
    res
  ) => {
    res.set(
      'Cache-Control',
      'no-store'
    );

    if (
      !UUID.test(
        req.params.alertId
      )
    ) {
      return res.sendStatus(
        400
      );
    }

    if (
      req.profile?.role !==
      'officer'
    ) {
      return res
        .status(403)
        .json({
          message:
            'Only a Conservation Officer can delete an alert.',
        });
    }

    try {
      const current =
        await req.supabase
          .from('alerts')
          .select('id')
          .eq(
            'id',
            req.params.alertId
          )
          .maybeSingle();

      if (
        current.error
      ) {
        return res.sendStatus(
          503
        );
      }

      if (
        !current.data
      ) {
        return res.sendStatus(
          404
        );
      }

      /* Read linked camera files */

      const evidence =
        await req.supabase
          .from(
            'alert_camera_evidence'
          )
          .select(
            'file_path'
          )
          .eq(
            'alert_id',
            req.params.alertId
          );

      if (
        evidence.error
      ) {
        console.error(
          'Camera evidence lookup failed:',
          evidence.error
        );

        return res
          .status(503)
          .json({
            message:
              'Could not inspect camera evidence.',
          });
      }

      const filePaths =
        (
          evidence.data ||
          []
        )
          .map(
            (item) =>
              item.file_path
          )
          .filter(Boolean);

      /* Delete alert */

      const deleted =
        await req.supabase
          .from('alerts')
          .delete()
          .eq(
            'id',
            req.params.alertId
          )
          .select('id')
          .maybeSingle();

      if (
        deleted.error
      ) {
        console.error(
          'Alert deletion failed:',
          deleted.error
        );

        return res
          .status(503)
          .json({
            message:
              'Could not delete alert.',
          });
      }

      if (
        !deleted.data
      ) {
        return res.sendStatus(
          404
        );
      }

      /* Delete private camera photos */

      let cameraCleanupPending =
        false;

      if (
        filePaths.length >
        0
      ) {
        const removal =
          await req.supabase
            .storage
            .from(
              'camera-evidence'
            )
            .remove(
              filePaths
            );

        if (
          removal.error
        ) {
          console.error(
            'Camera storage cleanup failed:',
            removal.error
          );

          cameraCleanupPending =
            true;
        }
      }

      return res.json({
        message:
          'Alert deleted permanently.',

        data: {
          id:
            deleted.data.id,

          camera_files_deleted:
            filePaths.length,

          camera_cleanup_pending:
            cameraCleanupPending,
        },
      });
    } catch (error) {
      console.error(
        'Alert deletion failed:',
        error
      );

      return res
        .status(503)
        .json({
          message:
            'Could not delete alert.',
        });
    }
  }
);


module.exports =
  router;