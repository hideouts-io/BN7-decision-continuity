/** Keep runtime navigation inside the build's explicitly configured Vite base. */
export function appPath(page: "" | "decisions.html" | "impact.html"): string {
  return `${import.meta.env.BASE_URL}${page}`;
}
