// Importa un resumen de tus repos para que Claude conozca tu experiencia real.

interface Repo {
  name: string;
  description: string | null;
  language: string | null;
  fork: boolean;
  stargazers_count: number;
  pushed_at: string;
  html_url: string;
  topics?: string[];
}

function headers(token: string, raw = false): Record<string, string> {
  const h: Record<string, string> = {
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "User-Agent": "interviewer-max",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function importGithub(user: string, token: string): Promise<string> {
  if (!user && !token) throw new Error("Indica tu usuario de GitHub (o un token).");
  const url = token
    ? "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner"
    : `https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  const repos = ((await res.json()) as Repo[]).filter((r) => !r.fork).slice(0, 10);

  const langs = new Map<string, number>();
  for (const r of repos) if (r.language) langs.set(r.language, (langs.get(r.language) ?? 0) + 1);
  const topLangs = [...langs.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);

  const owner = user || (await (await fetch("https://api.github.com/user", { headers: headers(token) })).json() as any).login;
  const parts: string[] = [`Lenguajes más usados: ${topLangs.join(", ") || "n/d"}`];

  for (const r of repos) {
    let readme = "";
    try {
      const rr = await fetch(`https://api.github.com/repos/${owner}/${r.name}/readme`, { headers: headers(token, true) });
      if (rr.ok) readme = (await rr.text()).replace(/\s+/g, " ").slice(0, 600);
    } catch {
      /* sin README */
    }
    parts.push(
      `- ${r.name} [${r.language ?? "?"}] ${r.description ?? ""} ${r.topics?.length ? "(" + r.topics.join(", ") + ")" : ""}\n  ${readme}`.trimEnd(),
    );
  }
  return parts.join("\n");
}
