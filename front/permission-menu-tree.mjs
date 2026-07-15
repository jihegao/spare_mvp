import {
  FEATURE_PAGES,
  getVisibleFeaturePagesForRole,
  groupFeaturePages
} from "./feature-catalog.mjs";

export const PERMISSION_MENU_ROLES = [
  { key: "admin", label: "系统管理员", role: "系统管理员" },
  { key: "data", label: "数据管理员", role: "数据管理员" },
  { key: "user", label: "项目用户", role: "项目用户" }
];

// The navigation renders module -> secondary group -> tertiary leaf.  Keep this
// view derived from that same catalog so the permission audit cannot drift from
// the left-side menu or its role filtering rules.
export function buildPermissionMenuTree(pages = FEATURE_PAGES) {
  const visiblePageIdsByRole = new Map(
    PERMISSION_MENU_ROLES.map(({ key, role }) => [
      key,
      new Set(getVisibleFeaturePagesForRole(pages, role).map((page) => page.id))
    ])
  );

  return Object.entries(groupFeaturePages(pages)).map(([module, secondaryGroups]) => ({
    module,
    secondaryGroups: Object.entries(secondaryGroups).map(([secondary, tertiaryGroups]) => ({
      secondary,
      leaves: Object.entries(tertiaryGroups).map(([tertiary, leafPages]) => ({
        tertiary,
        pageIds: leafPages.map((page) => page.id),
        visibility: Object.fromEntries(
          PERMISSION_MENU_ROLES.map(({ key }) => [
            key,
            leafPages.some((page) => visiblePageIdsByRole.get(key).has(page.id))
          ])
        )
      }))
    }))
  }));
}
