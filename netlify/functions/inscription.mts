import type { Config } from "@netlify/functions";
import { count, eq, lte, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { inscriptions } from "../../db/schema.js";

const TOTAL_SEATS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LANGS = ["fr", "en", "ar"];

async function seatsTaken() {
  const [row] = await db.select({ n: count() }).from(inscriptions).where(eq(inscriptions.admissible, true));
  return Math.min(TOTAL_SEATS, Number(row?.n ?? 0));
}

async function rankOf(id: number) {
  const [row] = await db.select({ n: count() }).from(inscriptions).where(lte(inscriptions.id, id));
  return Number(row?.n ?? 0);
}

const clip = (v: FormDataEntryValue | null, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const opt = (v: FormDataEntryValue | null, max = 200) => clip(v, max) || null;

export default async (req: Request) => {
  try {
    if (req.method === "GET") {
      return Response.json({ ok: true, prises: await seatsTaken(), total: TOTAL_SEATS });
    }
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const f = await req.formData();
    if (clip(f.get("website"), 200)) return Response.json({ ok: true, prises: await seatsTaken() }); // robot

    const prenom = clip(f.get("prenom"), 60);
    const nom = clip(f.get("nom"), 60);
    const email = clip(f.get("email"), 120).toLowerCase();
    const ville = clip(f.get("ville"), 80);
    const langue = LANGS.includes(clip(f.get("langue"), 5)) ? clip(f.get("langue"), 5) : "fr";
    const consent = clip(f.get("consent"), 10);

    if (!prenom || !nom || ville.length < 2 || !EMAIL_RE.test(email) || !consent) {
      return Response.json({ ok: false, erreur: "invalide" }, { status: 400 });
    }

    const [created] = await db
      .insert(inscriptions)
      .values({
        prenom, nom, email, ville, langue, consent: true,
        admissible: sql`((select count(*) from ${inscriptions} where ${inscriptions.admissible}) < ${TOTAL_SEATS})`,
        utmSource: opt(f.get("utm_source")),
        utmMedium: opt(f.get("utm_medium")),
        utmCampaign: opt(f.get("utm_campaign")),
        utmContent: opt(f.get("utm_content")),
        utmTerm: opt(f.get("utm_term")),
        gclid: opt(f.get("gclid")),
        fbclid: opt(f.get("fbclid")),
        page: opt(f.get("page")),
        referrer: opt(f.get("referrer")),
      })
      .onConflictDoNothing({ target: inscriptions.email })
      .returning({ id: inscriptions.id, admissible: inscriptions.admissible });

    if (!created) {
      const [existing] = await db
        .select({ id: inscriptions.id, admissible: inscriptions.admissible })
        .from(inscriptions)
        .where(eq(inscriptions.email, email));
      return Response.json({
        ok: true,
        doublon: true,
        admissible: existing?.admissible ?? false,
        rang: existing ? await rankOf(existing.id) : undefined,
        prises: await seatsTaken(),
      });
    }

    return Response.json({
      ok: true,
      admissible: created.admissible,
      rang: await rankOf(created.id),
      prises: await seatsTaken(),
    });
  } catch (err) {
    console.error("inscription error", err);
    return Response.json({ ok: false, erreur: "serveur" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/inscription",
  method: ["GET", "POST"],
};
