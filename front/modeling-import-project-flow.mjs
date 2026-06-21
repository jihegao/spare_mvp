export async function ensurePublishedModelingImportForSampleProject({
  backendApi,
  fixture,
  publishedImportId = ""
}) {
  const existingImportId = String(publishedImportId || "").trim();
  if (existingImportId) {
    return { importId: existingImportId, reused: true };
  }

  if (!backendApi || typeof backendApi.saveModelingImport !== "function" || typeof backendApi.publishModelingImport !== "function") {
    throw new Error("Backend API 不支持保存/发布建模导入包");
  }
  if (!fixture?.importId) {
    throw new Error("缺少可发布的示例导入包");
  }

  await backendApi.saveModelingImport(fixture);
  const published = await backendApi.publishModelingImport(fixture.importId);
  const publishedPackage = published?.publishedPackage || published;
  const importId = publishedPackage?.importId || publishedPackage?.import_id || fixture.importId;
  return { importId, reused: false, publishedPackage };
}
