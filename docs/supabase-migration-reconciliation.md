# Shared Supabase migration reconciliation

Compared the repository migrations with the shared database on 15 November 2026. An absent history row is a candidate for schema comparison.

| Repository migration | Observed state and next action |
| --- | --- |
| tag_reservations | Applied and recorded as 20261115123054_tag_reservations. Verified 269 existing formal tags were registered as bound, with both functions and the enforcement trigger enabled. Reconcile the version mapping before automated deployment. |
| public_plant_tag_pending | The live boolean function exists and anon can execute it. The deployed visitor page showed Being verified for NIAH-PLT-00004. Confirm the full definition and grants before repairing history. |
| unify_iot_alert_rules | Renumbered to 20261115090001 to remove the repository version collision with public_plant_tag_pending. SQL content is unchanged. The audit found a different alert function and missing soil and rain defaults. Review and test with the IoT owner. |
| sensor_station_locations | The audit found latitude, longitude and location_note absent. Coordinate rollout with the IoT owner. |
| allow_visits_on_approved_readable_plants | The live sync function and observation INSERT policy still restrict the Botanist path to owned plants. Review both mechanisms together before rollout. |
| Other unmatched entries | Main schema objects were observed or superseded for earlier QR, account, sync, species/media and map changes. Check definitions, privileges, constraints and data effects individually before recording history. |

Apply only reviewed migrations against the current schema. Older SQL can replace newer function definitions. Reconcile the shared history before enabling automatic migration deployment. PR changes are repository-only.
