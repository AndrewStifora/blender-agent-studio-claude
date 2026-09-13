use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Bounds {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

impl Bounds {
    fn dimensions(&self) -> [f64; 3] {
        std::array::from_fn(|i| self.max[i] - self.min[i])
    }
    fn center(&self) -> [f64; 3] {
        std::array::from_fn(|i| self.min[i] + (self.max[i] - self.min[i]) / 2.0)
    }
    fn distance(&self, other: &Self) -> f64 {
        (0..3)
            .map(|i| {
                (self.min[i] - other.max[i])
                    .max(other.min[i] - self.max[i])
                    .max(0.0)
                    .powi(2)
            })
            .sum::<f64>()
            .sqrt()
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Mesh {
    pub vertices: u32,
    pub triangles: u32,
    pub connected_components: u32,
    pub non_manifold_edges: u32,
    pub degenerate_faces: u32,
    pub missing_material_faces: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Object {
    pub id: String,
    pub kind: String,
    pub parent: Option<String>,
    pub semantic_role: Option<String>,
    pub world_matrix: [[f64; 4]; 4],
    pub bounds: Option<Bounds>,
    pub mesh: Option<Mesh>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    pub schema_version: String,
    pub source: String,
    pub blender_version: String,
    pub frame: i32,
    pub meters_per_unit: f64,
    pub limitations: Vec<String>,
    pub objects: Vec<Object>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Options {
    pub object_id: Option<String>,
    pub include_descendants: bool,
    pub offset: usize,
    pub limit: usize,
    pub proximity: f64,
    pub ground_z: Option<f64>,
    pub ground_objects: Vec<String>,
    pub tolerance: f64,
    pub triangle_budget: Option<u64>,
    pub require_closed_mesh: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            object_id: None,
            include_descendants: true,
            offset: 0,
            limit: 40,
            proximity: 0.01,
            ground_z: None,
            ground_objects: vec![],
            tolerance: 0.001,
            triangle_budget: None,
            require_closed_mesh: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub scene: Scene,
    #[serde(default)]
    pub options: Options,
}

fn validate(scene: &Scene, options: &Options) -> Result<(), String> {
    if scene.schema_version != "bas-scene-ir/0.1" {
        return Err("Unsupported SceneIR version".into());
    }
    if scene.objects.len() > 2048 {
        return Err("SceneIR exceeds 2048 objects".into());
    }
    if !(1..=200).contains(&options.limit) || options.offset > 2048 {
        return Err("Invalid pagination (limit 1..200, offset 0..2048)".into());
    }
    if !scene.meters_per_unit.is_finite() || scene.meters_per_unit <= 0.0 {
        return Err("Invalid unit scale".into());
    }
    for value in [options.proximity, options.tolerance] {
        if !value.is_finite() || !(0.0..=1e9).contains(&value) {
            return Err("Distances must be finite and between 0 and 1e9".into());
        }
    }
    if options
        .ground_z
        .is_some_and(|z| !z.is_finite() || z.abs() > 1e12)
        || (!options.ground_objects.is_empty() && options.ground_z.is_none())
    {
        return Err("Ground checks require a finite explicit ground_z".into());
    }
    let ids: BTreeMap<_, _> = scene.objects.iter().map(|o| (o.id.as_str(), o)).collect();
    if ids.len() != scene.objects.len() {
        return Err("Duplicate object IDs".into());
    }
    for object in &scene.objects {
        if object.id.is_empty()
            || object.id.len() > 1024
            || object.semantic_role.as_ref().is_some_and(|s| s.len() > 256)
        {
            return Err("Invalid object ID or role".into());
        }
        if object
            .world_matrix
            .iter()
            .flatten()
            .any(|v| !v.is_finite() || v.abs() > 1e12)
        {
            return Err(format!("Invalid transform: {}", object.id));
        }
        if let Some(b) = &object.bounds {
            if (0..3).any(|i| {
                !b.min[i].is_finite()
                    || !b.max[i].is_finite()
                    || b.min[i].abs() > 1e12
                    || b.max[i].abs() > 1e12
                    || b.min[i] > b.max[i]
            }) {
                return Err(format!("Invalid bounds: {}", object.id));
            }
        }
        let mut seen = BTreeSet::new();
        let mut current = Some(object.id.as_str());
        while let Some(id) = current {
            if !seen.insert(id) {
                return Err("Cyclic object hierarchy".into());
            }
            current = ids
                .get(id)
                .ok_or_else(|| format!("Unknown parent: {id}"))?
                .parent
                .as_deref();
        }
    }
    for id in options
        .object_id
        .iter()
        .chain(options.ground_objects.iter())
    {
        if !ids.contains_key(id.as_str()) {
            return Err(format!("Unknown object: {id}"));
        }
    }
    Ok(())
}

pub fn analyze(request: Request) -> Result<Value, String> {
    let Request { scene, options } = request;
    validate(&scene, &options)?;
    let by_id: BTreeMap<_, _> = scene.objects.iter().map(|o| (o.id.as_str(), o)).collect();
    let selected: Vec<_> = by_id
        .values()
        .copied()
        .filter(|o| {
            let Some(wanted) = &options.object_id else {
                return true;
            };
            let mut current = Some(o.id.as_str());
            while let Some(id) = current {
                if id == wanted {
                    return true;
                }
                if !options.include_descendants {
                    break;
                }
                current = by_id[id].parent.as_deref();
            }
            false
        })
        .collect();
    let page: Vec<_> = selected
        .iter()
        .copied()
        .skip(options.offset)
        .take(options.limit)
        .collect();
    let mut issues = vec![];
    let mut relations = vec![];
    let triangles: u64 = selected
        .iter()
        .filter_map(|o| o.mesh.as_ref())
        .map(|m| u64::from(m.triangles))
        .sum();
    if triangles == 0 {
        issues.push(json!({"severity":"error", "code":"empty_mesh", "scope":"selection"}));
    }
    if options
        .triangle_budget
        .is_some_and(|budget| triangles > budget)
    {
        issues.push(json!({"severity":"error", "code":"triangle_budget", "actual":triangles, "maximum":options.triangle_budget}));
    }
    for object in &selected {
        if let Some(mesh) = &object.mesh {
            for (code, count, severity) in [
                ("degenerate_faces", mesh.degenerate_faces, "warning"),
                (
                    "missing_material_faces",
                    mesh.missing_material_faces,
                    "warning",
                ),
                (
                    "disconnected_components",
                    mesh.connected_components.saturating_sub(1),
                    "review",
                ),
                (
                    "non_manifold_edges",
                    mesh.non_manifold_edges,
                    if options.require_closed_mesh {
                        "error"
                    } else {
                        "review"
                    },
                ),
            ] {
                if count > 0 {
                    issues.push(
                        json!({"severity":severity,"code":code,"object":object.id,"count":count}),
                    );
                }
            }
        }
    }
    // Explicit ground targets must belong to the selection, regardless of pagination.
    for id in &options.ground_objects {
        let object = selected
            .iter()
            .find(|o| &o.id == id)
            .ok_or_else(|| format!("Ground object outside selection: {id}"))?;
        let bounds = object
            .bounds
            .as_ref()
            .ok_or_else(|| format!("Ground object has no bounds: {id}"))?;
        let gap = bounds.min[2] - options.ground_z.unwrap();
        if gap.abs() > options.tolerance {
            issues.push(json!({"severity":"warning","code":if gap > 0.0 {"above_ground_plane"} else {"below_ground_plane"},"object":id,"signed_distance":gap}));
        }
    }
    // Spatial relations are broad-phase candidates only and apply to this page.
    for (i, object) in page.iter().enumerate() {
        if let Some(parent) = &object.parent {
            relations.push(json!({"type":"parented_to","source":object.id,"target":parent,"evidence":"authored_hierarchy"}));
        }
        for other in page.iter().skip(i + 1) {
            if let (Some(a), Some(b)) = (&object.bounds, &other.bounds) {
                let distance = a.distance(b);
                if distance <= options.proximity {
                    let overlap = (0..3)
                        .all(|axis| a.max[axis].min(b.max[axis]) > a.min[axis].max(b.min[axis]));
                    relations.push(json!({"type":if overlap {"bounds_overlap_candidate"} else {"bounds_near_candidate"},"source":object.id,"target":other.id,"aabb_distance_lower_bound":distance,"evidence":"world_aabb_only"}));
                }
            }
        }
    }
    let mut bounds: Option<Bounds> = None;
    for object in &selected {
        if let Some(b) = &object.bounds {
            bounds = Some(match bounds {
                None => b.clone(),
                Some(a) => Bounds {
                    min: std::array::from_fn(|i| a.min[i].min(b.min[i])),
                    max: std::array::from_fn(|i| a.max[i].max(b.max[i])),
                },
            });
        }
    }
    let issue_count = issues.len();
    let relation_count = relations.len();
    let error_count = issues.iter().filter(|i| i["severity"] == "error").count();
    issues.truncate(200);
    relations.truncate(200);
    let objects: Vec<_> = page.iter().map(|o| json!({"id":o.id,"kind":o.kind,"semantic_role":o.semantic_role,"role_evidence":if o.semantic_role.is_some() {Some("authored_bas_role")} else {None},"parent":o.parent,"bounds":o.bounds,"dimensions":o.bounds.as_ref().map(Bounds::dimensions),"center":o.bounds.as_ref().map(Bounds::center),"mesh":o.mesh})).collect();
    Ok(json!({
        "schema_version":"bas-analysis/0.1", "runtime_version":env!("CARGO_PKG_VERSION"),
        "evaluation_options":options,
        "source":scene.source,"blender_version":scene.blender_version,"frame":scene.frame,
        "units":{"coordinates":"Blender world units","meters_per_unit":scene.meters_per_unit},
        "scene_object_count":scene.objects.len(),
        "selection":{"object_id":options.object_id,"object_count":selected.len(),"triangles":triangles,"bounds":bounds},
        "objects":objects,
        "pagination":{"offset":options.offset,"limit":options.limit,"next_offset":if options.offset + page.len() < selected.len() {Some(options.offset + page.len())} else {None}},
        "relations":{"scope":"returned page only","total":relation_count,"truncated":relation_count > 200,"items":relations},
        "quality":{"status":if error_count > 0 {"constraints_failed"} else {"review_required"},"error_count":error_count,"issue_count":issue_count,"issues_truncated":issue_count > 200,"issues":issues,
            "agent_review_required":["Review fixed front, side, rear and three-quarter views.","Do the primary forms and proportions match the brief and references?","Are overlap candidates intentional? Bounds alone cannot establish mesh intersection or contact.","Does the asset still look like a blockout?","Does the style and finish satisfy the brief?"],
            "not_measured":["triangle-level intersections and surface proximity","geometric symmetry","reference silhouette similarity","aesthetic quality"]},
        "extraction_limitations":scene.limitations
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> Request {
        let object = |id: &str, x: f64, parent: Option<&str>| Object {
            id: id.into(),
            kind: "MESH".into(),
            parent: parent.map(String::from),
            semantic_role: None,
            world_matrix: [[0.0; 4]; 4],
            bounds: Some(Bounds {
                min: [x, 0.0, 1.0],
                max: [x + 1.0, 1.0, 2.0],
            }),
            mesh: Some(Mesh {
                vertices: 8,
                triangles: 12,
                connected_components: 1,
                ..Default::default()
            }),
        };
        Request {
            scene: Scene {
                schema_version: "bas-scene-ir/0.1".into(),
                source: "fixture".into(),
                blender_version: "test".into(),
                frame: 1,
                meters_per_unit: 1.0,
                limitations: vec![],
                objects: vec![
                    object("body", 0.0, None),
                    object("part", 0.5, Some("body")),
                    object("far", 4.0, None),
                ],
            },
            options: Options::default(),
        }
    }
    #[test]
    fn honest_overlap_and_no_implicit_ground_failures() {
        let value = analyze(request()).unwrap();
        assert_eq!(
            value["relations"]["items"][0]["type"],
            "bounds_overlap_candidate"
        );
        assert_eq!(value["quality"]["issue_count"], 0);
        assert_eq!(value["quality"]["status"], "review_required");
    }
    #[test]
    fn explicit_ground_and_budget_cover_unpaginated_selection() {
        let mut r = request();
        r.options.limit = 1;
        r.options.ground_z = Some(0.0);
        r.options.ground_objects = vec!["part".into()];
        r.options.triangle_budget = Some(35);
        let value = analyze(r).unwrap();
        assert_eq!(value["selection"]["triangles"], 36);
        assert_eq!(value["quality"]["error_count"], 1);
        assert_eq!(value["quality"]["issues"][1]["code"], "above_ground_plane");
        assert_eq!(value["pagination"]["next_offset"], 1);
    }
    #[test]
    fn hierarchy_selection_and_unknown_ids() {
        let mut r = request();
        r.options.object_id = Some("body".into());
        assert_eq!(analyze(r).unwrap()["selection"]["object_count"], 2);
        let mut r = request();
        r.options.object_id = Some("missing".into());
        assert!(analyze(r).is_err());
        let mut r = request();
        r.scene.objects[0].parent = Some("part".into());
        assert!(analyze(r).is_err());
        let mut r = request();
        r.scene.objects[0].parent = Some("missing".into());
        assert!(analyze(r).is_err());
    }
    #[test]
    fn rejects_invalid_bounds_duplicate_ids_and_options() {
        let mut r = request();
        r.scene.objects[0].bounds.as_mut().unwrap().min[0] = f64::NAN;
        assert!(analyze(r).is_err());
        let mut r = request();
        r.scene.objects[1].id = "body".into();
        assert!(analyze(r).is_err());
        let mut r = request();
        r.options.limit = 201;
        assert!(analyze(r).is_err());
        let mut r = request();
        r.options.ground_objects = vec!["body".into()];
        assert!(analyze(r).is_err());
        let mut r = request();
        r.scene.schema_version = "future".into();
        assert!(analyze(r).is_err());
    }
    #[test]
    fn closed_mesh_is_an_explicit_constraint() {
        let mut r = request();
        r.scene.objects[0].mesh.as_mut().unwrap().non_manifold_edges = 4;
        assert_eq!(analyze(r).unwrap()["quality"]["error_count"], 0);
        let mut r = request();
        r.scene.objects[0].mesh.as_mut().unwrap().non_manifold_edges = 4;
        r.options.require_closed_mesh = true;
        assert_eq!(analyze(r).unwrap()["quality"]["error_count"], 1);
    }
    #[test]
    fn empty_scene_is_not_a_quality_pass() {
        let mut r = request();
        r.scene.objects.clear();
        assert_eq!(
            analyze(r).unwrap()["quality"]["status"],
            "constraints_failed"
        );
    }
}
