const express = require("express");
const { randomUUID } = require("crypto");
const { requireAuth } = require("../middleware/auth");
const upload = require("../services/storageService");

const router = express.Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textIdPattern = /^[a-zA-Z0-9_-]+$/;
const OFFICER_ONLY_MESSAGE = "Only the officer can change the website data";

// Shared mobile observations are the source of truth for website review data.
// This endpoint is read-only: decisions must go through /api/officer/reviews.
router.get("/observations", requireAuth, async (req, res) => {
    try {
        const { data: observations, error } = await req.supabase
            .from("observations")
            .select("id, plant_id, observer_id, observed_at, notes, review_status, deleted_at")
            .is("deleted_at", null)
            .order("observed_at", { ascending: false })
            .limit(1000);
        if (error) throw error;
        const plantIds = [...new Set((observations || []).map(o => o.plant_id).filter(Boolean))];
        const observerIds = [...new Set((observations || []).map(o => o.observer_id).filter(Boolean))];
        const { data: plants, error: pe } = plantIds.length
            ? await req.supabase.from("plants")
                .select("id, species_id, location_description")
                .in("id", plantIds)
            : { data: [], error: null };
        if (pe) throw pe;
        const speciesIds = [...new Set((plants || []).map(p => p.species_id).filter(Boolean))];
        const { data: species, error: se } = speciesIds.length
            ? await req.supabase.from("species")
                .select("id, scientific_name, common_name, taxonomy_id, proposed_family")
                .in("id", speciesIds)
            : { data: [], error: null };
        if (se) throw se;
        const { data: profiles, error: oe } = observerIds.length
            ? await req.supabase.from("profiles").select("id, full_name").in("id", observerIds)
            : { data: [], error: null };
        if (oe) throw oe;
        const plantById = new Map((plants || []).map(p => [p.id, p]));
        const speciesById = new Map((species || []).map(s => [s.id, s]));
        const observerById = new Map((profiles || []).map(o => [o.id, o.full_name]));
        const rows = (observations || [])
            .filter(o => isOfficer(req) || o.review_status === "approved" || o.observer_id === req.user.id)
            .map(o => {
                const plant = plantById.get(o.plant_id);
                const species = plant && speciesById.get(plant.species_id);
                return {
                    id: o.id,
                    scientific_name: species?.scientific_name || "Unidentified species",
                    common_name: species?.common_name || "",
                    family: species?.proposed_family || "",
                    observed_by: observerById.get(o.observer_id) || "Botanist",
                    location_name: plant?.location_description || "",
                    gps: "",
                    notes: o.notes || "",
                    photo: "",
                    state: o.review_status === "approved" ? "Approved" :
                        o.review_status === "rejected" ? "Rejected" : "Pending",
                    reject_reason: "",
                    observed_at: o.observed_at,
                    extra: { mobile_observation_id: o.id, plant_id: o.plant_id }
                };
            });
        return res.json({ data: rows });
    } catch (error) {
        console.error("Shared observations load error:", error);
        return res.status(500).json({ message: "Could not load shared observations" });
    }
});

router.put("/observations", requireAuth, (_req, res) =>
    res.status(405).json({ message: "Use the mobile observation API and officer review API to change observations" })
);

// Define your configuration for dynamic data lists/tables
const lists = {};

router.use(requireAuth);

// Check whether the logged-in user is an officer.
function isOfficer(req) {
    return req.profile && req.profile.role === "officer";
}

// Check whether the logged-in user is a submitter (e.g. botanist).
function isSubmitter(req) {
    return req.profile && req.profile.role === "botanist";
}

