export async function ensurePublishedModelingImportForSampleProject({
  backendApi,
  fixture,
  publishedImportId = ""
}) {
  const fixtureImportId = String(fixture?.importId || "").trim();
  const explicitImportId = String(publishedImportId || "").trim();
  const existingImportId = explicitImportId || fixtureImportId;
  let storedImportWasChecked = false;
  if (existingImportId) {
    if (backendApi && typeof backendApi.getModelingImport === "function") {
      try {
        storedImportWasChecked = true;
        const stored = await backendApi.getModelingImport(existingImportId);
        const publishedPackage = stored?.publishedPackage || null;
        if (publishedPackage && sampleImportPackageShouldBeReused(publishedPackage, fixture)) {
          const importId = publishedPackage.importId || publishedPackage.import_id || existingImportId;
          return { importId, reused: true, publishedPackage };
        }
      } catch {
        if (explicitImportId) {
          return { importId: explicitImportId, reused: true };
        }
      }
    } else if (explicitImportId) {
      return { importId: explicitImportId, reused: true };
    }
  }
  if (explicitImportId && !storedImportWasChecked) {
    return { importId: existingImportId, reused: true };
  }

  if (!backendApi || typeof backendApi.saveModelingImport !== "function" || typeof backendApi.publishModelingImport !== "function") {
    throw new Error("Backend API 不支持保存/发布建模导入包");
  }
  if (!fixtureImportId) {
    throw new Error("缺少可发布的示例导入包");
  }

  await backendApi.saveModelingImport(fixture);
  const published = await backendApi.publishModelingImport(fixtureImportId);
  const publishedPackage = published?.publishedPackage || published;
  const importId = publishedPackage?.importId || publishedPackage?.import_id || fixtureImportId;
  return { importId, reused: false, publishedPackage };
}

export async function publishModelingImportWithReferencedVersionFallback({
  backendApi,
  importPackage,
  versionSuffix = defaultModelingImportVersionSuffix()
}) {
  const importId = String(importPackage?.importId || "").trim();
  if (!backendApi || typeof backendApi.publishModelingImport !== "function") {
    throw new Error("Backend API 不支持发布建模导入包");
  }
  if (!importId) {
    throw new Error("缺少可发布的导入包 importId");
  }

  try {
    const published = await backendApi.publishModelingImport(importId);
    return {
      importPackage,
      originalImportId: importId,
      published,
      versioned: false
    };
  } catch (err) {
    if (!isPublishedImportReferencedError(err)) throw err;
    if (typeof backendApi.saveModelingImport !== "function") {
      throw err;
    }
    const versionedPackage = createReferencedModelingImportVersion(importPackage, versionSuffix);
    await backendApi.saveModelingImport(versionedPackage);
    const published = await backendApi.publishModelingImport(versionedPackage.importId);
    return {
      importPackage: versionedPackage,
      originalImportId: importId,
      published,
      versioned: true
    };
  }
}

export function sampleImportPackageIsComplete(candidate, fixture) {
  return sampleImportPackageHasRequiredObjects(candidate, fixture)
    && modelingImportSourceMatches(candidate?.source, fixture?.source);
}

function sampleImportPackageShouldBeReused(candidate, fixture) {
  if (!sampleImportPackageHasRequiredObjects(candidate, fixture)) return false;
  if (modelingImportSourceMatches(candidate?.source, fixture?.source)) return true;
  return publishedImportHasRunReferences(candidate);
}

function sampleImportPackageHasRequiredObjects(candidate, fixture) {
  const candidateObjects = candidate?.objects || {};
  const fixtureObjects = fixture?.objects || {};
  return [
    "missionProfiles",
    "equipmentAssets",
    "supportResources",
    "supportActivities"
  ].every((key) => Array.isArray(candidateObjects[key]) && candidateObjects[key].length >= (fixtureObjects[key] || []).length);
}

function modelingImportSourceMatches(candidateSource, fixtureSource) {
  if (!fixtureSource) return true;
  if (!candidateSource || !fixtureSource) return false;
  return ["type", "name", "derivedFrom"].every((key) => {
    if (!(key in fixtureSource)) return true;
    return candidateSource[key] === fixtureSource[key];
  });
}

function publishedImportHasRunReferences(candidate) {
  const referencedRunIds = candidate?.lifecycle?.referencedRunIds;
  return candidate?.lifecycle?.state === "published" && Array.isArray(referencedRunIds) && referencedRunIds.length > 0;
}

export function createReferencedModelingImportVersion(importPackage, versionSuffix = defaultModelingImportVersionSuffix()) {
  const next = cloneJson(importPackage || {});
  const importId = String(next.importId || "").trim();
  if (!importId) {
    throw new Error("缺少可版本化的导入包 importId");
  }
  const suffix = sanitizeModelingImportVersionSuffix(versionSuffix);
  next.importId = `${importId}-${suffix}`;
  next.lifecycle = {
    ...(next.lifecycle || {}),
    state: "draft",
    version: Math.max(1, Number(next.lifecycle?.version || 1) + 1),
    referencedRunIds: []
  };
  return next;
}

export function isPublishedImportReferencedError(err) {
  return err?.code === "published_import_referenced"
    || String(err?.message || "").includes("published modeling import is referenced");
}

function defaultModelingImportVersionSuffix() {
  return `v${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

function sanitizeModelingImportVersionSuffix(value) {
  const suffix = String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return suffix || defaultModelingImportVersionSuffix();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
