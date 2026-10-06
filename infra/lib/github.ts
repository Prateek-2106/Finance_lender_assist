/**
 * The `sub` claims GitHub Actions may present when deploying from `main`.
 *
 * GitHub has two formats. The classic one names the repo:
 *   repo:Prateek-2106/vendorstreet:ref:refs/heads/main
 * The newer one adds the owner's and repository's numeric IDs, which never change:
 *   repo:Prateek-2106@65821259/vendorstreet@1400722849:ref:refs/heads/main
 * IDs matter because names can be reused: if the repo were deleted or renamed, someone else
 * could create one with the old name, but never with the same IDs. When `ids` ("ownerId/repoId")
 * is given, both formats are accepted for exactly this repository; nothing broader.
 */
export function githubSubjects(repo: string, ids?: string): string[] {
  const subjects = [`repo:${repo}:ref:refs/heads/main`];
  if (ids) {
    const [owner, name] = repo.split("/");
    const [ownerId, repoId] = ids.split("/");
    if (!owner || !name || !/^\d+$/.test(ownerId ?? "") || !/^\d+$/.test(repoId ?? ""))
      throw new Error(`githubRepoIds must look like "65821259/1400722849" (owner ID / repository ID), got "${ids}"`);
    subjects.push(`repo:${owner}@${ownerId}/${name}@${repoId}:ref:refs/heads/main`);
  }
  return subjects;
}