// Cleans a piece of text and cuts it to a safe length.
function textOf(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function extraOf(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return JSON.stringify(value).length > 100000 ? {} : value;
}

// Cleans individual user rows for the website_users table
function cleanUser(item, index) {
    const row = {
        id: typeof item.id === "string" && uuidPattern.test(item.id) ? item.id : randomUUID(),
        name: textOf(item.name, 200),
        username: textOf(item.username, 100),
        email: textOf(item.email, 200),
        role: textOf(item.role, 100),
        active: item.active !== false,
        extra: extraOf(item.extra),
        sort_order: index,
    };
    if (row.email === "") return { error: "Every record needs an email" };
    return { row };
}

// Cleans individual rows for dynamic lists (e.g. observations)
function cleanRow(item, list, index) {
    const row = {
        id: typeof item.id === "string" && (list.ids === "uuid" ? uuidPattern.test(item.id) : textIdPattern.test(item.id)) ? item.id : randomUUID(),
        state: textOf(item.state, 50) || "Pending",
        reject_reason: textOf(item.reject_reason, 500),
        sort_order: index,
    };
    return { row };
}

for (const [name, list] of Object.entries(lists)) {
    // Send the whole list to the website.
    router.get("/" + name, async (req, res) => {
        // Only the officer may see the user list. Everyone else gets an empty list.
        if (list.officerOnly && !isOfficer(req)) {
            return res.json({ data: [] });
        }
        const { data, error } = await req.supabase
            .from(list.table)
            .select("*")
            .order("sort_order", { ascending: true });

        if (error) {
            console.error(`Website ${name} load error:`, error);
            return res.status(500).json({ message: `Could not load the ${name}` });
        }
        return res.json({ data });
    });

    // Save changes: add new records, update changed ones and remove the ones the page deleted.
    router.put("/" + name, async (req, res) => {
        // Only officers can change website data.
        if (!isOfficer(req)) {
            return res.status(403).json({
                message: OFFICER_ONLY_MESSAGE
            });
        }
        const incoming = req.body && req.body.rows;
        if (!Array.isArray(incoming) || incoming.length > 2000) {
            return res.status(400).json({ message: `A list of ${name} is required` });
        }

        const rows = [];
        const seen = new Set();
        for (let i = 0; i < incoming.length; i++) {
            const result = cleanRow(incoming[i] || {}, list, i);
            if (result.error) {
                return res.status(400).json({ message: result.error });
            }
            if (seen.has(result.row.id)) {
                return res.status(400).json({ message: "Two records have the same id" });
            }
            seen.add(result.row.id);
            rows.push(result.row);
        }

        if (isSubmitter(req)) {
            // A botanist can only send new observations for approval. Never approve, reject,
            // change someone else's record or delete anything.
            const removedByBotanist = Array.isArray(req.body.removed) ? req.body.removed : [];
            if (removedByBotanist.length > 0 || rows.some(row => row.state !== "Pending")) {
                return res.status(403).json({ message: OFFICER_ONLY_MESSAGE });
            }
            if (rows.length > 0) {
                const ids = rows.map(row => row.id);
                const { data: existing, error: lookupError } = await req.supabase
                    .from(list.table)
                    .select("id")
                    .in("id", ids);
                if (lookupError) {
                    console.error(`Website ${name} lookup error:`, lookupError);
                    return res.status(500).json({ message: `Could not save the ${name}` });
                }
                if (Array.isArray(existing) && existing.length > 0) {
                    return res.status(403).json({ message: OFFICER_ONLY_MESSAGE });
                }
                const ownRows = rows.map(row => ({ ...row, owner_id: req.user.id }));
                const { error: insertError } = await req.supabase.from(list.table).insert(ownRows);
                if (insertError) {
                    console.error(`Website ${name} submit error:`, insertError);
                    return res.status(500).json({ message: `Could not save the ${name}` });
                }
            }
            return res.json({ data: rows });
        }

        // Officer review of observations
        if (list.reviewOnly && rows.length > 0) {
            for (const row of rows) {
                const { data: changed, error: reviewError } = await req.supabase
                    .from(list.table)
                    .update({ state: row.state, reject_reason: row.reject_reason })
                    .eq("id", row.id)
                    .select("id");
                if (reviewError) {
                    console.error(`Website ${name} review error:`, reviewError);
                    return res.status(403).json({ message: reviewError.message || `Could not save the ${name}` });
                }
                if (Array.isArray(changed) && changed.length === 0) {
                    return res.status(404).json({ message: "That observation was not found in the database" });
                }
            }
        } else if (rows.length > 0) {
            const { error } = await req.supabase
                .from(list.table)
                .upsert(rows, { onConflict: "id" });
            if (error) {
                console.error(`Website ${name} save error:`, error);
                return res.status(500).json({ message: `Could not save the ${name}` });
            }
        }

        // Remove deleted records
        const removed = Array.isArray(req.body.removed) ? req.body.removed : [];
        const removedIds = removed.filter(id =>
            typeof id === "string" && (list.ids === "uuid" ? uuidPattern.test(id) : textIdPattern.test(id))
        );
        if (removedIds.length > 0) {
            const { data: deleted, error: removeError } = await req.supabase
                .from(list.table)
                .delete()
                .in("id", removedIds)
                .select("id");
            if (removeError) {
                console.error(`Website ${name} remove error:`, removeError);
                return res.status(500).json({ message: `Could not remove the deleted ${name}` });
            }
            if (Array.isArray(deleted) && deleted.length < removedIds.length) {
                console.error(`Website ${name}: asked to remove ${removedIds.length}, database removed ${deleted.length}`);
                return res.status(403).json({
                    message: `The database refused to delete ${removedIds.length - deleted.length} ${name} record(s). Is this account an active officer?`
                });
            }
        }

        return res.json({ data: rows });
    });
}


 // Botanists submit proposed edits to an existing approved plant.
 // The original plant remains unchanged until officer approval.
 router.post("/plant-edit-requests", async (req, res) => {
     if (!isSubmitter(req)) {
         return res.status(403).json({
             message: "Only botanists can submit plant edits"
         });
     }

     const { plant_id, proposed_changes } = req.body || {};

     if (typeof plant_id !== "string" || !uuidPattern.test(plant_id)) {
         return res.status(400).json({
             message: "A valid plant_id is required"
         });
     }

     if (
         !proposed_changes ||
         typeof proposed_changes !== "object" ||
         Array.isArray(proposed_changes)
     ) {
         return res.status(400).json({
             message: "proposed_changes must be an object"
         });
     }

     // Start with a field confirmed in the existing plants table.
     const allowedFields = new Set(["location_description"]);
     const keys = Object.keys(proposed_changes);

     if (keys.length === 0 || keys.some(key => !allowedFields.has(key))) {
         return res.status(400).json({
             message: "Only location_description can be proposed at this stage"
         });
     }

     const location = proposed_changes.location_description;

     if (
         typeof location !== "string" ||
         !location.trim() ||
         location.length > 500
     ) {
         return res.status(400).json({
             message: "location_description must be 1 to 500 characters"
         });
     }

     try {
         const { data: plant, error: plantError } = await req.supabase
             .from("plants")
             .select("id, plant_status, location_description, deleted_at")
             .eq("id", plant_id)
             .maybeSingle();

         if (plantError) throw plantError;

         if (!plant || plant.deleted_at || plant.plant_status !== "approved") {
             return res.status(404).json({
                 message: "Approved plant not found"
             });
         }

         if (plant.location_description === location.trim()) {
             return res.status(400).json({
                 message: "The proposed location is already saved"
             });
         }

         const { data, error } = await req.supabase
             .from("plant_edit_requests")
             .insert({
                 plant_id,
                 requested_by: req.user.id,
                 proposed_changes: {
                     location_description: location.trim()
                 },
                 status: "pending"
             })
             .select("*")
             .single();

         if (error) {
             if (error.code === "23505") {
                 return res.status(409).json({
                     message: "This plant already has a pending edit request"
                 });
             }
             throw error;
         }

         return res.status(201).json({
             message: "Plant edit request submitted for approval",
             data
         });

     } catch (error) {
         console.error("Plant edit submission error:", error);
         return res.status(500).json({
             message: "Could not submit plant edit request"
         });
     }
 });

 // Botanists see their own requests; officers see the approval queue.
 router.get("/plant-edit-requests", async (req, res) => {
     if (!isOfficer(req) && !isSubmitter(req)) {
         return res.status(403).json({
             message: "Not authorized"
         });
     }

     try {
         let query = req.supabase
             .from("plant_edit_requests")
             .select("*")
             .order("created_at", { ascending: false })
             .limit(200);

         if (isSubmitter(req)) {
             query = query.eq("requested_by", req.user.id);
         } else if (req.query.status === "pending") {
             query = query.eq("status", "pending");
         }

         const { data, error } = await query;

         if (error) throw error;

         return res.json({ data: data || [] });

     } catch (error) {
         console.error("Plant edit requests load error:", error);
         return res.status(500).json({
             message: "Could not load plant edit requests"
         });
     }
 });


 // Officers approve or reject botanist plant edit requests.
 router.post("/plant-edit-requests/:requestId/decision", async (req, res) => {
     if (
         !isOfficer(req) ||
         req.profile?.account_status !== "active"
     ) {
         return res.status(403).json({
             message: "Only active officers can review plant edits"
         });
     }

     const { requestId } = req.params;
     const { decision, comment } = req.body || {};

     if (!uuidPattern.test(requestId)) {
         return res.status(400).json({
             message: "Invalid edit request ID"
         });
     }

     if (!["approved", "rejected"].includes(decision)) {
         return res.status(400).json({
             message: "Decision must be approved or rejected"
         });
     }

     if (comment != null && typeof comment !== "string") {
         return res.status(400).json({
             message: "Review comment must be text"
         });
     }

     try {
         const { error } = await req.supabase.rpc(
             "review_plant_edit_request",
             {
                 p_request_id: requestId,
                 p_decision: decision,
                 p_comment: comment || null
             }
         );

         if (error) {
             console.error("Plant edit review error:", error);

             return res.status(400).json({
                 message: error.message || "Could not review plant edit"
             });
         }

         return res.json({
             message: decision === "approved"
                 ? "Plant edit approved successfully"
                 : "Plant edit rejected successfully"
         });

     } catch (error) {
         console.error("Plant edit review error:", error);

         return res.status(500).json({
             message: "Could not process plant edit decision"
         });
     }
 });


// Load species records from Supabase
router.get("/species", async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("website_species")
            .select("*")
            .order("sort_order", { ascending: true })
            .range(0, 999);

        if (error) {
            console.error("Species load error:", error);
            return res.status(500).json({
                message: "Could not load species from Supabase"
            });
        }

        return res.json({ data: data || [] });
        }  catch (error) {
        console.error("Species API error:", error);
        return res.status(500).json({
            message: "Database connection failed"
        });
        }
});


