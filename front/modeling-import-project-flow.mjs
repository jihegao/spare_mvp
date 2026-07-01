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
