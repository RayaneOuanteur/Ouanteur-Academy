import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const inscriptions = pgTable("inscriptions", {
  id: serial().primaryKey(),
  prenom: text().notNull(),
  nom: text().notNull(),
  email: text().notNull().unique(),
  ville: text().notNull(),
  langue: text().notNull().default("fr"),
  admissible: boolean().notNull(),
  consent: boolean().notNull().default(true),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  gclid: text(),
  fbclid: text(),
  page: text(),
  referrer: text(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