// Add a new plant (officers only)
router.post("/species", async (req, res) => {
    if (!isOfficer(req)) {
        return res.status(403).json({
            message: "Only officers can add plants"
        });
    }

    const body = req.body || {};
    const name = textOf(body.scientific_name, 200);

    if (!name) {
        return res.status(400).json({
            message: "Scientific name is required"
        });
    }

    const plant = {
        scientific_name: name,
        common_name: textOf(body.common_name, 200),
        family: textOf(body.family, 200),
        conservation_status: textOf(body.conservation_status, 100) || "Not assessed",
        description: textOf(body.description, 10000),
        photo: textOf(body.photo, 2000000)
    };

    const { data, error } = await req.supabase
        .from("website_species")
        .insert(plant)
        .select("*")
        .single();

    if (error) {
        console.error("Plant insert error:", error);
        return res.status(500).json({
            message: "Could not save plant record"
        });
    }

    return res.status(201).json({
        message: "Plant saved successfully",
        data
    });
});

// Update an existing plant record in Supabase
router.patch("/species/:id", async (req, res) => {
    try {
    const id = req.params.id;
    if (!uuidPattern.test(id)) {
        return res.status(400).json({
            message: "Invalid plant ID"
        });
    }

     // Only conservation officers can edit plant records
    if (!isOfficer(req)) {
        return res.status(403).json({
            message: "Only conservation officers can edit plants"
        });
    }

     // Fields that can be updated
     const allowedFields = [
       "scientific_name",
       "common_name",
       "family",
       "description"
     ];

     const changes = {};

     for (const field of allowedFields) {
       if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
         if (typeof req.body[field] !== "string") {
           return res.status(400).json({
             message: field + " must be text"
           });
         }
         changes[field] = req.body[field].trim();
       }
     }

     if (Object.keys(changes).length === 0) {
       return res.status(400).json({
         message: "No changes provided"
       });
     }

     if (changes.scientific_name === "") {
       return res.status(400).json({
         message: "Scientific name cannot be empty"
       });
     }

     // Update the existing record
     const { data, error } = await req.supabase
       .from("website_species")
       .update(changes)
       .eq("id", id)
       .select("*")
       .single();

     if (error) {
       console.error("Plant update error:", error);
       return res.status(500).json({
         message: "Could not update plant record"
       });
     }

     return res.json({
       message: "Plant updated successfully",
       data: data
     });

   } catch (error) {
     console.error("Plant update error:", error);
     return res.status(500).json({
       message: "Database connection failed"
     });
   }
});

// Delete an existing plant
router.delete("/species/:id", async (req, res) => {
  if (!isOfficer(req)) {
    return res.status(403).json({
      message: "Only officers can delete plants"
    });
  }

  const id = req.params.id;

  if (!uuidPattern.test(id)) {
    return res.status(400).json({
      message: "Invalid plant ID"
    });
  }

  try {
    const { data, error } = await req.supabase
      .from("website_species")
      .delete()
      .eq("id", id)
      .select("id");

    if (error) {
      console.error("Plant delete error:", error);
      return res.status(500).json({
        message: "Could not delete plant"
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        message: "Plant not found or deletion not permitted"
      });
    }

    return res.json({
      message: "Plant deleted successfully"
    });

  } catch (error) {
    console.error("Plant delete error:", error);
    return res.status(500).json({
      message: "Could not delete plant"
    });
  }
});

// Get observation history for one plant
router.get("/plants/:id/observation-history", async (req, res) => {
  const plantId = req.params.id;

  if (!uuidPattern.test(plantId)) {
    return res.status(400).json({ message: "Invalid plant ID" });
  }

  // Real registered plants use the mobile observations table, not website_species_id.
  const { data: realPlant, error: plantLookupError } = await req.supabase
    .from("plants")
    .select("id, plant_status, registered_by")
    .eq("id", plantId)
    .maybeSingle();

  if (plantLookupError) {
    console.error("Real plant history lookup error:", plantLookupError);
    return res.status(500).json({ message: "Could not check plant" });
  }

  if (realPlant) {
    const role = req.profile?.role;
    const owner = realPlant.registered_by === req.user.id;
    if (role !== "officer" && realPlant.plant_status !== "approved" && !owner) {
      return res.status(404).json({ message: "Plant not found" });
    }

    let query = req.supabase
      .from("observations")
      .select("id, observer_id, observed_at, health_status, life_stage, height_cm, diameter_cm, notes, review_status")
      .eq("plant_id", plantId)
      .is("deleted_at", null)
      .order("observed_at", { ascending: false });

    // Draft and rejected visits belong to their observer; officers see all.
    // The filter is enforced server-side, not merely hidden in the browser.
    if (role !== "officer") {
      query = query.or(`review_status.eq.approved,observer_id.eq.${req.user.id}`);
    }

    const { data: visits, error: visitsError } = await query;
    if (visitsError) {
      console.error("Real plant observation history error:", visitsError);
      return res.status(500).json({ message: "Could not load observation history" });
    }
    const observationIds = (visits || []).map(v => v.id);

    let photos = [];

    if (observationIds.length > 0) {
    const { data, error } = await req.supabase
        .from("observation_media")
        .select("observation_id, file_path, is_primary")
        .in("observation_id", observationIds)
        .eq("media_type", "image")
        .is("deleted_at", null);

    if (error) {
        console.error("Observation media error:", error);
        return res.status(500).json({
        message: "Could not load observation photographs"
        });
    }

    photos = data || [];
    }

    const photoMap = new Map();

    for (const photo of photos) {
    if (!photoMap.has(photo.observation_id)) {
        photoMap.set(photo.observation_id, []);
    }

    photoMap.get(photo.observation_id).push(photo);
    }

    const result = await Promise.all(
    (visits || []).map(async visit => {
        const observationPhotos = photoMap.get(visit.id) || [];
        const photoUrls = [];

        for (const photo of observationPhotos) {
        const { data, error } = await req.supabase.storage
            .from("observation-media")
            .createSignedUrl(photo.file_path, 3600);

        if (!error && data?.signedUrl) {
            photoUrls.push(data.signedUrl);
        }
        }

        return {
        ...visit,
        staff_name:
            visit.observer_id === req.user.id ? "You" : "Field Staff",
        dbh_cm: visit.diameter_cm,
        photo_urls: photoUrls
        };
    })
    );

    return res.json({ data: result });
  }

  // Legacy website_species history is kept unchanged for existing officer pages.
  const { data, error } = await req.supabase
    .from("plant_observation_history")
    .select("*")
    .eq("website_species_id", plantId)
    .order("observed_at", { ascending: false });

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.json({ data: data || [] });
});


// Officers upload photographs to observations they created.
// Existing botanist photo routes remain unchanged.
router.post(
  "/plants/:id/observation-history/:observationId/photo",
  async (req, res, next) => {
    if (!isOfficer(req)) {
      return res.status(403).json({ message: "Only officers can upload these photographs" });
    }

    const { id: plantId, observationId } = req.params;
    if (!uuidPattern.test(plantId) || !uuidPattern.test(observationId)) {
      return res.status(400).json({ message: "Invalid plant or observation ID" });
    }

    const { data: observation, error } = await req.supabase
      .from("observations")
      .select("id, plant_id, observer_id, review_status, deleted_at")
      .eq("id", observationId)
      .eq("plant_id", plantId)
      .maybeSingle();

    if (error) return res.status(500).json({ message: "Could not check observation" });
    if (!observation || observation.deleted_at) {
      return res.status(404).json({ message: "Observation not found" });
    }
    if (observation.observer_id !== req.user.id) {
      return res.status(403).json({ message: "You can only upload to your own observation" });
    }
    if (!["draft", "rejected"].includes(observation.review_status)) {
      return res.status(409).json({ message: "Observation photographs are locked" });
    }

    next();
  },
  upload.single("photo"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No photo uploaded" });

    const { id: plantId, observationId } = req.params;
    const photoId = req.body.client_photo_id;

    if (!uuidPattern.test(photoId || "")) {
      return res.status(400).json({ message: "Valid client_photo_id is required" });
    }

    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    }[req.file.mimetype];

    if (!extension || req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ message: "Use JPG, PNG or WebP, maximum 5 MB" });
    }

    const { data: existing, error: lookupError } = await req.supabase
      .from("observation_media")
      .select("*")
      .eq("observation_id", observationId)
      .eq("client_record_id", photoId)
      .maybeSingle();

    if (lookupError) return res.status(500).json({ message: "Could not check photograph" });
    if (existing) return res.json({ media: existing, message: "Photograph already saved" });

    const filePath = `${req.user.id}/${observationId}/${randomUUID()}.${extension}`;

    const { error: storageError } = await req.supabase.storage
      .from("observation-media")
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (storageError) {
      console.error("Officer observation photo storage error:", storageError);
      return res.status(500).json({ message: "Could not upload photograph" });
    }

    const { data: media, error: mediaError } = await req.supabase
      .from("observation_media")
      .insert({
        observation_id: observationId,
        uploaded_by: req.user.id,
        file_path: filePath,
        media_type: "image",
        client_record_id: photoId
      })
      .select()
      .single();

    if (mediaError) {
      await req.supabase.storage.from("observation-media").remove([filePath]);
      console.error("Officer observation photo database error:", mediaError);
      return res.status(500).json({ message: "Could not save photograph record" });
    }

    return res.status(201).json({ media, plant_id: plantId });
  }
);


// Conservation officers add observations
router.post("/plants/:id/observation-history", async (req, res) => {
  if (!isOfficer(req)) {
    return res.status(403).json({
      message: "Only conservation officers can add observations"
    });
  }

  const plantId = req.params.id;

  if (!uuidPattern.test(plantId)) {
    return res.status(400).json({ message: "Invalid plant ID" });
  }


  // Real registered plants are stored in public.plants.
  const { data: realPlant, error: realPlantError } = await req.supabase
    .from("plants")
    .select("id, deleted_at")
    .eq("id", plantId)
    .maybeSingle();

  if (realPlantError) {
    console.error("Real plant lookup error:", realPlantError);
    return res.status(500).json({
      message: "Could not check plant record"
    });
  }

  if (realPlant && !realPlant.deleted_at) {
    const body = req.body || {};

    const numberOrNull = value =>
      value === "" || value == null ? null : Number(value);

    const height = numberOrNull(body.height_cm);
    const diameter = numberOrNull(body.dbh_cm);
    const latitude = numberOrNull(body.latitude);
    const longitude = numberOrNull(body.longitude);

    if (
      [height, diameter, latitude, longitude].some(
        value => value !== null && !Number.isFinite(value)
      ) ||
      (height !== null && height < 0) ||
      (diameter !== null && diameter < 0) ||
      (latitude !== null && (latitude < -90 || latitude > 90)) ||
      (longitude !== null && (longitude < -180 || longitude > 180))
    ) {
      return res.status(400).json({
        message: "Invalid measurement or GPS coordinates"
      });
    }

    const stages = ["Seedling", "Sapling", "Pole", "Mature", "Senescent"];
    const healthOptions = ["Healthy", "Stressed", "Diseased", "Damaged", "Dead"];

    if (
      (body.life_stage && !stages.includes(body.life_stage)) ||
      (body.health_status && !healthOptions.includes(body.health_status))
    ) {
      return res.status(400).json({
        message: "Invalid life stage or health status"
      });
    }

    const observedAt = new Date(body.observed_at);

    if (!Number.isFinite(observedAt.getTime())) {
      return res.status(400).json({
        message: "Invalid observation date"
      });
    }

    const details = [
      textOf(body.local_name, 200)
        ? "Local name: " + textOf(body.local_name, 200)
        : null,
      textOf(body.habitat, 1000)
        ? "Habitat: " + textOf(body.habitat, 1000)
        : null,
      textOf(body.location_name, 300)
        ? "Location: " + textOf(body.location_name, 300)
        : null,
      latitude !== null && longitude !== null
        ? "GPS: " + latitude + ", " + longitude
        : null,
      textOf(body.notes, 5000) || null
    ].filter(Boolean).join("\n\n") || null;

    const { data, error } = await req.supabase
      .from("observations")
      .insert({
        client_record_id: randomUUID(),
        plant_id: realPlant.id,
        observer_id: req.user.id,
        observed_at: observedAt.toISOString(),
        height_cm: height,
        diameter_cm: diameter,
        life_stage: body.life_stage || null,
        health_status: body.health_status || null,
        notes: details,
        review_status: "draft"
      })
      .select("*")
      .single();

    if (error) {
      console.error("Officer observation save error:", error);
      return res.status(500).json({
        message: "Could not save observation"
      });
    }

    return res.status(201).json({ data });
  }


  const { data: plant, error: plantError } = await req.supabase
    .from("website_species")
    .select("*")
    .eq("id", plantId)
    .single();

  if (plantError || !plant) {
    return res.status(404).json({ message: "Plant not found" });
  }

  const body = req.body || {};

  const numberOrNull = value =>
    value === "" || value == null ? null : Number(value);

  const height = numberOrNull(body.height_cm);
  const dbh = numberOrNull(body.dbh_cm);
  const latitude = numberOrNull(body.latitude);
  const longitude = numberOrNull(body.longitude);

  if (
    [height, dbh, latitude, longitude].some(
      value => value !== null && !Number.isFinite(value)
    ) ||
    (height !== null && height < 0) ||
    (dbh !== null && dbh < 0) ||
    (latitude !== null && (latitude < -90 || latitude > 90)) ||
    (longitude !== null && (longitude < -180 || longitude > 180))
  ) {
    return res.status(400).json({
      message: "Invalid measurement or GPS coordinates"
    });
  }

  const stages = ["Seedling", "Sapling", "Pole", "Mature", "Senescent"];
  const healthOptions = ["Healthy", "Stressed", "Diseased", "Damaged", "Dead"];

  if (
    (body.life_stage && !stages.includes(body.life_stage)) ||
    (body.health_status && !healthOptions.includes(body.health_status))
  ) {
    return res.status(400).json({
      message: "Invalid life stage or health status"
    });
  }

  const observedAt = new Date(body.observed_at);

  if (!Number.isFinite(observedAt.getTime())) {
    return res.status(400).json({
      message: "Invalid observation date"
    });
  }

  const observation = {
    website_species_id: plant.id,
    observed_at: observedAt.toISOString(),
    staff_id: req.user.id,
    staff_name: textOf(req.profile?.name, 200) || "Field Staff",

    scientific_name: plant.scientific_name,
    common_name: plant.common_name,
    family: plant.family,
    conservation_status: plant.conservation_status,
    local_name: textOf(body.local_name, 200),
    habitat: textOf(body.habitat, 1000),
    description: plant.description,
    botanical_photo: plant.photo,

    height_cm: height,
    dbh_cm: dbh,
    life_stage: body.life_stage || null,
    health_status: body.health_status || null,
    latitude,
    longitude,
    location_name: textOf(body.location_name, 300),
    notes: textOf(body.notes, 5000)
  };

  const { data, error } = await req.supabase
    .from("plant_observation_history")
    .insert(observation)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ message: error.message });
  }

  res.status(201).json({ data });
});

module.exports = router;